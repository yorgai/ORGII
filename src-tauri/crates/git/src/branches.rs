//! Branch listing and current-branch resolution.
//!
//! Pure git-shell helpers used by both the HTTP/Tauri layer in `api::git`
//! and internal call sites in the `git` core (e.g. bundle export).
//!
//! Lives in the `git` core so the module stays a true leaf — `api::git`
//! depends on this layer, not the other way around.

use std::path::Path;

use super::types::{BranchInfo, BranchesData};
use super::util::{run_git, run_git_with_retry};

/// Get current branch name with retry logic.
///
/// On a repo with no commits yet, `git rev-parse --abbrev-ref HEAD` returns
/// the literal string "HEAD" because the branch ref doesn't exist yet.
/// In that case we fall back to reading `.git/HEAD` directly which contains
/// `ref: refs/heads/<branch>` so we can still surface the intended branch name.
pub fn get_current_branch(repo_path: &Path) -> Result<String, String> {
    let output = run_git_with_retry(repo_path, &["rev-parse", "--abbrev-ref", "HEAD"], 3)?;

    if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // "HEAD" means the branch exists in .git/HEAD but has no commits yet —
        // read the symbolic ref directly.
        if name != "HEAD" {
            return Ok(name);
        }
    }

    // Fallback: parse .git/HEAD for unborn branches ("ref: refs/heads/<name>")
    let head_file = repo_path.join(".git").join("HEAD");
    if let Ok(contents) = std::fs::read_to_string(&head_file) {
        let trimmed = contents.trim();
        if let Some(branch) = trimmed.strip_prefix("ref: refs/heads/") {
            return Ok(branch.to_string());
        }
    }

    // Last resort: return the raw output or the error
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// List all branches (local and remote).
pub fn list_branches(repo_path: &Path) -> Result<BranchesData, String> {
    let current_branch = get_current_branch(repo_path)?;

    // Format: refname|refname:short|objectname|upstream:short|HEAD|committerdate:iso-strict
    // Note: iso-strict outputs dates like "2024-12-28T15:30:00+08:00" which JavaScript can parse
    let output = run_git(repo_path, &[
        "branch",
        "-a",
        "--format=%(refname)|%(refname:short)|%(objectname:short)|%(upstream:short)|%(HEAD)|%(committerdate:iso-strict)"
    ])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 5 {
            continue;
        }

        let ref_name = parts[0].trim().to_string();
        let name = parts[1].trim().to_string();
        let tip_sha = parts[2].trim().to_string();
        let upstream = {
            let u = parts[3].trim();
            if u.is_empty() {
                None
            } else {
                Some(u.to_string())
            }
        };
        let is_current = parts[4].trim() == "*";
        let last_commit_date = if parts.len() > 5 && !parts[5].trim().is_empty() {
            Some(parts[5].trim().to_string())
        } else {
            None
        };

        let branch_type = if ref_name.starts_with("refs/remotes/") {
            "remote".to_string()
        } else {
            "local".to_string()
        };

        // Skip HEAD -> origin/main entries
        if name.contains("HEAD ->") || name == "HEAD" {
            continue;
        }

        branches.push(BranchInfo {
            name,
            upstream,
            tip_sha,
            branch_type,
            ref_name,
            is_current,
            last_commit_date,
        });
    }

    // On a repo with no commits yet, `git branch -a` outputs nothing.
    // Synthesize a branch entry so the UI can still display the branch name.
    if branches.is_empty() && !current_branch.is_empty() && current_branch != "HEAD" {
        branches.push(BranchInfo {
            name: current_branch.clone(),
            upstream: None,
            tip_sha: String::new(),
            branch_type: "local".to_string(),
            ref_name: format!("refs/heads/{}", current_branch),
            is_current: true,
            last_commit_date: None,
        });
    }

    Ok(BranchesData {
        branches,
        current_branch,
    })
}
