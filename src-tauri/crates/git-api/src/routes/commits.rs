//! Commit Routes
//!
//! Commit history, creation, and amend

use axum::{
    extract::{Path, Query},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::commands;
use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::*;

pub fn routes() -> Router {
    Router::new()
        .route("/api/git/repo/{repo_id}/commits", get(get_commits))
        .route("/api/git/repo/{repo_id}/commit", post(commit))
        .route("/api/git/repo/{repo_id}/commit/amend", post(amend_commit))
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct CommitsQuery {
    path: Option<String>,
    limit: Option<u32>,
    skip: Option<u32>,
    file_path: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CommitQuery {
    path: Option<String>,
}

// ============================================
// Handlers
// ============================================

/// Get commit history
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/commits",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
        ("limit" = Option<u32>, Query, description = "Maximum commits to return"),
        ("file_path" = Option<String>, Query, description = "Filter commits by file path"),
    ),
    responses(
        (status = 200, description = "Commit history list", body = CommitsResponse)
    ),
    tag = "commits"
)]
pub async fn get_commits(
    Path(repo_id): Path<String>,
    Query(query): Query<CommitsQuery>,
) -> GitApiResult<Json<CommitsResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    if query.file_path.is_some() {
        log::info!(
            "[GitAPI] get_commits with file_path filter: {:?}",
            query.file_path
        );
    }

    let commits_data = commands::list_commits(
        &repo_path,
        query.limit,
        query.skip,
        query.file_path.as_deref(),
    )
    .map_err(GitApiError::from_git_error)?;

    Ok(Json(CommitsResponse {
        status: 0,
        data: commits_data,
    }))
}

/// Create a commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/commit",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = CommitRequest,
    responses(
        (status = 200, description = "Commit created successfully")
    ),
    tag = "commits"
)]
pub async fn commit(
    Path(repo_id): Path<String>,
    Query(query): Query<CommitQuery>,
    Json(req): Json<CommitRequest>,
) -> GitApiResult<Json<serde_json::Value>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let sha = commands::create_commit(
        &repo_path,
        &req.message,
        req.description.as_deref(),
        req.stage_all,
        req.files.as_deref(),
    )
    .map_err(GitApiError::from_git_error)?;

    // Record lineage: match provenance entries against this commit (background, non-blocking)
    let lineage_repo = repo_path.clone();
    let lineage_sha = sha.clone();
    tokio::task::spawn_blocking(move || {
        if let Err(err) =
            project_management::lineage::commit_tracker::match_commit(&lineage_repo, &lineage_sha)
        {
            log::warn!("[lineage] commit tracking failed: {}", err);
        }
    });

    Ok(Json(serde_json::json!({
        "status": 0,
        "data": {
            "sha": sha,
            "message": req.message
        }
    })))
}

/// Amend the last commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/commit/amend",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = AmendCommitRequest,
    responses(
        (status = 200, description = "Commit amended successfully", body = CommitInfoResponse)
    ),
    tag = "commits"
)]
pub async fn amend_commit(
    Path(repo_id): Path<String>,
    Query(query): Query<CommitQuery>,
    Json(req): Json<AmendCommitRequest>,
) -> GitApiResult<Json<CommitInfoResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let commit = commands::amend_commit(&repo_path, req.message.as_deref(), req.files.as_deref())
        .map_err(GitApiError::from_git_error)?;

    Ok(Json(CommitInfoResponse {
        status: 0,
        data: commit,
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
