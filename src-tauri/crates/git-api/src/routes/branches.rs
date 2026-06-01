//! Branch Routes
//!
//! Branch operations: list, create, delete, rename, checkout

use axum::{
    extract::{Path, Query},
    http::StatusCode,
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
        .route("/api/git/repo/{repo_id}/branches", get(get_branches))
        .route(
            "/api/git/repo/{repo_id}/current-branch-name",
            get(get_current_branch_name),
        )
        .route("/api/git/repo/{repo_id}/branch", post(create_branch))
        .route(
            "/api/git/repo/{repo_id}/branch/{branch_name}",
            delete(delete_branch),
        )
        .route("/api/git/repo/{repo_id}/branch/rename", post(rename_branch))
        .route("/api/git/repo/{repo_id}/checkout", post(checkout))
}

// ============================================
// Query Types
// ============================================

#[derive(Debug, Deserialize, Default)]
pub struct BranchesQuery {
    path: Option<String>,
}

// ============================================
// Handlers
// ============================================

/// List all branches
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/branches",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "List of branches", body = BranchesResponse)
    ),
    tag = "branches"
)]
pub async fn get_branches(
    Path(repo_id): Path<String>,
    Query(query): Query<BranchesQuery>,
) -> GitApiResult<Json<BranchesResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let branches_data = commands::list_branches(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(BranchesResponse {
        status: 0,
        data: branches_data,
    }))
}

/// Get current branch name only (fast path)
#[utoipa::path(
    get,
    path = "/api/git/repo/{repo_id}/current-branch-name",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 200, description = "Current branch name", body = CurrentBranchNameResponse)
    ),
    tag = "branches"
)]
pub async fn get_current_branch_name(
    Path(repo_id): Path<String>,
    Query(query): Query<BranchesQuery>,
) -> GitApiResult<Json<CurrentBranchNameResponse>> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    let branch_name =
        commands::utils::get_current_branch(&repo_path).map_err(GitApiError::from_git_error)?;

    Ok(Json(CurrentBranchNameResponse {
        status: 0,
        data: GitCurrentBranchName { name: branch_name },
    }))
}

/// Create a new branch
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/branch",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = CreateBranchRequest,
    responses(
        (status = 201, description = "Branch created successfully")
    ),
    tag = "branches"
)]
pub async fn create_branch(
    Path(repo_id): Path<String>,
    Query(query): Query<BranchesQuery>,
    Json(req): Json<CreateBranchRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::create_branch(
        &repo_path,
        &req.name,
        req.start_point.as_deref(),
        req.checkout,
    )
    .map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::CREATED)
}

/// Delete a branch
#[utoipa::path(
    delete,
    path = "/api/git/repo/{repo_id}/branch/{branch_name}",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("branch_name" = String, Path, description = "Branch name to delete"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    responses(
        (status = 204, description = "Branch deleted successfully")
    ),
    tag = "branches"
)]
pub async fn delete_branch(
    Path((repo_id, branch_name)): Path<(String, String)>,
    Query(query): Query<BranchesQuery>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::delete_branch(&repo_path, &branch_name, false)
        .map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::NO_CONTENT)
}

/// Rename a branch
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/branch/rename",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = RenameBranchRequest,
    responses(
        (status = 200, description = "Branch renamed successfully")
    ),
    tag = "branches"
)]
pub async fn rename_branch(
    Path(repo_id): Path<String>,
    Query(query): Query<BranchesQuery>,
    Json(body): Json<RenameBranchRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::rename_branch(
        &repo_path,
        body.old_name.as_deref(),
        &body.new_name,
        body.force,
    )
    .map_err(GitApiError::from_git_error)?;

    Ok(StatusCode::OK)
}

/// Checkout branch or commit
#[utoipa::path(
    post,
    path = "/api/git/repo/{repo_id}/checkout",
    params(
        ("repo_id" = String, Path, description = "Repository UUID or name"),
        ("path" = Option<String>, Query, description = "Repository file system path"),
    ),
    request_body = CheckoutRequest,
    responses(
        (status = 200, description = "Checkout successful")
    ),
    tag = "branches"
)]
pub async fn checkout(
    Path(repo_id): Path<String>,
    Query(query): Query<BranchesQuery>,
    Json(req): Json<CheckoutRequest>,
) -> GitApiResult<StatusCode> {
    let repo_path = resolve_repo_path(&repo_id, query.path.as_deref())?;

    commands::checkout_ref(&repo_path, &req.ref_name, req.force)
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
