//! Compute cumulative diff stats between a base branch and a work item branch.
//!
//! Runs `git diff --numstat -M <base>..<branch>` and parses the output into
//! a `WorkItemDiffStats` struct with per-file breakdown.

use git::git_command;
use std::path::Path;

use crate::projects::types::{FileChange, FileChangeStatus, WorkItemDiffStats};

/// Compute diff stats between `base_branch` and `work_item_branch`.
///
/// The diff is cumulative: it shows ALL changes the work item branch has relative
/// to the base, regardless of how many SDE sessions contributed those changes.
pub fn compute_diff_stats(
    repo_path: &str,
    base_branch: &str,
    work_item_branch: &str,
) -> Result<WorkItemDiffStats, String> {
    let repo = Path::new(repo_path);
    let range = format!("{}..{}", base_branch, work_item_branch);

    let output = git_command()?
        .args(["diff", "--numstat", "-M", &range])
        .current_dir(repo)
        .output()
        .map_err(|err| format!("Failed to run git diff: {}", err))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let all_files = parse_numstat(&stdout, repo, base_branch, work_item_branch)?;

    let files: Vec<FileChange> = all_files
        .into_iter()
        .filter(|f| !is_infrastructure_file(&f.path))
        .collect();

    let total_added: u32 = files.iter().map(|f| f.lines_added).sum();
    let total_removed: u32 = files.iter().map(|f| f.lines_removed).sum();

    Ok(WorkItemDiffStats {
        files_changed: files.len() as u32,
        lines_added: total_added,
        lines_removed: total_removed,
        files,
    })
}

/// Parse `git diff --numstat -M` output into FileChange entries.
///
/// Each line is: `<added>\t<removed>\t<path>` (or `<added>\t<removed>\t<old>{...}<new>` for renames)
/// Binary files show `-\t-\t<path>`.
fn parse_numstat(
    numstat_output: &str,
    repo: &Path,
    base_branch: &str,
    work_item_branch: &str,
) -> Result<Vec<FileChange>, String> {
    let mut files = Vec::new();

    for line in numstat_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }

        let added = parts[0].parse::<u32>().unwrap_or(0);
        let removed = parts[1].parse::<u32>().unwrap_or(0);
        let path_part = parts[2];

        if path_part.contains(" => ") {
            let (old_path, new_path) = parse_rename_path(path_part);
            files.push(FileChange {
                path: new_path,
                status: FileChangeStatus::Renamed,
                lines_added: added,
                lines_removed: removed,
                old_path: Some(old_path),
            });
        } else {
            let status = determine_file_status(repo, base_branch, work_item_branch, path_part);
            files.push(FileChange {
                path: path_part.to_string(),
                status,
                lines_added: added,
                lines_removed: removed,
                old_path: None,
            });
        }
    }

    files.sort_by(|a, b| {
        let status_order = |s: &FileChangeStatus| -> u8 {
            match s {
                FileChangeStatus::Added => 0,
                FileChangeStatus::Modified => 1,
                FileChangeStatus::Renamed => 2,
                FileChangeStatus::Deleted => 3,
            }
        };
        status_order(&a.status)
            .cmp(&status_order(&b.status))
            .then(a.path.cmp(&b.path))
    });

    Ok(files)
}

/// Parse git rename notation: `{old => new}/path` or `path/{old => new}` or `old => new`
pub(crate) fn parse_rename_path(path_part: &str) -> (String, String) {
    if let Some(brace_start) = path_part.find('{') {
        if let Some(brace_end) = path_part.find('}') {
            let prefix = &path_part[..brace_start];
            let suffix = &path_part[brace_end + 1..];
            let inner = &path_part[brace_start + 1..brace_end];
            if let Some(arrow_pos) = inner.find(" => ") {
                let old_inner = &inner[..arrow_pos];
                let new_inner = &inner[arrow_pos + 4..];
                let old_path = format!("{}{}{}", prefix, old_inner, suffix);
                let new_path = format!("{}{}{}", prefix, new_inner, suffix);
                return (old_path, new_path);
            }
        }
    }
    if let Some(arrow_pos) = path_part.find(" => ") {
        let old_path = path_part[..arrow_pos].to_string();
        let new_path = path_part[arrow_pos + 4..].to_string();
        return (old_path, new_path);
    }
    (path_part.to_string(), path_part.to_string())
}

/// Determine if a file was added, modified, or deleted by checking if it exists
/// on each side of the diff.
fn determine_file_status(
    repo: &Path,
    base_branch: &str,
    work_item_branch: &str,
    path: &str,
) -> FileChangeStatus {
    let exists_on_base = file_exists_on_branch(repo, base_branch, path);
    let exists_on_branch = file_exists_on_branch(repo, work_item_branch, path);

    match (exists_on_base, exists_on_branch) {
        (false, true) => FileChangeStatus::Added,
        (true, false) => FileChangeStatus::Deleted,
        _ => FileChangeStatus::Modified,
    }
}

fn file_exists_on_branch(repo: &Path, branch: &str, path: &str) -> bool {
    let ref_path = format!("{}:{}", branch, path);
    let Ok(mut command) = git_command() else {
        return false;
    };
    command
        .args(["cat-file", "-t", &ref_path])
        .current_dir(repo)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Filter out workspace infrastructure files that are not part of the SDE's code changes.
pub(crate) fn is_infrastructure_file(path: &str) -> bool {
    path.starts_with(".orgii/") || path == ".orgii"
}
