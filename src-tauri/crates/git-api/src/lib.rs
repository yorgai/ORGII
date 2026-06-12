//! Git HTTP API
//!
//! Axum router + utoipa OpenAPI docs covering the full git surface:
//! status, branches, commits, remotes, staging, stash, diff, merge/
//! rebase/cherry-pick, blame, and file blob/mtime endpoints. Plus one
//! `#[tauri::command]` (`commands::ai::generate_commit_message`)
//! re-registered from `commands/handler_list.inc`.
//!
//! ## Layout
//!
//! - `error` — `GitApiError` (thiserror) + lightweight `ApiError`
//!   envelope for the non-`git2` `routes::file` endpoints
//! - `extractors` — axum extractors for path resolution / validation
//! - `types` — request/response DTOs with utoipa schemas
//! - `routes/` — domain-organized HTTP handlers (mounted into the main
//!   app's combined `axum::Router` at startup)
//! - `commands/` — git CLI / git2 command wrappers consumed by the
//!   route handlers and by `lineage_bridge`
//! - `lineage_bridge` — registers a `commit→diff` callback used by
//!   `project_management::lineage` for git-aware navigation
//! - `file_types` — request/response shapes for the file blob endpoints

pub mod commands;
pub mod error;
pub mod extractors;
pub mod file_types;
pub mod lineage_bridge;
pub mod routes;
pub mod types;

#[cfg(test)]
mod tests;
