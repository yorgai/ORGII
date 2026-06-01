//! Merge Routes
//!
//! Merge, rebase, cherry-pick, revert, and reset operations

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::Deserialize;

use crate::commands;
use crate::commands::tasks;
use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::*;

pub fn routes() -> Router {
    Router::new()
        // Merge
        .route("/api/git/repo/{repo_id}/merge", post(merge))
        .route("/api/git/repo/{repo_id}/merge/abort", post(merge_abort))
        .route(
            "/api/git/repo/{repo_id}/merge/continue",
            post(merge_continue),
        )
        // Rebase
        .route("/api/git/repo/{repo_id}/rebase", post(rebase))
        .route("/api/git/repo/{repo_id}/rebase/abort", post(rebase_abort))
        .route(
            "/api/git/repo/{repo_id}/rebase/continue",
            post(rebase_continue),
        )
        // Cherry-pick
        .route("/api/git/repo/{repo_id}/cherry-pick", post(cherry_pick))
        .route(
            "/api/git/repo/{repo_id}/cherry-pick/abort",
            post(cherry_pick_abort),
        )
        .route(
            "/api/git/repo/{repo_id}/cherry-pick/continue",
            post(cherry_pick_continue),
        )
        // Revert
        .route("/api/git/repo/{repo_id}/revert", post(revert))
        .route("/api/git/repo/{repo_id}/revert/abort", post(revert_abort))
        // Reset
        .route("/api/git/repo/{repo_id}/reset", post(reset))
        // Task execution streaming
        .route(
            "/api/tasks/{task_id}/run/stream",
            axum::routing::get(tasks::run_task_stream),
        )
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct MergeQuery {
    path: Option<String>,
}

// ============================================
// Merge Handlers
// ============================================

/// Merge a branch
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/merge",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = MergeRequest,
    responses(
        (status = 200, description = "Merge completed", body = MergeResultResponse)
    ),
    tag = "merge"
)]
pub async fn merge(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
    Json(req): Json<MergeRequest>,
) -> GitApiResult<Json<MergeResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::merge_branch(&repo_path, &req.branch, req.no_ff, req.message.as_deref())
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(MergeResultResponse {
        status: 0,
        data: result,
    }))
}

/// Abort a merge in progress
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/merge/abort",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Merge aborted")
    ),
    tag = "merge"
)]
pub async fn merge_abort(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::merge_abort(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Continue a merge after resolving conflicts
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/merge/continue",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Merge completed", body = MergeResultResponse)
    ),
    tag = "merge"
)]
pub async fn merge_continue(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<Json<MergeResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::merge_continue(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(MergeResultResponse {
        status: 0,
        data: result,
    }))
}

// ============================================
// Rebase Handlers
// ============================================

/// Rebase branch onto upstream
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/rebase",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = RebaseRequest,
    responses(
        (status = 200, description = "Rebase result", body = RebaseResultResponse)
    ),
    tag = "rebase"
)]
pub async fn rebase(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
    Json(req): Json<RebaseRequest>,
) -> GitApiResult<Json<RebaseResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::rebase_branch(&repo_path, &req.upstream, req.branch.as_deref())
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(RebaseResultResponse {
        status: 0,
        data: result,
    }))
}

/// Abort a rebase in progress
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/rebase/abort",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Rebase aborted")
    ),
    tag = "rebase"
)]
pub async fn rebase_abort(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::rebase_abort(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Continue a rebase after resolving conflicts
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/rebase/continue",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Rebase continued", body = RebaseResultResponse)
    ),
    tag = "rebase"
)]
pub async fn rebase_continue(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<Json<RebaseResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::rebase_continue(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(RebaseResultResponse {
        status: 0,
        data: result,
    }))
}

// ============================================
// Cherry-pick Handlers
// ============================================

/// Cherry-pick a commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/cherry-pick",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = CherryPickRequest,
    responses(
        (status = 200, description = "Cherry-pick result", body = CherryPickResultResponse)
    ),
    tag = "cherry-pick"
)]
pub async fn cherry_pick(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
    Json(req): Json<CherryPickRequest>,
) -> GitApiResult<Json<CherryPickResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::cherry_pick_commit(&repo_path, &req.commit, req.no_commit)
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(CherryPickResultResponse {
        status: 0,
        data: result,
    }))
}

/// Abort a cherry-pick in progress
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/cherry-pick/abort",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Cherry-pick aborted")
    ),
    tag = "cherry-pick"
)]
pub async fn cherry_pick_abort(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::cherry_pick_abort(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Continue a cherry-pick after resolving conflicts
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/cherry-pick/continue",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Cherry-pick completed", body = CherryPickResultResponse)
    ),
    tag = "cherry-pick"
)]
pub async fn cherry_pick_continue(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<Json<CherryPickResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::cherry_pick_continue(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(CherryPickResultResponse {
        status: 0,
        data: result,
    }))
}

// ============================================
// Revert Handlers
// ============================================

/// Revert a commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/revert",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = RevertRequest,
    responses(
        (status = 200, description = "Revert result", body = RevertResultResponse)
    ),
    tag = "revert"
)]
pub async fn revert(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
    Json(req): Json<RevertRequest>,
) -> GitApiResult<Json<RevertResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::revert_commit(&repo_path, &req.commit, req.no_commit)
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(RevertResultResponse {
        status: 0,
        data: result,
    }))
}

/// Abort a revert in progress
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/revert/abort",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Revert aborted")
    ),
    tag = "revert"
)]
pub async fn revert_abort(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::revert_abort(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

// ============================================
// Reset Handler
// ============================================

/// Reset HEAD to a commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/reset",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = ResetRequest,
    responses(
        (status = 200, description = "Reset completed", body = ResetResultResponse)
    ),
    tag = "reset"
)]
pub async fn reset(
    Path(repo_id): Path<String>,
    Query(query): Query<MergeQuery>,
    Json(req): Json<ResetRequest>,
) -> GitApiResult<Json<ResetResultResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let result = commands::reset_head(&repo_path, &req.target_ref, &req.mode)
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(ResetResultResponse {
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
