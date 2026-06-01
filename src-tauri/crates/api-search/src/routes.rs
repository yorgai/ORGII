//! Central route registration for the search HTTP API.
use axum::{
    routing::{delete, get, post},
    Json, Router,
};

use crate::code_routes;
use crate::file_routes;

async fn api_info() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": "Orgii Search API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "swagger_ui": "/swagger-ui",
            "openapi_spec": "/api-docs/openapi.json",
            "file_search": "/api/search/files?query=...&root_path=...",
            "file_index": "/api/search/files/index",
            "symbol_search": "/api/search/code/symbols?repo_path=...",
        },
        "documentation": "Visit /swagger-ui for interactive API documentation"
    }))
}

pub fn create_routes() -> Router {
    Router::new()
        .route("/", get(api_info))
        .route("/api/search/files", get(file_routes::search_files))
        .route("/api/search/files/index", post(file_routes::index_files))
        .route("/api/search/files/cache", delete(file_routes::clear_cache))
        .route("/api/search/code/symbols", get(code_routes::search_symbols))
        .route(
            "/api/search/code/file-symbols",
            get(code_routes::get_file_symbols),
        )
}
