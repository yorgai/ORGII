//! HTTP route handlers for file-status operations
//!
//! Provides VSCode-style on-tab-switch verification: the frontend queries
//! whether a file has changed on disk since the editor last read it.
#[cfg(test)]
#[path = "tests/file_tests.rs"]
mod tests;

use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::SystemTime;

use git::{close_inherited_fds, git_command};

/// Spawn git command with pre_exec to close inherited file descriptors on Unix
/// This prevents "Bad file descriptor" errors from WebView FD inheritance
fn spawn_git_command(args: &[&str], repo_path: &Path) -> std::io::Result<Output> {
    let mut cmd = git_command().map_err(std::io::Error::other)?;
    cmd.args(args)
        .current_dir(repo_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    close_inherited_fds(&mut cmd);
    cmd.output()
}

use super::super::file_types::*;

// ============================================
// Query Parameters
// ============================================

#[derive(Debug, Deserialize)]
pub struct GitFileStatusQuery {
    repo_path: String,
    file_path: String,
}

#[derive(Debug, Deserialize)]
pub struct FileMtimeQuery {
    file_path: String,
}

// ============================================
// Error Handling
// ============================================

pub enum FileRouteError {
    GitError(String),
    IoError(std::io::Error),
    InvalidRequest(String),
}

impl IntoResponse for FileRouteError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            FileRouteError::GitError(msg) => (StatusCode::BAD_REQUEST, msg),
            FileRouteError::IoError(err) => (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            FileRouteError::InvalidRequest(msg) => (StatusCode::BAD_REQUEST, msg),
        };

        (
            status,
            Json(crate::error::ApiError::with_type(message, "file_api_error")),
        )
            .into_response()
    }
}

// ============================================
// Helper Functions
// ============================================

/// Parse stage number from git ls-files output
pub(crate) fn parse_stage_number(output: &str) -> u8 {
    // Format: "mode blob-hash stage path"
    // Example: "100644 abc123... 0 file.txt"
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() >= 3 {
        parts[2].parse::<u8>().unwrap_or(0)
    } else {
        0
    }
}

/// Parse blob hash from git ls-files output
pub(crate) fn parse_blob_hash(output: &str) -> Option<String> {
    // Format: "mode blob-hash stage path"
    let parts: Vec<&str> = output.split_whitespace().collect();
    if parts.len() >= 2 {
        Some(parts[1].to_string())
    } else {
        None
    }
}

/// Get file modification time in milliseconds since UNIX epoch
fn get_file_mtime_internal(path: &Path) -> Result<u128, FileRouteError> {
    let metadata = fs::metadata(path).map_err(FileRouteError::IoError)?;

    let modified = metadata.modified().map_err(FileRouteError::IoError)?;

    let duration = modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| FileRouteError::InvalidRequest("System time error".to_string()))?;

    Ok(duration.as_millis())
}

// ============================================
// Route Handlers
// ============================================

/// Get git file status using `git ls-files --stage`
///
/// This follows VSCode's approach of checking per-file git status on tab switch.
/// Returns tracked status, staged status, blob hash, mtime, and conflict stage.
///
/// GET /api/file/git-status?repo_path=...&file_path=...
#[utoipa::path(
    get,
    path = "/api/file/git-status",
    params(
        ("repo_path" = String, Query, description = "Repository path"),
        ("file_path" = String, Query, description = "File path to check"),
    ),
    responses(
        (status = 200, description = "Git file status", body = GitFileStatusResponse),
        (status = 400, description = "Bad request", body = String),
    ),
    tag = "file-status"
)]
async fn get_git_file_status(
    Query(params): Query<GitFileStatusQuery>,
) -> Result<Json<GitFileStatusResponse>, FileRouteError> {
    let repo_path_buf = PathBuf::from(&params.repo_path);
    let file_path_buf = PathBuf::from(&params.file_path);

    // Get relative path from repo root
    let relative_path = if file_path_buf.starts_with(&repo_path_buf) {
        file_path_buf
            .strip_prefix(&repo_path_buf)
            .map_err(|e| FileRouteError::InvalidRequest(format!("Invalid path: {}", e)))?
            .to_string_lossy()
            .to_string()
    } else {
        params.file_path.clone()
    };

    // Run: git ls-files --stage -- <file_path>
    let output = spawn_git_command(
        &["ls-files", "--stage", "--", &relative_path],
        Path::new(&params.repo_path),
    )
    .map_err(|e| FileRouteError::GitError(format!("Failed to execute git: {}", e)))?;

    if !output.status.success() {
        return Err(FileRouteError::GitError(format!(
            "git ls-files failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let is_tracked = !output_str.trim().is_empty();

    // Parse git information
    let conflict_stage = if is_tracked {
        parse_stage_number(&output_str)
    } else {
        0
    };

    let blob_hash = if is_tracked {
        parse_blob_hash(&output_str)
    } else {
        None
    };

    // Check if staged (conflict_stage > 0 or exists in index)
    let is_staged = conflict_stage > 0 || is_tracked;

    // Get file modification time
    let mtime = get_file_mtime_internal(&file_path_buf)?;

    Ok(Json(GitFileStatusResponse {
        success: true,
        data: GitFileStatus {
            is_tracked,
            is_staged,
            blob_hash,
            mtime,
            conflict_stage,
        },
    }))
}

/// Get file modification time in milliseconds since UNIX epoch
///
/// Simple endpoint to check if a file has been modified on disk.
/// Used for conflict detection before saving.
///
/// GET /api/file/mtime?file_path=...
#[utoipa::path(
    get,
    path = "/api/file/mtime",
    params(
        ("file_path" = String, Query, description = "File path to check"),
    ),
    responses(
        (status = 200, description = "File modification time", body = FileMtimeResponse),
        (status = 400, description = "Bad request", body = String),
    ),
    tag = "file-status"
)]
async fn get_file_mtime(
    Query(params): Query<FileMtimeQuery>,
) -> Result<Json<FileMtimeResponse>, FileRouteError> {
    let path = PathBuf::from(&params.file_path);
    let mtime = get_file_mtime_internal(&path)?;

    Ok(Json(FileMtimeResponse {
        success: true,
        mtime,
    }))
}

// ============================================
// Route Registration
// ============================================

pub fn routes() -> Router {
    Router::new()
        .route("/api/file/git-status", get(get_git_file_status))
        .route("/api/file/mtime", get(get_file_mtime))
}
