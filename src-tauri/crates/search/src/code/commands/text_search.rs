//! Text/regex search commands — regex scan, streaming search, and grep-searcher (ripgrep core).

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
use tauri::Emitter;
use tracing::{debug, info};

use super::cache::{self, SearchCacheKey};
use super::helpers::{
    collect_files, get_same_line_context, read_file_content, register_search, unregister_search,
};
use super::types::{CodeSearchMatch, CodeSearchResult, SearchFilters};

// ── Regex Search ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_code_regex(
    query: String,
    repo_paths: Vec<String>,
    filters: Option<SearchFilters>,
) -> Result<Vec<CodeSearchResult>, String> {
    tokio::task::spawn_blocking(move || search_code_regex_inner(query, repo_paths, filters))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

fn search_code_regex_inner(
    query: String,
    repo_paths: Vec<String>,
    filters: Option<SearchFilters>,
) -> Result<Vec<CodeSearchResult>, String> {
    use rayon::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    let start = Instant::now();

    let filters = filters.unwrap_or(SearchFilters {
        file_extensions: None,
        exclude_dirs: None,
        case_sensitive: Some(false),
        whole_word: Some(false),
        use_regex: Some(false),
        max_results: Some(100),
    });

    let case_sensitive = filters.case_sensitive.unwrap_or(false);
    let use_regex = filters.use_regex.unwrap_or(false);
    let max_results = filters.max_results.unwrap_or(500);

    let pattern = if use_regex {
        if case_sensitive {
            query.clone()
        } else {
            format!("(?i){}", query)
        }
    } else {
        let escaped = regex::escape(&query);
        if case_sensitive {
            escaped
        } else {
            format!("(?i){}", escaped)
        }
    };

    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;

    let all_files: Vec<PathBuf> = repo_paths
        .iter()
        .filter_map(|repo_path| {
            let root = PathBuf::from(repo_path);
            if root.exists() {
                Some(collect_files(&root, &filters))
            } else {
                None
            }
        })
        .flatten()
        .collect();

    let match_count = AtomicUsize::new(0);

    let results: Vec<CodeSearchResult> = all_files
        .par_iter()
        .filter_map(|file_path| {
            if match_count.load(Ordering::Relaxed) >= max_results {
                return None;
            }

            let content = read_file_content(file_path)?;
            let lines: Vec<&str> = content.lines().collect();
            let mut matches = Vec::new();

            for (line_idx, line) in lines.iter().enumerate() {
                if match_count.load(Ordering::Relaxed) >= max_results {
                    break;
                }

                for mat in re.find_iter(line) {
                    let current = match_count.fetch_add(1, Ordering::Relaxed);
                    if current >= max_results {
                        break;
                    }

                    let (context_before, context_after) =
                        get_same_line_context(line, mat.start(), mat.end());

                    matches.push(CodeSearchMatch {
                        line: line_idx + 1,
                        column: mat.start() + 1,
                        end_line: line_idx + 1,
                        end_column: mat.end() + 1,
                        text: mat.as_str().to_string(),
                        context_before,
                        context_after,
                    });
                }
            }

            if matches.is_empty() {
                None
            } else {
                Some(CodeSearchResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    matches,
                })
            }
        })
        .collect();

    let total_matches = match_count.load(Ordering::Relaxed);
    let duration = start.elapsed();
    info!(
        matches = total_matches,
        files = results.len(),
        ?duration,
        "search::text: parallel search complete"
    );

    Ok(results)
}

// ── Streaming Search ────────────────────────────────────────────────────

#[tauri::command]
pub async fn search_code_streaming(
    window: tauri::Window,
    search_id: String,
    query: String,
    repo_path: String,
    filters: Option<SearchFilters>,
) -> Result<(), String> {
    use rayon::prelude::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Instant;

    let start = Instant::now();

    let cancelled = register_search(&search_id);

    let search_id_for_cleanup = search_id.clone();
    scopeguard::defer! {
        unregister_search(&search_id_for_cleanup);
    }

    let filters = filters.unwrap_or(SearchFilters {
        file_extensions: None,
        exclude_dirs: None,
        case_sensitive: Some(false),
        whole_word: Some(false),
        use_regex: Some(false),
        max_results: Some(10000),
    });

    let case_sensitive = filters.case_sensitive.unwrap_or(false);
    let use_regex = filters.use_regex.unwrap_or(false);
    let max_results = filters.max_results.unwrap_or(10000);

    let pattern = if use_regex {
        if case_sensitive {
            query.clone()
        } else {
            format!("(?i){}", query)
        }
    } else {
        let escaped = regex::escape(&query);
        if case_sensitive {
            escaped
        } else {
            format!("(?i){}", escaped)
        }
    };

    let re = regex::Regex::new(&pattern).map_err(|e| format!("Invalid regex: {}", e))?;

    let root = PathBuf::from(&repo_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", repo_path));
    }

    let files = collect_files(&root, &filters);
    let total_files_to_search = files.len();

    let emitted_matches = Arc::new(AtomicUsize::new(0));
    let emitted_files = Arc::new(AtomicUsize::new(0));
    let actual_matches = Arc::new(AtomicUsize::new(0));
    let actual_files = Arc::new(AtomicUsize::new(0));

    let _ = window.emit(
        "search-started",
        serde_json::json!({
            "search_id": search_id,
            "total_files": total_files_to_search,
        }),
    );

    #[allow(clippy::type_complexity)]
    let results_collector: Arc<Mutex<Vec<(CodeSearchResult, usize, usize, usize, usize)>>> =
        Arc::new(Mutex::new(Vec::new()));

    let re_arc = Arc::new(re);

    files.par_iter().for_each(|file_path| {
        if cancelled.load(Ordering::Relaxed) {
            return;
        }

        if emitted_matches.load(Ordering::Relaxed) >= max_results {
            return;
        }

        if let Some(content) = read_file_content(file_path) {
            let lines: Vec<&str> = content.lines().collect();
            let mut matches_to_emit = Vec::new();
            let mut file_match_count = 0;
            let mut hit_limit = false;

            for (line_idx, line) in lines.iter().enumerate() {
                if hit_limit {
                    break;
                }

                for mat in re_arc.find_iter(line) {
                    file_match_count += 1;

                    let current_emitted = emitted_matches.fetch_add(1, Ordering::Relaxed);
                    if current_emitted < max_results {
                        let (context_before, context_after) =
                            get_same_line_context(line, mat.start(), mat.end());

                        matches_to_emit.push(CodeSearchMatch {
                            line: line_idx + 1,
                            column: mat.start() + 1,
                            end_line: line_idx + 1,
                            end_column: mat.end() + 1,
                            text: mat.as_str().to_string(),
                            context_before,
                            context_after,
                        });
                    } else {
                        hit_limit = true;
                        break;
                    }
                }
            }

            if file_match_count > 0 {
                actual_matches.fetch_add(file_match_count, Ordering::Relaxed);
                actual_files.fetch_add(1, Ordering::Relaxed);
            }

            if !matches_to_emit.is_empty() {
                emitted_files.fetch_add(1, Ordering::Relaxed);

                let result = CodeSearchResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    matches: matches_to_emit,
                };

                let counts = (
                    emitted_matches.load(Ordering::Relaxed),
                    emitted_files.load(Ordering::Relaxed),
                    actual_matches.load(Ordering::Relaxed),
                    actual_files.load(Ordering::Relaxed),
                );

                results_collector
                    .lock()
                    .unwrap()
                    .push((result, counts.0, counts.1, counts.2, counts.3));
            }
        }
    });

    let was_cancelled = cancelled.load(Ordering::Relaxed);

    if !was_cancelled {
        let collected_results = results_collector.lock().unwrap();
        for (result, em, ef, am, af) in collected_results.iter() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let _ = window.emit(
                "search-result",
                serde_json::json!({
                    "search_id": search_id,
                    "result": result,
                    "emitted_matches": em,
                    "emitted_files": ef,
                    "actual_matches": am,
                    "actual_files": af,
                }),
            );
        }
    }

    let duration = start.elapsed();
    let final_emitted_matches = emitted_matches.load(Ordering::Relaxed);
    let final_emitted_files = emitted_files.load(Ordering::Relaxed);
    let final_actual_matches = actual_matches.load(Ordering::Relaxed);
    let final_actual_files = actual_files.load(Ordering::Relaxed);
    let was_cancelled = cancelled.load(Ordering::Relaxed);

    let limit_hit = final_emitted_matches >= max_results;

    let _ = window.emit(
        "search-complete",
        serde_json::json!({
            "search_id": search_id,
            "emitted_matches": final_emitted_matches,
            "emitted_files": final_emitted_files,
            "total_matches": final_actual_matches,
            "total_files": final_actual_files,
            "duration_ms": duration.as_millis(),
            "has_more": limit_hit,
            "limit_hit": limit_hit,
            "cancelled": was_cancelled,
        }),
    );

    let status_msg = if was_cancelled {
        " [CANCELLED]"
    } else if limit_hit {
        " [LIMIT HIT]"
    } else {
        ""
    };
    info!(
        matches = final_actual_matches,
        files = final_actual_files,
        ?duration,
        status = %status_msg,
        "search::text: streaming search complete"
    );

    Ok(())
}

// ── Grep-Searcher (ripgrep core) ────────────────────────────────────────

/// Custom sink to collect search matches.
///
/// `grep-searcher` only delivers the matching line as a whole; to give the UI
/// real sub-string highlights we re-scan each line with the same `regex::Regex`
/// here and emit one `CodeSearchMatch` per occurrence, with accurate
/// column/end_column and same-line context.
struct MatchCollector {
    matches: Vec<CodeSearchMatch>,
    max_matches: usize,
    re: Arc<regex::Regex>,
}

impl MatchCollector {
    fn new(max_matches: usize, re: Arc<regex::Regex>) -> Self {
        Self {
            matches: Vec::new(),
            max_matches,
            re,
        }
    }
}

impl Sink for MatchCollector {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self.matches.len() >= self.max_matches {
            return Ok(false);
        }

        let line_number = mat.line_number().unwrap_or(0) as usize;
        let line_bytes = mat.bytes();
        // `mat.bytes()` includes the line terminator; strip it so that
        // column/end_column reflect the visible content only.
        let trimmed_end = line_bytes
            .strip_suffix(b"\r\n")
            .or_else(|| line_bytes.strip_suffix(b"\n"))
            .unwrap_or(line_bytes);
        let line_text = String::from_utf8_lossy(trimmed_end).to_string();

        for hit in self.re.find_iter(&line_text) {
            if self.matches.len() >= self.max_matches {
                return Ok(false);
            }

            let (context_before, context_after) =
                get_same_line_context(&line_text, hit.start(), hit.end());

            self.matches.push(CodeSearchMatch {
                line: line_number,
                column: hit.start() + 1,
                end_line: line_number,
                end_column: hit.end() + 1,
                text: hit.as_str().to_string(),
                context_before,
                context_after,
            });
        }

        Ok(true)
    }
}

#[derive(Debug, Clone)]
pub struct FastSearchOutcome {
    pub results: Vec<CodeSearchResult>,
    pub total_matches: usize,
    pub total_files: usize,
    pub total_files_searched: usize,
    pub limit_hit: bool,
    pub cancelled: bool,
}

pub fn search_code_fast_inner(
    query: &str,
    repo_path: &str,
    filters: SearchFilters,
    cancelled: Option<Arc<std::sync::atomic::AtomicBool>>,
) -> Result<FastSearchOutcome, String> {
    search_code_fast_inner_with_handlers(query, repo_path, filters, cancelled, |_| {}, |_, _, _| {})
}

pub fn search_code_fast_inner_with_handlers<F, S>(
    query: &str,
    repo_path: &str,
    filters: SearchFilters,
    cancelled: Option<Arc<std::sync::atomic::AtomicBool>>,
    on_files_collected: S,
    on_result: F,
) -> Result<FastSearchOutcome, String>
where
    F: Fn(CodeSearchResult, usize, usize) + Send + Sync,
    S: Fn(usize) + Send + Sync,
{
    use rayon::prelude::*;
    use std::sync::atomic::AtomicUsize;

    let cancelled =
        cancelled.unwrap_or_else(|| Arc::new(std::sync::atomic::AtomicBool::new(false)));
    let case_sensitive = filters.case_sensitive.unwrap_or(false);
    let use_regex = filters.use_regex.unwrap_or(false);
    let max_results = filters.max_results.unwrap_or(10000);

    let pattern = if use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .build(&pattern)
        .map_err(|e| format!("Invalid pattern: {}", e))?;

    let inline_pattern = if case_sensitive {
        pattern.clone()
    } else {
        format!("(?i){}", pattern)
    };
    let inline_re = Arc::new(
        regex::Regex::new(&inline_pattern).map_err(|e| format!("Invalid pattern: {}", e))?,
    );

    let root = PathBuf::from(repo_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", repo_path));
    }

    let files = collect_files(&root, &filters);
    let total_files_searched = files.len();
    on_files_collected(total_files_searched);
    let emitted_matches = Arc::new(AtomicUsize::new(0));
    let emitted_files = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(Mutex::new(Vec::new()));

    files.par_iter().for_each(|file_path| {
        if cancelled.load(Ordering::Relaxed) {
            return;
        }

        let current_matches = emitted_matches.load(Ordering::Relaxed);
        if current_matches >= max_results {
            return;
        }

        let remaining_matches = max_results.saturating_sub(current_matches);
        if remaining_matches == 0 {
            return;
        }

        let mut searcher = SearcherBuilder::new().line_number(true).build();
        let mut collector = MatchCollector::new(remaining_matches, inline_re.clone());

        if let Ok(()) = searcher.search_path(&matcher, file_path, &mut collector) {
            if collector.matches.is_empty() {
                return;
            }

            let available_start =
                emitted_matches.fetch_add(collector.matches.len(), Ordering::Relaxed);
            if available_start >= max_results {
                return;
            }

            let allowed_matches = max_results - available_start;
            if collector.matches.len() > allowed_matches {
                collector.matches.truncate(allowed_matches);
            }

            if collector.matches.is_empty() {
                return;
            }

            emitted_files.fetch_add(1, Ordering::Relaxed);
            let result = CodeSearchResult {
                file_path: file_path.to_string_lossy().to_string(),
                matches: collector.matches,
            };
            let total_matches = emitted_matches.load(Ordering::Relaxed).min(max_results);
            let total_files = emitted_files.load(Ordering::Relaxed);
            on_result(result.clone(), total_matches, total_files);
            results.lock().unwrap().push(result);
        }
    });

    let total_matches = emitted_matches.load(Ordering::Relaxed).min(max_results);
    let total_files = emitted_files.load(Ordering::Relaxed);
    let was_cancelled = cancelled.load(Ordering::Relaxed);

    let collected_results = results.lock().unwrap().clone();

    Ok(FastSearchOutcome {
        results: collected_results,
        total_matches,
        total_files,
        total_files_searched,
        limit_hit: total_matches >= max_results,
        cancelled: was_cancelled,
    })
}

#[tauri::command]
pub async fn search_code_fast(
    window: tauri::Window,
    search_id: String,
    query: String,
    repo_path: String,
    filters: Option<SearchFilters>,
) -> Result<(), String> {
    use std::time::Instant;

    let start = Instant::now();

    let cancelled = register_search(&search_id);
    let search_id_for_cleanup = search_id.clone();
    scopeguard::defer! {
        unregister_search(&search_id_for_cleanup);
    }

    let filters = filters.unwrap_or(SearchFilters {
        file_extensions: None,
        exclude_dirs: None,
        case_sensitive: Some(false),
        whole_word: Some(false),
        use_regex: Some(false),
        max_results: Some(10000),
    });

    let cache_key = SearchCacheKey::new(&query, &repo_path, &filters);
    if let Some(cached) = cache::get_cached_result(&cache_key) {
        debug!(
            results = cached.results.len(),
            "search::text: fast search cache hit"
        );

        let _ = window.emit(
            "search-started",
            serde_json::json!({
                "search_id": search_id,
                "total_files": cached.total_files,
                "cached": true,
            }),
        );

        for result in &cached.results {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            let _ = window.emit(
                "search-result",
                serde_json::json!({
                    "search_id": search_id,
                    "result": result,
                    "emitted_matches": cached.total_matches,
                    "emitted_files": cached.total_files,
                    "actual_matches": cached.total_matches,
                    "actual_files": cached.total_files,
                }),
            );
        }

        let _ = window.emit(
            "search-complete",
            serde_json::json!({
                "search_id": search_id,
                "emitted_matches": cached.total_matches,
                "emitted_files": cached.total_files,
                "total_matches": cached.total_matches,
                "total_files": cached.total_files,
                "duration_ms": start.elapsed().as_millis(),
                "has_more": cached.limit_hit,
                "limit_hit": cached.limit_hit,
                "cancelled": false,
                "cached": true,
            }),
        );

        return Ok(());
    }

    let window_for_start = window.clone();
    let search_id_for_start = search_id.clone();
    let window_for_results = window.clone();
    let search_id_for_results = search_id.clone();
    let cancelled_for_results = cancelled.clone();
    let outcome = search_code_fast_inner_with_handlers(
        &query,
        &repo_path,
        filters,
        Some(cancelled.clone()),
        move |total_files| {
            let _ = window_for_start.emit(
                "search-started",
                serde_json::json!({
                    "search_id": search_id_for_start,
                    "total_files": total_files,
                }),
            );
        },
        move |result, total_matches, total_files| {
            if cancelled_for_results.load(Ordering::Relaxed) {
                return;
            }

            let _ = window_for_results.emit(
                "search-result",
                serde_json::json!({
                    "search_id": search_id_for_results,
                    "result": result,
                    "emitted_matches": total_matches,
                    "emitted_files": total_files,
                    "actual_matches": total_matches,
                    "actual_files": total_files,
                }),
            );
        },
    )?;

    if !outcome.cancelled {
        cache::cache_result(
            &cache_key,
            outcome.results.clone(),
            outcome.total_matches,
            outcome.total_files,
            outcome.limit_hit,
        );
        debug!(
            files = outcome.total_files,
            "search::text: cached fast search results"
        );
    }

    let _ = window.emit(
        "search-complete",
        serde_json::json!({
            "search_id": search_id,
            "emitted_matches": outcome.total_matches,
            "emitted_files": outcome.total_files,
            "total_matches": outcome.total_matches,
            "total_files": outcome.total_files,
            "duration_ms": start.elapsed().as_millis(),
            "has_more": outcome.limit_hit,
            "limit_hit": outcome.limit_hit,
            "cancelled": outcome.cancelled,
        }),
    );

    let status = if outcome.cancelled {
        "CANCELLED"
    } else if outcome.limit_hit {
        "LIMIT"
    } else {
        "OK"
    };
    info!(
        matches = outcome.total_matches,
        files = outcome.total_files,
        duration = ?start.elapsed(),
        status = %status,
        "search::text: fast search complete"
    );

    Ok(())
}
