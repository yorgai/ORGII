//! Shared search service: code, file, and symbol search.
//!
//! Used by the agent `SearchTool`. Delegates to native `search::` modules
//! which provide parallel regex search (via `grep-searcher` + `rayon`) and
//! fuzzy file search (via `ignore` + `nucleo`).
//!
//! No wrapper types — the native result types are flattened directly in the
//! `*_formatted` functions which produce agent-friendly text.

#[cfg(test)]
#[path = "tests/search_tests.rs"]
mod tests;

use std::path::{Path, PathBuf};

use super::SEARCH_TIMEOUT;

// ============================================
// Code Search (regex via grep-searcher)
// ============================================

/// Search code by regex pattern and return formatted results.
///
/// Calls `search::code::commands::search_code_fast_inner` (ripgrep core)
/// and flattens file-grouped results into `path:line:content` lines.
pub async fn code_search_formatted(
    pattern: &str,
    search_path: &Path,
    max_results: usize,
    context_lines: Option<usize>,
) -> Result<String, String> {
    let pattern_owned = pattern.to_string();
    let search_path_owned = search_path.to_path_buf();

    let filters = search::code::commands::SearchFilters {
        file_extensions: None,
        exclude_dirs: None,
        case_sensitive: Some(false),
        whole_word: Some(false),
        use_regex: Some(true),
        max_results: Some(max_results),
    };

    let native_results = tokio::time::timeout(
        SEARCH_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            search::code::commands::search_code_fast_inner(
                &pattern_owned,
                &search_path_owned.to_string_lossy(),
                filters,
                None,
            )
        }),
    )
    .await
    .map_err(|_| format!("Code search timed out after {}s", SEARCH_TIMEOUT.as_secs()))?
    .map_err(|err| format!("Code search task failed: {err}"))?
    .map_err(|err| format!("Code search failed: {err}"))?
    .results;

    if native_results.is_empty() {
        return Ok("No matches found.".to_string());
    }

    let ctx = context_lines.unwrap_or(0);

    let mut lines = Vec::new();
    let mut match_count = 0;
    'outer: for file_result in &native_results {
        if ctx > 0 {
            let file_lines = read_file_lines_cached(&file_result.file_path);
            for m in &file_result.matches {
                let line_idx = m.line.saturating_sub(1);
                let total = file_lines.len();
                let ctx_start = line_idx.saturating_sub(ctx);
                let ctx_end = (line_idx + ctx + 1).min(total);

                if match_count > 0 {
                    lines.push("--".to_string());
                }
                for idx in ctx_start..ctx_end {
                    let sep = if idx == line_idx { ":" } else { "-" };
                    lines.push(
                        format!("{}{}{}{}", file_result.file_path, sep, idx + 1, sep)
                            + file_lines.get(idx).unwrap_or(&String::new()),
                    );
                }
                match_count += 1;
                if match_count >= max_results {
                    break 'outer;
                }
            }
        } else {
            for m in &file_result.matches {
                lines.push(format!("{}:{}:{}", file_result.file_path, m.line, m.text));
                match_count += 1;
                if match_count >= max_results {
                    break 'outer;
                }
            }
        }
    }

    let formatted = lines.join("\n");
    Ok(truncate_output(formatted, 20_000))
}

pub async fn code_search_multi_formatted(
    pattern: &str,
    search_paths: &[PathBuf],
    max_results: usize,
    context_lines: Option<usize>,
) -> Result<String, String> {
    let mut sections = Vec::new();
    let mut remaining = max_results;

    for search_path in search_paths {
        if remaining == 0 {
            break;
        }
        let result = code_search_formatted(pattern, search_path, remaining, context_lines).await?;
        if result == "No matches found." {
            continue;
        }
        sections.push(format!("## {}\n{}", search_path.display(), result));
        remaining = remaining.saturating_sub(count_grep_matches(&result));
    }

    if sections.is_empty() {
        return Ok("No matches found.".to_string());
    }

    Ok(truncate_output(sections.join("\n\n"), 20_000))
}

fn read_file_lines_cached(path: &str) -> Vec<String> {
    // If a file showed up in the native search index but disappeared
    // (or became unreadable) before we render context lines, the
    // search result row is still meaningful — just without context.
    // Warn so a transient FS issue or stale index is visible
    // instead of silently producing context-less search hits.
    match std::fs::read_to_string(path) {
        Ok(content) => content.lines().map(String::from).collect(),
        Err(err) => {
            tracing::warn!(
                path = %path,
                error = %err,
                "search::read_file_lines_cached: file read failed; rendering match without context"
            );
            Vec::new()
        }
    }
}

// ============================================
// File Search (fuzzy via nucleo)
// ============================================

/// Detect glob-style extension patterns like `*.ts`, `**/*.tsx`, `*.{ts,tsx}`.
/// Returns `(query_for_fuzzy, Option<file_extensions>)`.
fn parse_glob_extensions(pattern: &str) -> (String, Option<Vec<String>>) {
    let trimmed = pattern.trim();

    // Strip leading path globs: "**/*.ts" → "*.ts"
    let stem = trimmed.rsplit('/').next().unwrap_or(trimmed);

    // Match `*.ext` or `*.{ext1,ext2,...}`
    if let Some(rest) = stem.strip_prefix("*.") {
        // Brace expansion: `*.{ts,tsx}`
        if rest.starts_with('{') && rest.ends_with('}') {
            let inner = &rest[1..rest.len() - 1];
            let exts: Vec<String> = inner
                .split(',')
                .map(|ext| format!(".{}", ext.trim()))
                .collect();
            if !exts.is_empty() {
                return (String::new(), Some(exts));
            }
        }
        // Simple: `*.ts`
        if !rest.is_empty() && rest.chars().all(|ch| ch.is_alphanumeric() || ch == '_') {
            return (String::new(), Some(vec![format!(".{rest}")]));
        }
    }

    (pattern.to_string(), None)
}

/// Search for files by name pattern and return formatted results.
///
/// Calls `search::file::search_files_fuzzy` (ignore + nucleo matcher).
/// Glob patterns like `*.ts` or `**/*.{ts,tsx}` are automatically
/// converted to extension filters so the fuzzy engine returns matches.
pub async fn file_search_formatted(
    pattern: &str,
    search_path: &Path,
    max_results: usize,
) -> Result<String, String> {
    let (query, file_extensions) = parse_glob_extensions(pattern);
    let search_path_owned = search_path.to_path_buf();

    let options = search::file::SearchOptions {
        root_path: search_path_owned.to_string_lossy().to_string(),
        query,
        max_results: Some(max_results),
        file_extensions,
        exclude_dirs: None,
    };

    let native_results =
        tokio::time::timeout(SEARCH_TIMEOUT, search::file::search_files_fuzzy(options))
            .await
            .map_err(|_| format!("File search timed out after {}s", SEARCH_TIMEOUT.as_secs()))?
            .map_err(|err| format!("File search failed: {err}"))?;

    if native_results.files.is_empty() {
        return Ok("No files found.".to_string());
    }

    Ok(native_results
        .files
        .iter()
        .map(|entry| entry.path.as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

pub async fn file_search_multi_formatted(
    pattern: &str,
    search_paths: &[PathBuf],
    max_results: usize,
) -> Result<String, String> {
    let mut sections = Vec::new();
    let mut remaining = max_results;

    for search_path in search_paths {
        if remaining == 0 {
            break;
        }
        let result = file_search_formatted(pattern, search_path, remaining).await?;
        if result == "No files found." {
            continue;
        }
        sections.push(format!("## {}\n{}", search_path.display(), result));
        remaining = remaining.saturating_sub(count_non_empty_lines(&result));
    }

    if sections.is_empty() {
        return Ok("No files found.".to_string());
    }

    Ok(truncate_output(sections.join("\n\n"), 20_000))
}

// ============================================
// Glob Search (true glob pattern matching)
// ============================================

/// Match files by glob pattern (e.g. `src/**/*.ts`, `*.{rs,toml}`).
/// Uses the `ignore` crate walker (respects .gitignore) with `globset` matching.
pub async fn glob_search_formatted(
    pattern: &str,
    search_path: &std::path::Path,
    max_results: usize,
) -> Result<String, String> {
    let pattern_owned = pattern.to_string();
    let search_path_owned = search_path.to_path_buf();

    tokio::task::spawn_blocking(move || {
        let glob = ignore::overrides::OverrideBuilder::new(&search_path_owned)
            .add(&pattern_owned)
            .map_err(|err| format!("Invalid glob pattern '{}': {err}", pattern_owned))?
            .build()
            .map_err(|err| format!("Failed to compile glob: {err}"))?;

        let mut matches: Vec<String> = Vec::new();
        let walker = ignore::WalkBuilder::new(&search_path_owned)
            .hidden(false)
            .git_ignore(true)
            .overrides(glob)
            .build();

        let prefix = search_path_owned.to_string_lossy();
        for entry in walker {
            let Ok(entry) = entry else { continue };
            if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                continue;
            }
            let path_str = entry.path().to_string_lossy();
            let relative = path_str
                .strip_prefix(prefix.as_ref())
                .unwrap_or(&path_str)
                .trim_start_matches('/');
            matches.push(relative.to_string());
            if matches.len() >= max_results {
                break;
            }
        }

        if matches.is_empty() {
            return Ok("No files matched.".to_string());
        }
        matches.sort();
        Ok(matches.join("\n"))
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

pub async fn glob_search_multi_formatted(
    pattern: &str,
    search_paths: &[PathBuf],
    max_results: usize,
) -> Result<String, String> {
    let mut sections = Vec::new();
    let mut remaining = max_results;

    for search_path in search_paths {
        if remaining == 0 {
            break;
        }
        let result = glob_search_formatted(pattern, search_path, remaining).await?;
        if result == "No files matched." {
            continue;
        }
        sections.push(format!("## {}\n{}", search_path.display(), result));
        remaining = remaining.saturating_sub(count_non_empty_lines(&result));
    }

    if sections.is_empty() {
        return Ok("No files matched.".to_string());
    }

    Ok(truncate_output(sections.join("\n\n"), 20_000))
}

// ============================================
// Symbol Search (tree-sitter)
// ============================================

/// Search for symbols (functions, classes, etc.) and return formatted results.
pub async fn symbol_search_formatted(
    query: &str,
    repo_paths: Vec<String>,
    max_results: usize,
) -> Result<String, String> {
    let query_owned = query.to_string();

    let native_results = tokio::time::timeout(
        SEARCH_TIMEOUT,
        search::code::commands::search_symbols(query_owned, repo_paths, None),
    )
    .await
    .map_err(|_| {
        format!(
            "Symbol search timed out after {}s",
            SEARCH_TIMEOUT.as_secs()
        )
    })?
    .map_err(|err| format!("Symbol search failed: {err}"))?;

    if native_results.is_empty() {
        return Ok("No symbols found.".to_string());
    }

    let mut lines = Vec::new();
    'outer: for file_result in &native_results {
        for sym in &file_result.symbols {
            lines.push(format!(
                "{}:{}  {} ({})",
                file_result.file_path, sym.line, sym.name, sym.kind
            ));
            if lines.len() >= max_results {
                break 'outer;
            }
        }
    }

    Ok(lines.join("\n"))
}

pub async fn index_status_formatted() -> Result<String, String> {
    Ok(
        "Code indexing is archived in this build. Use grep, glob, find_files, or symbols."
            .to_string(),
    )
}

// ============================================
// Helpers
// ============================================

fn count_non_empty_lines(text: &str) -> usize {
    text.lines().filter(|line| !line.trim().is_empty()).count()
}

fn count_grep_matches(text: &str) -> usize {
    text.lines()
        .filter(|line| {
            line.split_once(':')
                .and_then(|(_, rest)| rest.split_once(':'))
                .is_some_and(|(line_number, _)| line_number.chars().all(|ch| ch.is_ascii_digit()))
        })
        .count()
}

fn truncate_output(text: String, max_chars: usize) -> String {
    if text.len() > max_chars {
        let truncated: String = crate::utils::safe_truncate_chars_to_string(&text, max_chars);
        format!(
            "{}\n\n[...truncated, {} total chars]",
            truncated,
            text.len()
        )
    } else {
        text
    }
}
