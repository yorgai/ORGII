//! API Error response type for the Search HTTP API.
//!
//! Renders as a JSON `{ error, error_type? }` body with HTTP 500 by default.
//! Other crates (e.g. `git_api`) carry their own dedicated error type — this
//! one is scoped to the search routes only.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Standard API error response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ApiError {
    /// Error message
    pub error: String,
    /// Error type (optional, for machine-readable categorization)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<String>,
}

impl ApiError {
    pub fn new(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            error_type: None,
        }
    }

    pub fn with_type(error: impl Into<String>, error_type: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            error_type: Some(error_type.into()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}

impl From<String> for ApiError {
    fn from(error: String) -> Self {
        Self::new(error)
    }
}

impl From<&str> for ApiError {
    fn from(error: &str) -> Self {
        Self::new(error)
    }
}
