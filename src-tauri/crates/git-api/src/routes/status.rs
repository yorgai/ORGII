//! Status Routes
//!
//! Repository status, ahead/behind, default branch, local commits

use axum::{
    extract::{Path, Query},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path, RepoQuery};
use crate::types::*;
use git::watch::git_status::refresh_git_status_sync;

pub fn routes() -> Router {
    Router::new()
        .route("/api/git/repo/{repo_id}/status", get(get_status))
        .route(
            "/api/git/repo/{repo_id}/ahead-behind",
            get(get_ahead_behind),
        )
        .route(
            "/api/git/repo/{repo_id}/default-branch",
            get(get_default_branch),
        )
        .route(
            "/api/git/repo/{repo_id}/local-commits",
            get(get_local_commits),
        )
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct StatusQuery {
    #[allow(dead_code)]
    include_untracked: Option<bool>,
    path: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct DefaultBranchQuery {
    path: Option<String>,
    remote: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct LocalCommitsQuery {
    path: Option<String>,
    branch: Option<String>,
}

// ============================================
// Handlers
// ============================================

/// Get repository status
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/status",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Git status retrieved successfully", body = GitStatusResponse),
        (status = 400, description = "Git error occurred")
    ),
    tag = "status"
)]
pub async fn get_status(
    Path(repo_id): Path<String>,
    Query(query): Query<StatusQuery>,
) -> GitApiResult<Json<GitStatusResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    // A tracked folder the user created directly (never `git init`'d) has no
    // `.git`. Running `git status` on it fails with "not a git repository",
    // which the frontend would otherwise surface as a recurring error popup.
    // Treat the absence of `.git` as a benign, first-class "no git" state
    // (HTTP 200, `exists: false`) so the UI can render it cleanly instead of
    // entering an infinite error-retry loop. Real git failures (corrupt repo,
    // permission errors) still propagate through the error path below.
    if !repo_path.join(".git").exists() {
        return Ok(Json(GitStatusResponse {
            status: 0,
            data: GitStatus {
                current_branch: String::new(),
                current_upstream_branch: None,
                current_tip: String::new(),
                branch_ahead_behind: None,
                exists: false,
                merge_head_found: false,
                squash_msg_found: false,
                rebase_in_progress: false,
                cherry_pick_in_progress: false,
                working_directory: WorkingDirectory {
                    files: Vec::new(),
                    staged_count: 0,
                    unstaged_count: 0,
                    untracked_count: 0,
                },
                do_conflicted_files_exist: false,
            },
        }));
    }

    let rust_status = refresh_git_status_sync(&repo_path).map_err(GitApiError::from_git_error)?;

    // A silent empty-Vec fallback would render a "no changes"
    // file list while `rust_status` (which succeeded above) might
    // report dirty counts — confusing the UI panel. Warn on the
    // Err branch so the inconsistency between `rust_status` and
    // `files` is visible while still rendering the rest of the
    // status snapshot.
    let files: Vec<crate::types::WorkingDirectoryFile> =
        match git::watch::git_status::get_detailed_file_status_sync(&repo_path) {
            Ok(f) => f.into_iter().map(Into::into).collect(),
            Err(err) => {
                tracing::warn!(
                    repo = %repo_path.display(),
                    error = %err,
                    "git::status: get_detailed_file_status failed; rendering with empty file list"
                );
                Vec::new()
            }
        };

    let current_upstream_branch = git::watch::git_status::get_upstream_branch(&repo_path);

    // Check for merge/rebase/cherry-pick state
    let git_dir = repo_path.join(".git");
    let merge_head_found = git_dir.join("MERGE_HEAD").exists();
    let squash_msg_found = git_dir.join("SQUASH_MSG").exists();
    let rebase_in_progress =
        git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists();
    let cherry_pick_in_progress = git_dir.join("CHERRY_PICK_HEAD").exists();

    let has_conflicted_files = rust_status.conflicted > 0 || files.iter().any(|f| f.status == "U");

    let status = GitStatus {
        current_branch: rust_status.branch,
        current_upstream_branch,
        current_tip: rust_status.last_commit_hash,
        branch_ahead_behind: Some(AheadBehind {
            ahead: rust_status.ahead,
            behind: rust_status.behind,
        }),
        exists: true,
        merge_head_found,
        squash_msg_found,
        rebase_in_progress,
        cherry_pick_in_progress,
        working_directory: WorkingDirectory {
            files,
            staged_count: rust_status.staged,
            unstaged_count: rust_status.unstaged,
            untracked_count: rust_status.untracked,
        },
        do_conflicted_files_exist: has_conflicted_files,
    };

    Ok(Json(GitStatusResponse {
        status: 0,
        data: status,
    }))
}

/// Get ahead/behind counts
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/ahead-behind",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Ahead/behind counts retrieved", body = AheadBehindResponse)
    ),
    tag = "status"
)]
pub async fn get_ahead_behind(
    Path(repo_id): Path<String>,
    Query(query): Query<RepoQuery>,
) -> GitApiResult<Json<AheadBehindResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let rust_status = refresh_git_status_sync(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(AheadBehindResponse {
        status: 0,
        data: AheadBehind {
            ahead: rust_status.ahead,
            behind: rust_status.behind,
        },
    }))
}

/// Get default branch
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/default-branch",
    params(
        ("repo_id" = String, Path, description = "Repository ID"),
        ("path" = Option<String>, Query, description = "Repository path"),
        ("remote" = Option<String>, Query, description = "Remote name"),
    ),
    responses(
        (status = 200, description = "Default branch name")
    ),
    tag = "branches"
)]
pub async fn get_default_branch(
    Path(repo_id): Path<String>,
    Query(query): Query<DefaultBranchQuery>,
) -> GitApiResult<Json<serde_json::Value>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let branch = crate::commands::get_default_branch(&repo_path, query.remote.as_deref())
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(serde_json::json!({
        "status": 0,
        "data": { "name": branch }
    })))
}

/// Get local (unpushed) commits
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/local-commits",
    params(
        ("repo_id" = String, Path, description = "Repository ID"),
        ("path" = Option<String>, Query, description = "Repository path"),
        ("branch" = Option<String>, Query, description = "Branch name"),
    ),
    responses(
        (status = 200, description = "Local commits", body = CommitsResponse)
    ),
    tag = "commits"
)]
pub async fn get_local_commits(
    Path(repo_id): Path<String>,
    Query(query): Query<LocalCommitsQuery>,
) -> GitApiResult<Json<CommitsResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let commits_data = crate::commands::get_local_commits(&repo_path, query.branch.as_deref())
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(CommitsResponse {
        status: 0,
        data: commits_data,
    }))
}

// ============================================
// Helper
// ============================================

/// Resolve repository path from query param or repo_id lookup
fn resolve_repo_path(repo_id: &str, query_path: Option<&str>) -> GitApiResult<std::path::PathBuf> {
    if let Some(path) = query_path {
        validate_path(path)
    } else {
        lookup_repo_path(repo_id)
    }
}
