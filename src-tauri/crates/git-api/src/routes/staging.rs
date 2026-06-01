//! Staging Routes
//!
//! Stage, unstage, and discard file changes

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::Deserialize;

use crate::commands;
use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::*;

pub fn routes() -> Router {
    Router::new()
        .route("/api/git/repo/{repo_id}/stage", post(stage_files))
        .route("/api/git/repo/{repo_id}/unstage", post(unstage_files))
        .route("/api/git/repo/{repo_id}/discard", post(discard_changes))
        .route(
            "/api/git/repo/{repo_id}/resolve-conflict",
            post(resolve_conflict),
        )
        // Streaming endpoint
        .route(
            "/api/git/repo/{repo_id}/stage/stream",
            get(commands::streaming::stage_stream),
        )
        .route(
            "/api/git/repo/{repo_id}/commit/stream",
            get(commands::streaming::commit_stream),
        )
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct StagingQuery {
    path: Option<String>,
}

// ============================================
// Handlers
// ============================================

/// Stage files
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/stage",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = StageFilesRequest,
    responses(
        (status = 200, description = "Files staged successfully")
    ),
    tag = "staging"
)]
pub async fn stage_files(
    Path(repo_id): Path<String>,
    Query(query): Query<StagingQuery>,
    axum::Json(req): axum::Json<StageFilesRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    for file in &req.files {
        commands::stage_file(&repo_path, file).map_err(GitApiError::from_git_error)?;
    }

    Ok(StatusCode::OK)
}

/// Unstage files
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/unstage",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = StageFilesRequest,
    responses(
        (status = 200, description = "Files unstaged successfully")
    ),
    tag = "staging"
)]
pub async fn unstage_files(
    Path(repo_id): Path<String>,
    Query(query): Query<StagingQuery>,
    axum::Json(req): axum::Json<StageFilesRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::unstage_files(&repo_path, &req.files).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Discard changes (cannot be undone!)
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/discard",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = DiscardChangesRequest,
    responses(
        (status = 200, description = "Changes discarded permanently")
    ),
    tag = "staging"
)]
pub async fn discard_changes(
    Path(repo_id): Path<String>,
    Query(query): Query<StagingQuery>,
    axum::Json(req): axum::Json<DiscardChangesRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::discard_changes(&repo_path, &req.files).map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Resolve a merge conflict file
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/resolve-conflict",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = ResolveConflictRequest,
    responses(
        (status = 200, description = "Conflict resolved successfully")
    ),
    tag = "staging"
)]
pub async fn resolve_conflict(
    Path(repo_id): Path<String>,
    Query(query): Query<StagingQuery>,
    axum::Json(req): axum::Json<ResolveConflictRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::resolve_conflict(&repo_path, &req.file, &req.strategy)
        .map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
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
