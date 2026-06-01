use super::utils::run_git;
use crate::types::*;
/**
 * Stash Operations
 *
 * Save, list, apply, and drop stashes.
 * All operations use retry logic for transient errors.
 */
use std::path::Path;

/// Create a stash
pub fn stash_push(
    repo_path: &Path,
    files: Option<&[String]>,
    message: Option<&str>,
    include_untracked: bool,
) -> Result<GitStashResult, String> {
    let mut args = vec!["stash", "push"];

    if include_untracked {
        args.push("--include-untracked");
    }

    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    }

    // If specific files are provided, add them
    if let Some(file_list) = files {
        args.push("--");
        for file in file_list {
            args.push(file);
        }
    }

    let output = run_git(repo_path, &args)?;

    let message_out = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    };

    Ok(GitStashResult {
        success: true,
        message: message_out,
        stash_ref: Some("stash@{0}".to_string()),
    })
}

/// List stashes
pub fn stash_list(repo_path: &Path) -> Result<Vec<StashEntry>, String> {
    let output = run_git(repo_path, &["stash", "list", "--format=%gd|%s|%gs"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut stashes = Vec::new();

    for (index, line) in stdout.lines().enumerate() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() < 2 {
            continue;
        }

        stashes.push(StashEntry {
            index: index as u32,
            message: parts.get(2).unwrap_or(&parts[1]).to_string(),
            branch: None,
            commit_sha: None,
        });
    }

    Ok(stashes)
}

/// Apply a stash
pub fn stash_apply(repo_path: &Path, index: u32, pop: bool) -> Result<GitStashResult, String> {
    let stash_ref = format!("stash@{{{}}}", index);
    let command = if pop { "pop" } else { "apply" };

    let output = run_git(repo_path, &["stash", command, &stash_ref])?;

    let message = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    };

    Ok(GitStashResult {
        success: true,
        message,
        stash_ref: Some(stash_ref),
    })
}

/// Drop a stash
pub fn stash_drop(repo_path: &Path, index: u32) -> Result<GitStashResult, String> {
    let stash_ref = format!("stash@{{{}}}", index);

    let output = run_git(repo_path, &["stash", "drop", &stash_ref])?;

    let message = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    };

    Ok(GitStashResult {
        success: true,
        message,
        stash_ref: Some(stash_ref),
    })
}

/// Clear all stashes
pub fn stash_clear(repo_path: &Path) -> Result<GitStashResult, String> {
    let output = run_git(repo_path, &["stash", "clear"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(GitStashResult {
        success: true,
        message: "All stashes cleared".to_string(),
        stash_ref: None,
    })
}
