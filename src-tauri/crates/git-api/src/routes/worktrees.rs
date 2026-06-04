//! Worktree Routes
//!
//! Lists git worktrees registered for a repository.

use axum::{
    extract::{Path, Query},
    routing::{delete, get},
    Json, Router,
};
use serde::Deserialize;

use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::{
    RemoveWorktreeRequest, WorktreeEntry, WorktreeListResponse, WorktreeRemoveResponse,
};

pub fn routes() -> Router {
    Router::new()
        .route("/api/git/repo/{repo_id}/worktrees", get(get_worktrees))
        .route("/api/git/repo/{repo_id}/worktrees", delete(remove_worktree))
}

#[derive(Debug, Deserialize, Default)]
pub struct WorktreesQuery {
    path: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/worktrees",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or path"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "List of git worktrees", body = WorktreeListResponse)
    ),
    tag = "worktrees"
)]
pub async fn get_worktrees(
    Path(repo_id): Path<String>,
    Query(query): Query<WorktreesQuery>,
) -> GitApiResult<Json<WorktreeListResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;
    let entries =
        git::worktree::list_all_worktrees(&repo_path).map_err(GitApiError::from_git_error)?;

    let data = entries
        .into_iter()
        .map(|entry| WorktreeEntry {
            path: entry.path,
            branch: entry.branch,
            head_sha: entry.head_sha,
            is_main: entry.is_main,
        })
        .collect();

    Ok(Json(WorktreeListResponse { status: 0, data }))
}

#[utoipa::path(
    delete,
    path = "/api/git/repo/{repo_id}/worktrees",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or path"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = RemoveWorktreeRequest,
    responses(
        (status = 200, description = "Removed git worktree", body = WorktreeRemoveResponse)
    ),
    tag = "worktrees"
)]
pub async fn remove_worktree(
    Path(repo_id): Path<String>,
    Query(query): Query<WorktreesQuery>,
    Json(request): Json<RemoveWorktreeRequest>,
) -> GitApiResult<Json<WorktreeRemoveResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;
    let worktree_path = validate_path(&request.worktree_path)?;

    git::worktree::remove_worktree_path(&repo_path, &worktree_path, request.force)
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(WorktreeRemoveResponse {
        status: 0,
        data: WorktreeEntry {
            path: request.worktree_path,
            branch: String::new(),
            head_sha: String::new(),
            is_main: false,
        },
    }))
}

fn resolve_repo_path(repo_id: &str, query_path: Option<&str>) -> GitApiResult<std::path::PathBuf> {
    if let Some(path) = query_path {
        validate_path(path)
    } else {
        lookup_repo_path(repo_id)
    }
}
