//! Stash Routes
//!
//! Stash operations: list, push, apply, drop

use axum::{
    extract::{Path, Query},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::commands;
use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::*;

pub fn routes() -> Router {
    Router::new()
        .route("/api/git/repo/{repo_id}/stash", get(stash_list))
        .route("/api/git/repo/{repo_id}/stash", post(stash_push))
        .route("/api/git/repo/{repo_id}/stash/apply", post(stash_apply))
        .route("/api/git/repo/{repo_id}/stash/{index}", delete(stash_drop))
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct StashQuery {
    path: Option<String>,
}

// ============================================
// Handlers
// ============================================

/// List all stashes
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/stash",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "List of stashes", body = StashListResponse)
    ),
    tag = "stash"
)]
pub async fn stash_list(
    Path(repo_id): Path<String>,
    Query(query): Query<StashQuery>,
) -> GitApiResult<Json<StashListResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let stashes = commands::stash_list(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(StashListResponse {
        status: 0,
        data: GitStashListData { stashes },
    }))
}

/// Create a stash
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/stash",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = StashPushRequest,
    responses(
        (status = 200, description = "Stash created", body = StashResultResponse)
    ),
    tag = "stash"
)]
pub async fn stash_push(
    Path(repo_id): Path<String>,
    Query(query): Query<StashQuery>,
    Json(req): Json<StashPushRequest>,
) -> GitApiResult<Json<StashResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::stash_push(
        &repo_path,
        req.files.as_deref(),
        req.message.as_deref(),
        req.include_untracked,
    )
    .map_err(GitApiError::from_git_error)?;

    Ok(Json(StashResultResponse {
        status: 0,
        data: result,
    }))
}

/// Apply a stash
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/stash/apply",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = StashApplyRequest,
    responses(
        (status = 200, description = "Stash applied", body = StashResultResponse)
    ),
    tag = "stash"
)]
pub async fn stash_apply(
    Path(repo_id): Path<String>,
    Query(query): Query<StashQuery>,
    Json(req): Json<StashApplyRequest>,
) -> GitApiResult<Json<StashResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::stash_apply(&repo_path, req.index, req.pop)
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(StashResultResponse {
        status: 0,
        data: result,
    }))
}

/// Drop a stash
#[utoipa::path(
    delete,
    path = "/api/git/repo/{repo_id}/stash/{index}",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("index" = u32, Path, description = "Stash index"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Stash dropped", body = StashResultResponse)
    ),
    tag = "stash"
)]
pub async fn stash_drop(
    Path((repo_id, index)): Path<(String, u32)>,
    Query(query): Query<StashQuery>,
) -> GitApiResult<Json<StashResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::stash_drop(&repo_path, index).map_err(GitApiError::from_git_error)?;

    Ok(Json(StashResultResponse {
        status: 0,
        data: result,
    }))
}

// ============================================
// Helper
// ============================================

fn resolve_repo_path(repo_id: &str, query_path: Option<&str>) -> GitApiResult<std::path::PathBuf> {
    if let Some(path) = query_path {
        validate_path(path)
    } else {
        lookup_repo_path(repo_id)
    }
}
