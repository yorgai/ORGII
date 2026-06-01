//! Diff numstat operations (per-file stats, no content).

use crate::types::*;
use git2::Repository;
use std::path::Path;

/// Get per-file insertions/deletions without loading full diff content.
/// Much cheaper than batch file diffs for displaying change counts in the sidebar.
pub fn get_diff_numstat(
    repo_path: &Path,
    from_ref: &str,
    to_ref: Option<&str>,
    staged_only: bool,
) -> Result<DiffNumstatResult, String> {
    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repository: {}", e))?;

    let old_tree = super::ref_utils::resolve_from_ref(&repo, from_ref)?;
    let empty_base = super::ref_utils::is_empty_base(from_ref);

    let mut diff_opts = git2::DiffOptions::new();
    if empty_base {
        diff_opts.include_untracked(true);
    }

    let diff = if staged_only {
        let index = repo
            .index()
            .map_err(|e| format!("Failed to get index: {}", e))?;
        repo.diff_tree_to_index(old_tree.as_ref(), Some(&index), Some(&mut diff_opts))
            .map_err(|e| format!("Failed to create diff: {}", e))?
    } else {
        match to_ref {
            Some(ref_name) if ref_name != "WORKING" && ref_name != "WORKDIR" => {
                let obj = repo
                    .revparse_single(ref_name)
                    .map_err(|e| format!("Failed to resolve ref '{}': {}", ref_name, e))?;
                let commit = obj
                    .peel_to_commit()
                    .map_err(|e| format!("Failed to get commit: {}", e))?;
                let new_tree = commit
                    .tree()
                    .map_err(|e| format!("Failed to get tree: {}", e))?;
                repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut diff_opts))
                    .map_err(|e| format!("Failed to create diff: {}", e))?
            }
            _ => repo
                .diff_tree_to_workdir_with_index(old_tree.as_ref(), Some(&mut diff_opts))
                .map_err(|e| format!("Failed to create diff: {}", e))?,
        }
    };

    let mut files = Vec::new();
    let mut total_insertions: u32 = 0;
    let mut total_deletions: u32 = 0;

    let num_deltas = diff.deltas().len();
    for idx in 0..num_deltas {
        let delta = diff.get_delta(idx).unwrap();
        let patch = git2::Patch::from_diff(&diff, idx)
            .map_err(|e| format!("Failed to get patch: {}", e))?;

        let (ins, del) = if let Some(ref patch) = patch {
            let (_, adds, dels) = patch
                .line_stats()
                .map_err(|e| format!("Failed to get line stats: {}", e))?;
            (adds as u32, dels as u32)
        } else {
            (0, 0)
        };

        let new_file = delta.new_file();
        let path = new_file
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "renamed",
            git2::Delta::Copied => "copied",
            _ => "modified",
        };

        let binary = delta.flags().contains(git2::DiffFlags::BINARY);

        total_insertions += ins;
        total_deletions += del;

        files.push(FileNumstat {
            path,
            status: status.to_string(),
            insertions: ins,
            deletions: del,
            binary,
        });
    }

    Ok(DiffNumstatResult {
        files,
        total_insertions,
        total_deletions,
        files_changed: num_deltas as u32,
    })
}

/// Combined numstat result for both staged and unstaged changes.
/// Merged in Rust to avoid 2 separate IPC calls from frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedDiffNumstatResult {
    /// Per-file stats with merged staged+unstaged counts
    pub files: Vec<FileNumstat>,
    /// Total insertions (staged + unstaged)
    pub total_insertions: u32,
    /// Total deletions (staged + unstaged)
    pub total_deletions: u32,
    /// Total files changed
    pub files_changed: u32,
}

/// Get combined numstat for both staged and unstaged changes in a single call.
///
/// This is a performance optimization that replaces 2 separate API calls
/// (one for unstaged, one for staged) with a single call that returns
/// merged results.
pub fn get_diff_numstat_combined(
    repo_path: &Path,
    from_ref: &str,
) -> Result<CombinedDiffNumstatResult, String> {
    use std::collections::HashMap;

    // Get unstaged changes (working directory vs HEAD)
    let unstaged = get_diff_numstat(repo_path, from_ref, None, false)?;

    // Get staged changes (index vs HEAD)
    let staged = get_diff_numstat(repo_path, from_ref, None, true)?;

    // Merge results: combine stats for files that appear in both
    let mut file_map: HashMap<String, FileNumstat> = HashMap::new();

    // Add unstaged files first
    for file in unstaged.files {
        file_map.insert(file.path.clone(), file);
    }

    // Merge staged files
    for file in staged.files {
        if let Some(existing) = file_map.get_mut(&file.path) {
            // File exists in both: add counts
            existing.insertions += file.insertions;
            existing.deletions += file.deletions;
        } else {
            // File only in staged
            file_map.insert(file.path.clone(), file);
        }
    }

    // Convert back to Vec and sort by path
    let mut files: Vec<FileNumstat> = file_map.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    // Calculate totals
    let total_insertions: u32 = files.iter().map(|f| f.insertions).sum();
    let total_deletions: u32 = files.iter().map(|f| f.deletions).sum();
    let files_changed = files.len() as u32;

    Ok(CombinedDiffNumstatResult {
        files,
        total_insertions,
        total_deletions,
        files_changed,
    })
}
