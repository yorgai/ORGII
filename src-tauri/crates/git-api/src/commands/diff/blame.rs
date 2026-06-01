//! Git blame operations using git2.

use crate::types::*;
use git2::{BlameOptions, Repository};
use std::path::Path;

use super::diff_ops::format_time;

/// Get blame information for a file using git2
pub fn get_blame(
    repo_path: &Path,
    file_path: &str,
    git_ref: Option<&str>,
) -> Result<GitBlameResult, String> {
    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let mut blame_opts = BlameOptions::new();

    // If a ref is specified, blame up to that commit
    if let Some(ref_name) = git_ref {
        let obj = repo
            .revparse_single(ref_name)
            .map_err(|e| format!("Failed to resolve ref '{}': {}", ref_name, e))?;
        let oid = obj.id();
        blame_opts.newest_commit(oid);
    }

    let blame = repo
        .blame_file(Path::new(file_path), Some(&mut blame_opts))
        .map_err(|e| format!("Failed to get blame: {}", e))?;

    // Read file content using the SAME repo handle (avoids opening a second
    // Repository which doubles file-descriptor usage and can cause "bad descriptor").
    // When no ref is given, blame_file operates on the working-tree version,
    // so we must read the working-tree file to keep line numbers aligned.
    let file_content_string = if let Some(ref_name) = git_ref {
        // Read from the specified ref using the already-open repo
        let obj = repo
            .revparse_single(ref_name)
            .map_err(|e| format!("Failed to resolve ref '{}': {}", ref_name, e))?;
        let commit = obj
            .peel_to_commit()
            .map_err(|e| format!("Failed to get commit: {}", e))?;
        let tree = commit
            .tree()
            .map_err(|e| format!("Failed to get tree: {}", e))?;
        match tree.get_path(Path::new(file_path)) {
            Ok(entry) => {
                let blob = repo
                    .find_blob(entry.id())
                    .map_err(|e| format!("Failed to get blob: {}", e))?;
                String::from_utf8_lossy(blob.content()).to_string()
            }
            Err(err) => {
                tracing::warn!(
                    file_path = %file_path,
                    git_ref = %ref_name,
                    error = %err,
                    "git::blame: tree.get_path failed; rendering blame without line content"
                );
                String::new()
            }
        }
    } else {
        // No ref — blame uses working tree, so read the working-tree file from disk.
        // A silent empty fallback would render every blame line with empty
        // content text, which the UI would show as a blank file with
        // hover-only authorship — confusing the user about whether the
        // file genuinely is empty or if we couldn't read it. Warn so a
        // transient FS issue is visible in logs while still degrading
        // gracefully (the per-line authorship metadata is still useful).
        let full_path = repo_path.join(file_path);
        match std::fs::read_to_string(&full_path) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    path = %full_path.display(),
                    error = %err,
                    "git::blame: working-tree read failed; rendering blame without line content"
                );
                String::new()
            }
        }
    };

    let content_lines: Vec<&str> = file_content_string.lines().collect();
    let mut lines = Vec::new();

    // blame.iter() yields hunks (contiguous ranges of lines from the same commit),
    // NOT individual lines. Each hunk must be expanded into per-line entries.
    for hunk in blame.iter() {
        let commit_id = hunk.final_commit_id();
        let sig = hunk.final_signature();
        let start_line = hunk.final_start_line(); // 1-indexed
        let num_lines = hunk.lines_in_hunk();

        // Get commit summary (once per hunk, since all lines share the same commit)
        let summary = match repo.find_commit(commit_id) {
            Ok(commit) => commit.summary().unwrap_or("").to_string(),
            Err(err) => {
                tracing::warn!(
                    commit = %commit_id,
                    error = %err,
                    "git::blame: find_commit failed; rendering hunk without commit summary"
                );
                String::new()
            }
        };

        let commit_sha_str = commit_id.to_string();
        let short_sha = commit_sha_str[..7].to_string();
        let author = sig.name().unwrap_or("Unknown").to_string();
        let author_email = sig.email().unwrap_or("").to_string();
        let author_time = format_time(sig.when());

        for line_offset in 0..num_lines {
            let line_num = start_line + line_offset; // 1-indexed
            if line_num == 0 {
                continue;
            } // guard against unexpected 0
            let line_content = content_lines
                .get(line_num - 1) // 0-indexed access
                .map(|s| s.to_string())
                .unwrap_or_default();

            lines.push(GitBlameLineInfo {
                line_number: line_num as u32,
                content: line_content,
                commit_sha: commit_sha_str.clone(),
                short_sha: short_sha.clone(),
                author: author.clone(),
                author_email: author_email.clone(),
                author_time: author_time.clone(),
                summary: summary.clone(),
                original_line: (hunk.orig_start_line() + line_offset) as u32,
            });
        }
    }

    let total_lines = lines.len() as u32;

    Ok(GitBlameResult {
        file_path: file_path.to_string(),
        git_ref: git_ref.unwrap_or("HEAD").to_string(),
        lines,
        total_lines,
    })
}
