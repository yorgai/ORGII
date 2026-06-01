//! Patch parser + applier for the `apply_patch` tool.
//!
//! `Hunk` is the parsed representation of a single change in a unified-diff-
//! style patch (Add / Delete / Update). The parser is deliberately small and
//! permissive — it has to accept whatever shape an LLM emits while still
//! refusing patches that would silently lose data. Apply-side logic enforces
//! the path constraints and writes through the workspace sandbox.

use std::path::{Path, PathBuf};

use serde::Serialize;

const APPLY_PATCH_DIFF_CONTEXT_LINES: usize = 2;

#[derive(Debug)]
pub enum Hunk {
    Add {
        path: String,
        contents: String,
    },
    Delete {
        path: String,
    },
    Update {
        path: String,
        move_path: Option<String>,
        chunks: Vec<UpdateChunk>,
    },
}

#[derive(Debug)]
pub struct UpdateChunk {
    pub old_lines: Vec<String>,
    pub new_lines: Vec<String>,
    pub change_context: Option<String>,
    pub is_end_of_file: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppliedPatchSegment {
    file_path: String,
    diff: String,
    lines_added: usize,
    lines_removed: usize,
    is_deleted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyPatchOutput {
    content: String,
    diff_string: String,
    lines_added: usize,
    lines_removed: usize,
    file_paths: Vec<String>,
    segments: Vec<AppliedPatchSegment>,
}

pub fn parse_patch(patch_text: &str) -> Result<Vec<Hunk>, String> {
    let cleaned = strip_heredoc(patch_text.trim());
    let lines: Vec<&str> = cleaned.split('\n').collect();

    let begin_idx = lines
        .iter()
        .position(|line| line.trim() == "*** Begin Patch")
        .ok_or("Invalid patch: missing *** Begin Patch marker")?;
    let end_idx = lines
        .iter()
        .position(|line| line.trim() == "*** End Patch")
        .ok_or("Invalid patch: missing *** End Patch marker")?;

    if begin_idx >= end_idx {
        return Err("Invalid patch: Begin marker must come before End marker".to_string());
    }

    let mut hunks = Vec::new();
    let mut idx = begin_idx + 1;

    while idx < end_idx {
        let line = lines[idx];

        if line.starts_with("*** Add File:") {
            let file_path = line
                .split_once(':')
                .map(|(_, rest)| rest.trim())
                .ok_or("Invalid Add File header")?
                .to_string();
            idx += 1;

            let mut content = String::new();
            while idx < end_idx && !lines[idx].starts_with("***") {
                if let Some(stripped) = lines[idx].strip_prefix('+') {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(stripped);
                }
                idx += 1;
            }

            hunks.push(Hunk::Add {
                path: file_path,
                contents: content,
            });
        } else if line.starts_with("*** Delete File:") {
            let file_path = line
                .split_once(':')
                .map(|(_, rest)| rest.trim())
                .ok_or("Invalid Delete File header")?
                .to_string();
            idx += 1;
            hunks.push(Hunk::Delete { path: file_path });
        } else if line.starts_with("*** Update File:") {
            let file_path = line
                .split_once(':')
                .map(|(_, rest)| rest.trim())
                .ok_or("Invalid Update File header")?
                .to_string();
            idx += 1;

            // Check for Move directive
            let mut move_path = None;
            if idx < end_idx && lines[idx].starts_with("*** Move to:") {
                move_path = lines[idx]
                    .split_once(':')
                    .map(|(_, rest)| rest.trim().to_string());
                idx += 1;
            }

            // Parse chunks
            let mut chunks = Vec::new();
            while idx < end_idx && !lines[idx].starts_with("***") {
                if lines[idx].starts_with("@@") {
                    let context_line = lines[idx][2..].trim().to_string();
                    idx += 1;

                    let mut old_lines = Vec::new();
                    let mut new_lines = Vec::new();
                    let mut is_eof = false;

                    while idx < end_idx
                        && !lines[idx].starts_with("@@")
                        && !lines[idx].starts_with("***")
                    {
                        let change_line = lines[idx];

                        if change_line == "*** End of File" {
                            is_eof = true;
                            idx += 1;
                            break;
                        }

                        if let Some(kept) = change_line.strip_prefix(' ') {
                            old_lines.push(kept.to_string());
                            new_lines.push(kept.to_string());
                        } else if let Some(removed) = change_line.strip_prefix('-') {
                            old_lines.push(removed.to_string());
                        } else if let Some(added) = change_line.strip_prefix('+') {
                            new_lines.push(added.to_string());
                        }

                        idx += 1;
                    }

                    chunks.push(UpdateChunk {
                        old_lines,
                        new_lines,
                        change_context: if context_line.is_empty() {
                            None
                        } else {
                            Some(context_line)
                        },
                        is_end_of_file: is_eof,
                    });
                } else {
                    idx += 1;
                }
            }

            hunks.push(Hunk::Update {
                path: file_path,
                move_path,
                chunks,
            });
        } else {
            idx += 1;
        }
    }

    Ok(hunks)
}

fn strip_heredoc(input: &str) -> String {
    // Match heredoc patterns: cat <<'EOF'\n...\nEOF
    if let Some(rest) = input.strip_prefix("cat <<") {
        let rest = rest.trim_start_matches(['\'', '"']);
        if let Some(marker_end) = rest.find(['\'', '"', '\n']) {
            let marker = &rest[..marker_end];
            let rest = &rest[marker_end..].trim_start_matches(['\'', '"']);
            if let Some(body_start) = rest.find('\n') {
                let body = &rest[body_start + 1..];
                if let Some(end_pos) = body.rfind(marker) {
                    return body[..end_pos].trim_end_matches('\n').to_string();
                }
            }
        }
    }
    input.to_string()
}

pub(super) async fn apply_hunks(workspace_root: &Path, hunks: &[Hunk]) -> Result<String, String> {
    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut deleted = Vec::new();
    let mut segments = Vec::new();

    for hunk in hunks {
        match hunk {
            Hunk::Add {
                path: file_path,
                contents,
            } => {
                let resolved = resolve_hunk_path(workspace_root, file_path)?;
                if let Some(parent) = resolved.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|err| {
                        format!("Failed to create dirs for {}: {}", file_path, err)
                    })?;
                }
                let final_content = if contents.is_empty() || contents.ends_with('\n') {
                    contents.clone()
                } else {
                    format!("{}\n", contents)
                };
                tokio::fs::write(&resolved, &final_content)
                    .await
                    .map_err(|err| format!("Failed to write {}: {}", file_path, err))?;
                let segment = build_patch_segment(file_path, "", &final_content, false);
                added.push(file_path.clone());
                segments.push(segment);
            }

            Hunk::Delete { path: file_path } => {
                let resolved = resolve_hunk_path(workspace_root, file_path)?;
                let original = tokio::fs::read_to_string(&resolved).await.map_err(|err| {
                    format!("Failed to read {} before delete: {}", file_path, err)
                })?;
                tokio::fs::remove_file(&resolved)
                    .await
                    .map_err(|err| format!("Failed to delete {}: {}", file_path, err))?;
                let segment = build_patch_segment(file_path, &original, "", true);
                deleted.push(file_path.clone());
                segments.push(segment);
            }

            Hunk::Update {
                path: file_path,
                move_path,
                chunks,
            } => {
                let resolved = resolve_hunk_path(workspace_root, file_path)?;
                let original = tokio::fs::read_to_string(&resolved)
                    .await
                    .map_err(|err| format!("Failed to read {}: {}", file_path, err))?;

                let new_content = derive_new_contents(&original, file_path, chunks)?;

                let target = if let Some(mp) = move_path {
                    let target_path = resolve_hunk_path(workspace_root, mp)?;
                    if let Some(parent) = target_path.parent() {
                        tokio::fs::create_dir_all(parent)
                            .await
                            .map_err(|err| format!("Failed to create dirs for {}: {}", mp, err))?;
                    }
                    tokio::fs::write(&target_path, &new_content)
                        .await
                        .map_err(|err| format!("Failed to write {}: {}", mp, err))?;
                    tokio::fs::remove_file(&resolved).await.map_err(|err| {
                        format!("Failed to delete original {}: {}", file_path, err)
                    })?;
                    mp.clone()
                } else {
                    tokio::fs::write(&resolved, &new_content)
                        .await
                        .map_err(|err| format!("Failed to write {}: {}", file_path, err))?;
                    file_path.clone()
                };
                let segment = build_patch_segment(&target, &original, &new_content, false);
                modified.push(target);
                segments.push(segment);
            }
        }
    }

    let mut summary = String::from("Patch applied successfully.");
    if !added.is_empty() {
        summary.push_str(&format!("\nAdded: {}", added.join(", ")));
    }
    if !modified.is_empty() {
        summary.push_str(&format!("\nModified: {}", modified.join(", ")));
    }
    if !deleted.is_empty() {
        summary.push_str(&format!("\nDeleted: {}", deleted.join(", ")));
    }

    let lines_added = segments.iter().map(|segment| segment.lines_added).sum();
    let lines_removed = segments.iter().map(|segment| segment.lines_removed).sum();
    let diff_string = segments
        .iter()
        .map(|segment| segment.diff.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let file_paths = segments
        .iter()
        .map(|segment| segment.file_path.clone())
        .collect();
    let output = ApplyPatchOutput {
        content: summary,
        diff_string,
        lines_added,
        lines_removed,
        file_paths,
        segments,
    };
    serde_json::to_string(&output)
        .map_err(|err| format!("Failed to serialize patch output: {}", err))
}

fn build_patch_segment(
    file_path: &str,
    old_content: &str,
    new_content: &str,
    is_deleted: bool,
) -> AppliedPatchSegment {
    let diff = similar::TextDiff::from_lines(old_content, new_content)
        .unified_diff()
        .context_radius(APPLY_PATCH_DIFF_CONTEXT_LINES)
        .header(&format!("a/{}", file_path), &format!("b/{}", file_path))
        .to_string();

    let mut lines_added = 0;
    let mut lines_removed = 0;
    for change in similar::TextDiff::from_lines(old_content, new_content).iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => lines_added += 1,
            similar::ChangeTag::Delete => lines_removed += 1,
            similar::ChangeTag::Equal => {}
        }
    }

    AppliedPatchSegment {
        file_path: file_path.to_string(),
        diff,
        lines_added,
        lines_removed,
        is_deleted,
    }
}

fn resolve_hunk_path(workspace_root: &Path, file_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_path);
    let canonical_root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        canonical_root.join(path)
    };

    let canonical_resolved = resolved.canonicalize().unwrap_or_else(|_| {
        resolved
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .map(|parent| match resolved.file_name() {
                Some(file_name) => parent.join(file_name),
                None => parent,
            })
            .unwrap_or_else(|| resolved.clone())
    });

    if !canonical_resolved.starts_with(&canonical_root) {
        return Err(format!(
            "Path traversal denied: '{}' resolves outside workspace root",
            file_path
        ));
    }
    Ok(resolved)
}

pub fn derive_new_contents(
    original: &str,
    file_path: &str,
    chunks: &[UpdateChunk],
) -> Result<String, String> {
    let mut original_lines: Vec<String> = original.split('\n').map(|s| s.to_string()).collect();

    // Drop trailing empty element for consistent line counting
    if original_lines.last().is_some_and(|line| line.is_empty()) {
        original_lines.pop();
    }

    let replacements = compute_replacements(&original_lines, file_path, chunks)?;
    let mut new_lines = apply_replacements(&original_lines, &replacements);

    // Ensure trailing newline
    if new_lines.is_empty() || !new_lines.last().is_none_or(|line| line.is_empty()) {
        new_lines.push(String::new());
    }

    Ok(new_lines.join("\n"))
}

/// Compute (start_index, old_count, new_lines) replacements for each chunk.
fn compute_replacements(
    original_lines: &[String],
    file_path: &str,
    chunks: &[UpdateChunk],
) -> Result<Vec<(usize, usize, Vec<String>)>, String> {
    let mut replacements = Vec::new();
    let mut line_index = 0;

    for chunk in chunks {
        // Handle context-based seeking
        if let Some(ref ctx) = chunk.change_context {
            let ctx_idx =
                seek_sequence(original_lines, std::slice::from_ref(ctx), line_index, false);
            if ctx_idx < 0 {
                return Err(format!("Failed to find context '{}' in {}", ctx, file_path));
            }
            line_index = ctx_idx as usize + 1;
        }

        // Pure addition (no old lines)
        if chunk.old_lines.is_empty() {
            // If we have a context anchor, insert right after it
            let insertion_idx = if chunk.change_context.is_some() {
                line_index
            } else if chunk.is_end_of_file || original_lines.is_empty() {
                original_lines.len()
            } else if original_lines.last().is_some_and(|line| line.is_empty()) {
                original_lines.len() - 1
            } else {
                original_lines.len()
            };
            replacements.push((insertion_idx, 0, chunk.new_lines.clone()));
            continue;
        }

        // Try to match old lines
        let mut pattern = chunk.old_lines.clone();
        let mut new_slice = chunk.new_lines.clone();
        let mut found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);

        // Retry without trailing empty line
        if found < 0 && pattern.last().is_some_and(|line| line.is_empty()) {
            pattern.pop();
            if new_slice.last().is_some_and(|line| line.is_empty()) {
                new_slice.pop();
            }
            found = seek_sequence(original_lines, &pattern, line_index, chunk.is_end_of_file);
        }

        if found >= 0 {
            let start = found as usize;
            replacements.push((start, pattern.len(), new_slice));
            line_index = start + pattern.len();
        } else {
            return Err(format!(
                "Failed to find expected lines in {}:\n{}",
                file_path,
                chunk.old_lines.join("\n")
            ));
        }
    }

    replacements.sort_by_key(|r| r.0);

    // Validate no overlapping replacements
    for window in replacements.windows(2) {
        let (start_a, len_a, _) = &window[0];
        let (start_b, _, _) = &window[1];
        if start_a + len_a > *start_b {
            return Err(format!(
                "Overlapping patch chunks in {} at lines {} and {}",
                file_path, start_a, start_b
            ));
        }
    }

    Ok(replacements)
}

/// Apply replacements in reverse order to avoid index shifting.
fn apply_replacements(
    lines: &[String],
    replacements: &[(usize, usize, Vec<String>)],
) -> Vec<String> {
    let mut result: Vec<String> = lines.to_vec();

    for (start, old_len, new_segment) in replacements.iter().rev() {
        // Remove old lines
        let end = (*start + *old_len).min(result.len());
        result.drain(*start..end);

        // Insert new lines
        for (offset, line) in new_segment.iter().enumerate() {
            result.insert(*start + offset, line.clone());
        }
    }

    result
}

/// 4-pass fuzzy line matching: exact → rstrip → trim → unicode-normalized.
pub fn seek_sequence(lines: &[String], pattern: &[String], start_index: usize, eof: bool) -> i64 {
    if pattern.is_empty() {
        return -1;
    }

    // Pass 1: exact
    let exact = try_match(lines, pattern, start_index, eof, |file_line, pat_line| {
        file_line == pat_line
    });
    if exact >= 0 {
        return exact;
    }

    // Pass 2: right-trimmed
    let rstrip = try_match(lines, pattern, start_index, eof, |file_line, pat_line| {
        file_line.trim_end() == pat_line.trim_end()
    });
    if rstrip >= 0 {
        return rstrip;
    }

    // Pass 3: fully trimmed
    let trimmed = try_match(lines, pattern, start_index, eof, |file_line, pat_line| {
        file_line.trim() == pat_line.trim()
    });
    if trimmed >= 0 {
        return trimmed;
    }

    // Pass 4: unicode-normalized
    try_match(lines, pattern, start_index, eof, |file_line, pat_line| {
        normalize_unicode(file_line.trim()) == normalize_unicode(pat_line.trim())
    })
}

fn try_match<F>(
    lines: &[String],
    pattern: &[String],
    start_index: usize,
    eof: bool,
    compare: F,
) -> i64
where
    F: Fn(&str, &str) -> bool,
{
    if pattern.len() > lines.len() {
        return -1;
    }

    // If EOF anchor, try from end first
    if eof {
        let from_end = lines.len() - pattern.len();
        if from_end >= start_index && matches_at(lines, pattern, from_end, &compare) {
            return from_end as i64;
        }
    }

    // Forward search
    let max_start = lines.len() - pattern.len();
    for idx in start_index..=max_start {
        if matches_at(lines, pattern, idx, &compare) {
            return idx as i64;
        }
    }

    -1
}

fn matches_at<F>(lines: &[String], pattern: &[String], start: usize, compare: &F) -> bool
where
    F: Fn(&str, &str) -> bool,
{
    if start + pattern.len() > lines.len() {
        return false;
    }
    for (offset, pat_line) in pattern.iter().enumerate() {
        if !compare(&lines[start + offset], pat_line) {
            return false;
        }
    }
    true
}

/// Normalize Unicode punctuation to ASCII equivalents.
fn normalize_unicode(input: &str) -> String {
    input
        .replace(['\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}'], "'")
        .replace(['\u{201C}', '\u{201D}', '\u{201E}', '\u{201F}'], "\"")
        .replace(
            [
                '\u{2010}', '\u{2011}', '\u{2012}', '\u{2013}', '\u{2014}', '\u{2015}',
            ],
            "-",
        )
        .replace('\u{2026}', "...")
        .replace('\u{00A0}', " ")
}
