//! Diff summary operations (stats only, no content).

use crate::types::GitDiffStats;
use git2::Repository;
use std::path::Path;

/// Get diff summary between two refs (stats only)
pub fn get_diff_summary(
    repo_path: &Path,
    from_ref: &str,
    to_ref: Option<&str>,
) -> Result<GitDiffStats, String> {
    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    // Get old tree
    let old_tree = {
        let obj = repo
            .revparse_single(from_ref)
            .map_err(|e| format!("Failed to resolve ref '{}': {}", from_ref, e))?;
        let commit = obj
            .peel_to_commit()
            .map_err(|e| format!("Failed to get commit: {}", e))?;
        commit
            .tree()
            .map_err(|e| format!("Failed to get tree: {}", e))?
    };

    // Get new tree or workdir
    let new_tree = match to_ref {
        Some(ref_name) if ref_name != "WORKING" && ref_name != "WORKDIR" => {
            let obj = repo
                .revparse_single(ref_name)
                .map_err(|e| format!("Failed to resolve ref '{}': {}", ref_name, e))?;
            let commit = obj
                .peel_to_commit()
                .map_err(|e| format!("Failed to get commit: {}", e))?;
            Some(
                commit
                    .tree()
                    .map_err(|e| format!("Failed to get tree: {}", e))?,
            )
        }
        _ => None,
    };

    let diff = if new_tree.is_some() {
        repo.diff_tree_to_tree(Some(&old_tree), new_tree.as_ref(), None)
            .map_err(|e| format!("Failed to create diff: {}", e))?
    } else {
        repo.diff_tree_to_workdir_with_index(Some(&old_tree), None)
            .map_err(|e| format!("Failed to create diff: {}", e))?
    };

    let stats = diff
        .stats()
        .map_err(|e| format!("Failed to get diff stats: {}", e))?;

    Ok(GitDiffStats {
        insertions: stats.insertions() as u32,
        deletions: stats.deletions() as u32,
        files_changed: stats.files_changed() as u32,
    })
}
