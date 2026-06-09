//! Commit diff operations.

use crate::types::*;
use git2::{DiffOptions, Repository};
use std::path::Path;

use super::diff_ops::{collect_batch_diff, format_time};

const COMMIT_PARENT_MODE_FIRST_PARENT: &str = "first-parent";
const COMMIT_PARENT_MODE_SELECTED_PARENT: &str = "selected-parent";
const COMMIT_PARENT_MODE_ROOT_COMMIT: &str = "root-commit";

/// Get diff for a commit (against its parent)
pub fn get_commit_diff(
    repo_path: &Path,
    commit_sha: &str,
    parent_index: Option<usize>,
    context_lines: u32,
) -> Result<CommitDiffResult, String> {
    eprintln!(
        "[git_diff] commit_diff_start repo_path={} commit_sha={} parent_index={:?}",
        repo_path.display(),
        commit_sha,
        parent_index
    );
    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let obj = repo
        .revparse_single(commit_sha)
        .map_err(|e| format!("Failed to resolve commit '{}': {}", commit_sha, e))?;

    let commit = obj
        .peel_to_commit()
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;

    // Get parent tree (if exists), optionally selecting a specific parent for merge commits.
    let selected_parent_index = if commit.parent_count() == 0 {
        None
    } else {
        let requested_parent_index = parent_index.unwrap_or(0);
        if requested_parent_index >= commit.parent_count() {
            return Err(format!(
                "Failed to get parent: parent index {} out of range for commit {} with {} parents",
                requested_parent_index,
                commit_sha,
                commit.parent_count()
            ));
        }
        Some(requested_parent_index)
    };

    let parent_tree = if let Some(index) = selected_parent_index {
        let parent = commit
            .parent(index)
            .map_err(|e| format!("Failed to get parent: {}", e))?;
        Some(
            parent
                .tree()
                .map_err(|e| format!("Failed to get parent tree: {}", e))?,
        )
    } else {
        None
    };

    let mut diff_opts = DiffOptions::new();
    diff_opts.context_lines(context_lines);

    let mut diff = repo
        .diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&commit_tree),
            Some(&mut diff_opts),
        )
        .map_err(|e| format!("Failed to create diff: {}", e))?;

    diff.find_similar(None)
        .map_err(|e| format!("Failed to detect renames: {}", e))?;

    let batch_result = collect_batch_diff(&repo, diff)?;

    // Build author info
    let author_sig = commit.author();
    let committer_sig = commit.committer();

    let author = Some(GitCommitAuthor {
        name: author_sig.name().unwrap_or("Unknown").to_string(),
        email: author_sig.email().unwrap_or("").to_string(),
        date: format_time(author_sig.when()),
    });

    let committer = Some(GitCommitAuthor {
        name: committer_sig.name().unwrap_or("Unknown").to_string(),
        email: committer_sig.email().unwrap_or("").to_string(),
        date: format_time(committer_sig.when()),
    });

    // Collect parent SHAs
    let parent_shas: Vec<String> = (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|id| id.to_string())
        .collect();

    let parent_sha = selected_parent_index.and_then(|index| parent_shas.get(index).cloned());

    let parent_mode = match selected_parent_index {
        Some(0) if parent_index.is_none() => COMMIT_PARENT_MODE_FIRST_PARENT,
        Some(_) => COMMIT_PARENT_MODE_SELECTED_PARENT,
        None => COMMIT_PARENT_MODE_ROOT_COMMIT,
    };
    eprintln!(
        "[git_diff] commit_diff_mode commit_sha={} mode={} selected_parent_index={:?}",
        commit_sha, parent_mode, selected_parent_index
    );

    Ok(CommitDiffResult {
        commit_sha: commit.id().to_string(),
        short_sha: commit.id().to_string()[..7].to_string(),
        parent_sha,
        parent_shas,
        selected_parent_index,
        parent_mode: parent_mode.to_string(),
        summary: commit.summary().unwrap_or("").to_string(),
        body: commit.body().unwrap_or("").to_string(),
        author,
        committer,
        files: batch_result.files,
        stats: batch_result.stats,
    })
}
