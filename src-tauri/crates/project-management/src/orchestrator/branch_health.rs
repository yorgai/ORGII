//! Branch health checks — validate Git branch state before retry/resume.

use git::git_command;
use std::path::Path;

/// Result of a branch health check.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchHealthResult {
    pub branch_exists: bool,
    pub is_clean: bool,
    pub has_external_modifications: bool,
    pub has_merge_conflicts: bool,
    pub details: String,
}

impl BranchHealthResult {
    pub fn is_healthy(&self) -> bool {
        self.branch_exists && !self.has_merge_conflicts
    }
}

/// Check the health of a Git branch before retrying or resuming a workflow.
pub fn check_branch_health(repo_path: &str, branch: &str) -> BranchHealthResult {
    let repo = Path::new(repo_path);

    let branch_exists = git_branch_exists(repo, branch);
    if !branch_exists {
        return BranchHealthResult {
            branch_exists: false,
            is_clean: false,
            has_external_modifications: false,
            has_merge_conflicts: false,
            details: format!("Branch '{}' does not exist", branch),
        };
    }

    let is_clean = git_is_clean(repo);
    let has_merge_conflicts = git_has_merge_conflicts(repo);

    BranchHealthResult {
        branch_exists: true,
        is_clean,
        has_external_modifications: false,
        has_merge_conflicts,
        details: if has_merge_conflicts {
            "Branch has unresolved merge conflicts".to_string()
        } else if !is_clean {
            "Branch has uncommitted changes".to_string()
        } else {
            "Branch is healthy".to_string()
        },
    }
}

fn git_branch_exists(repo: &Path, branch: &str) -> bool {
    let Ok(mut command) = git_command() else {
        return false;
    };
    command
        .args(["rev-parse", "--verify", branch])
        .current_dir(repo)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_is_clean(repo: &Path) -> bool {
    let Ok(mut command) = git_command() else {
        return false;
    };
    command
        .args(["status", "--porcelain"])
        .current_dir(repo)
        .output()
        .map(|output| output.stdout.is_empty())
        .unwrap_or(false)
}

fn git_has_merge_conflicts(repo: &Path) -> bool {
    let Ok(mut command) = git_command() else {
        return false;
    };
    command
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(repo)
        .output()
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(false)
}
