//! Search HTTP API — file search and code search over the workspace.
//!
//! REST API with OpenAPI schema annotations built on Axum + utoipa.
//! Composed into the unified `app::api::server` router; this crate does
//! NOT run its own listener.
//!
//! ## Submodule layout
//! - `types`       — request/response types with OpenAPI schemas
//! - `routes`      — central route registration (mounted under `/search`)
//! - `file_routes` — fuzzy file-name search with `.gitignore` filtering
//! - `code_routes` — symbol search
//! - `error`       — shared `ApiError` response type for this crate
//!
//! ## Layering
//! Pure leaf — no back-edges into `app`. Depends only on the underlying
//! `search` engine crate plus axum / serde / utoipa. The unified server
//! in `app` mounts `api_search::routes::create_routes()` onto its router
//! and references `api_search::*` types directly in its OpenAPI doc.

pub mod code_routes;
pub mod error;
pub mod file_routes;
pub mod routes;
pub mod types;

pub use error::ApiError;
pub use types::*;
