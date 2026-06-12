//! Git API Routes Module
//!
//! Organized by domain for maintainability:
//! - status: Repository status and ahead/behind
//! - branches: Branch operations (list, create, delete, checkout)
//! - commits: Commit history and creation
//! - remotes: Remote operations (push, pull, fetch)
//! - staging: Stage/unstage/discard files
//! - stash: Stash operations
//! - diff: File diffs, blame, content
//! - merge: Merge, rebase, cherry-pick, revert, reset
//! - file: File status and metadata

pub mod branches;
pub mod commits;
pub mod diff;
pub mod file;
pub mod merge;
pub mod remotes;
pub mod staging;
pub mod stash;
pub mod status;
pub mod worktrees;

use axum::Router;

// Re-export for backward compatibility
pub use super::error::GitApiError;

/// Create all Git API routes
pub fn create_routes() -> Router {
    Router::new()
        // Root endpoint
        .route("/", axum::routing::get(api_info))
        // Merge domain-specific routes
        .merge(status::routes())
        .merge(branches::routes())
        .merge(commits::routes())
        .merge(remotes::routes())
        .merge(staging::routes())
        .merge(stash::routes())
        .merge(diff::routes())
        .merge(merge::routes())
        .merge(file::routes())
        .merge(worktrees::routes())
}

/// API info endpoint
async fn api_info() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "name": "Orgii Git API",
        "version": "2.0.0",
        "status": "running",
        "endpoints": {
            "openapi_spec": "/api-docs/openapi.json",
            "git_status": "/api/git/repo/{repo_id}/status",
            "ahead_behind": "/api/git/repo/{repo_id}/ahead-behind"
        }
    }))
}
