//! Worktree Routes
//!
//! Lists git worktrees registered for a repository.

use std::{
    collections::HashSet,
    path::{Path as FsPath, PathBuf},
};

use axum::{
    extract::{Path, Query},
    routing::{delete, get},
    Json, Router,
};
use serde::Deserialize;

use crate::error::{GitApiError, GitApiResult};
use crate::extractors::{lookup_repo_path, validate_path};
use crate::types::{
    RemoveWorktreeRequest, WorktreeDiffSummary, WorktreeEntry, WorktreeListResponse,
    WorktreeRemoveResponse,
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
        .map(|entry| {
            let diff_summary = summarize_worktree_diff(&repo_path, &entry.path, &entry.branch);
            WorktreeEntry {
                path: entry.path,
                branch: entry.branch,
                head_sha: entry.head_sha,
                is_main: entry.is_main,
                diff_summary,
            }
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

    let force = request.force;
    tokio::task::spawn_blocking(move || {
        git::worktree::remove_worktree_path(&repo_path, &worktree_path, force)
    })
    .await
    .map_err(|err| GitApiError::Internal {
        message: format!("Worktree removal task failed: {err}"),
    })?
    .map_err(GitApiError::from_git_error)?;

    Ok(Json(WorktreeRemoveResponse {
        status: 0,
        data: WorktreeEntry {
            path: request.worktree_path,
            branch: String::new(),
            head_sha: String::new(),
            is_main: false,
            diff_summary: None,
        },
    }))
}

fn summarize_worktree_diff(
    main_repo_path: &FsPath,
    worktree_path: &str,
    worktree_branch: &str,
) -> Option<WorktreeDiffSummary> {
    let worktree_path = PathBuf::from(worktree_path);
    let uncommitted = crate::commands::diff::get_diff_numstat_combined(&worktree_path, "HEAD").ok();
    let base_ref = crate::commands::utils::get_current_branch(main_repo_path).ok();
    let committed = base_ref.as_deref().and_then(|base| {
        if base == worktree_branch || worktree_branch.is_empty() {
            return None;
        }
        crate::commands::diff::get_diff_numstat(&worktree_path, base, Some("HEAD"), false).ok()
    });

    let uncommitted_files = uncommitted
        .as_ref()
        .map_or(0, |summary| summary.files_changed);
    let uncommitted_additions = uncommitted
        .as_ref()
        .map_or(0, |summary| summary.total_insertions);
    let uncommitted_deletions = uncommitted
        .as_ref()
        .map_or(0, |summary| summary.total_deletions);
    let committed_files = committed
        .as_ref()
        .map_or(0, |summary| summary.files_changed);
    let committed_additions = committed
        .as_ref()
        .map_or(0, |summary| summary.total_insertions);
    let committed_deletions = committed
        .as_ref()
        .map_or(0, |summary| summary.total_deletions);

    let mut changed_paths = HashSet::new();
    if let Some(summary) = uncommitted.as_ref() {
        changed_paths.extend(summary.files.iter().map(|file| file.path.clone()));
    }
    if let Some(summary) = committed.as_ref() {
        changed_paths.extend(summary.files.iter().map(|file| file.path.clone()));
    }

    let total_files = changed_paths.len() as u32;
    let total_additions = uncommitted_additions + committed_additions;
    let total_deletions = uncommitted_deletions + committed_deletions;

    if total_files == 0 && total_additions == 0 && total_deletions == 0 {
        return None;
    }

    Some(WorktreeDiffSummary {
        total_files,
        total_additions,
        total_deletions,
        committed_files,
        committed_additions,
        committed_deletions,
        uncommitted_files,
        uncommitted_additions,
        uncommitted_deletions,
        base_ref,
    })
}

fn resolve_repo_path(repo_id: &str, query_path: Option<&str>) -> GitApiResult<std::path::PathBuf> {
    if let Some(path) = query_path {
        validate_path(path)
    } else {
        lookup_repo_path(repo_id)
    }
}
