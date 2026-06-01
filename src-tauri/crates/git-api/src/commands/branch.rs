use super::utils::run_git;
use crate::types::*;
use git::types::BranchInfo;
/**
 * Branch Operations
 *
 * Create, delete, checkout, and list branches.
 * All operations use retry logic for transient errors.
 */
use std::path::Path;

impl From<BranchInfo> for GitBranchInfo {
    fn from(b: BranchInfo) -> Self {
        Self {
            name: b.name,
            upstream: b.upstream,
            tip_sha: b.tip_sha,
            branch_type: b.branch_type,
            ref_name: b.ref_name,
            is_current: b.is_current,
            last_commit_date: b.last_commit_date,
        }
    }
}

/// List all branches (local and remote).
///
/// Thin wrapper over the pure helper in `git::branches` that converts the
/// internal `BranchInfo` records into the utoipa-deriving `GitBranchInfo`
/// used in HTTP responses.
pub fn list_branches(repo_path: &Path) -> Result<GitBranchesData, String> {
    let data = git::branches::list_branches(repo_path)?;
    Ok(GitBranchesData {
        branches: data.branches.into_iter().map(GitBranchInfo::from).collect(),
        current_branch: data.current_branch,
    })
}

/// Create a new branch
pub fn create_branch(
    repo_path: &Path,
    name: &str,
    start_point: Option<&str>,
    checkout: bool,
) -> Result<(), String> {
    let mut args = vec!["branch", name];

    if let Some(sp) = start_point {
        args.push(sp);
    }

    let output = run_git(repo_path, &args)?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    if checkout {
        checkout_ref(repo_path, name, false)?;
    }

    Ok(())
}

/// Delete a branch
pub fn delete_branch(repo_path: &Path, branch_name: &str, force: bool) -> Result<(), String> {
    let delete_flag = if force { "-D" } else { "-d" };

    let output = run_git(repo_path, &["branch", delete_flag, branch_name])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

/// Rename a branch
///
/// If `old_name` is None, renames the current branch to `new_name`.
/// If `old_name` is Some, renames that specific branch.
/// If `force` is true, forces the rename even if the new name already exists.
pub fn rename_branch(
    repo_path: &Path,
    old_name: Option<&str>,
    new_name: &str,
    force: bool,
) -> Result<(), String> {
    let rename_flag = if force { "-M" } else { "-m" };

    let mut args = vec!["branch", rename_flag];

    if let Some(old) = old_name {
        args.push(old);
    }
    args.push(new_name);

    let output = run_git(repo_path, &args)?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(())
}

/// Checkout a branch or ref
///
/// Handles remote branches by automatically creating a local tracking branch.
/// For example, checking out "feature-branch" when only "origin/feature-branch" exists
/// will create a local tracking branch.
///
/// If `force` is true, uses `git checkout --force` to discard local changes.
pub fn checkout_ref(repo_path: &Path, ref_name: &str, force: bool) -> Result<(), String> {
    // Build checkout args based on force flag
    let checkout_args = if force {
        vec!["checkout", "--force", ref_name]
    } else {
        vec!["checkout", ref_name]
    };

    // First, try a simple checkout
    let output = run_git(repo_path, &checkout_args)?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Check if the error is because the branch doesn't exist locally
    // but might exist as a remote branch
    if stderr.contains("did not match any file")
        || stderr.contains("pathspec")
        || stderr.contains("not a commit")
    {
        // Try to find a matching remote branch (check common remotes)
        for remote in ["origin", "upstream"] {
            let remote_ref = format!("{}/{}", remote, ref_name);

            // Check if remote branch exists
            let check_output = run_git(
                repo_path,
                &[
                    "show-ref",
                    "--verify",
                    "--quiet",
                    &format!("refs/remotes/{}", remote_ref),
                ],
            );

            if let Ok(check) = check_output {
                if check.status.success() {
                    // Remote branch exists, create local tracking branch
                    log::info!("[GitAPI] Creating local tracking branch for {}", remote_ref);

                    let track_output = run_git(
                        repo_path,
                        &["checkout", "-b", ref_name, "--track", &remote_ref],
                    )?;

                    if track_output.status.success() {
                        return Ok(());
                    }

                    // If that failed (maybe branch already exists), try just checkout with track
                    let track_output2 = run_git(repo_path, &["checkout", "--track", &remote_ref])?;

                    if track_output2.status.success() {
                        return Ok(());
                    }
                }
            }
        }
    }

    // Return original error if we couldn't resolve it
    Err(stderr)
}

/// Get default branch
pub fn get_default_branch(repo_path: &Path, remote: Option<&str>) -> Result<String, String> {
    let remote_name = remote.unwrap_or("origin");

    // Try to get the default branch from remote HEAD
    let remote_head_ref = format!("refs/remotes/{}/HEAD", remote_name);
    if let Ok(output) = run_git(repo_path, &["symbolic-ref", &remote_head_ref]) {
        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Extract branch name from refs/remotes/origin/main -> main
            if let Some(branch) = result.split('/').next_back() {
                return Ok(branch.to_string());
            }
        }
    }

    // Fallback: try common default branch names
    for default_name in ["main", "master"] {
        let ref_path = format!("refs/remotes/{}/{}", remote_name, default_name);
        if let Ok(output) = run_git(repo_path, &["show-ref", "--verify", "--quiet", &ref_path]) {
            if output.status.success() {
                return Ok(default_name.to_string());
            }
        }
    }

    Err("Could not determine default branch".to_string())
}

/// Get current branch with full info
pub fn get_current_branch_info(repo_path: &Path) -> Result<GitBranchInfo, String> {
    // Get all branches
    let branches_data = list_branches(repo_path)?;

    // Find and return the current branch
    branches_data
        .branches
        .into_iter()
        .find(|b| b.is_current)
        .ok_or_else(|| "Current branch not found in branch list".to_string())
}
