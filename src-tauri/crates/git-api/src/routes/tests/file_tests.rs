use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::routes::file::{parse_blob_hash, parse_stage_number, FileRouteError};

// ============================================
// parse_stage_number
// ============================================

#[test]
fn parse_stage_normal_file() {
    assert_eq!(parse_stage_number("100644 abc123def456 0 src/main.rs"), 0);
}

#[test]
fn parse_stage_conflict_ours() {
    assert_eq!(parse_stage_number("100644 abc123def456 2 src/main.rs"), 2);
}

#[test]
fn parse_stage_conflict_theirs() {
    assert_eq!(parse_stage_number("100644 abc123def456 3 src/main.rs"), 3);
}

#[test]
fn parse_stage_base() {
    assert_eq!(parse_stage_number("100644 abc123def456 1 src/main.rs"), 1);
}

#[test]
fn parse_stage_empty_input() {
    assert_eq!(parse_stage_number(""), 0);
}

#[test]
fn parse_stage_partial_input() {
    assert_eq!(parse_stage_number("100644 abc123"), 0);
}

#[test]
fn parse_stage_invalid_number() {
    assert_eq!(parse_stage_number("100644 abc123 X src/main.rs"), 0);
}

// ============================================
// parse_blob_hash
// ============================================

#[test]
fn parse_blob_hash_normal() {
    let hash = parse_blob_hash("100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md");
    assert_eq!(hash.unwrap(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
}

#[test]
fn parse_blob_hash_empty() {
    assert!(parse_blob_hash("").is_none());
}

#[test]
fn parse_blob_hash_single_field() {
    assert!(parse_blob_hash("100644").is_none());
}

#[test]
fn parse_blob_hash_two_fields() {
    let hash = parse_blob_hash("100644 abc123");
    assert_eq!(hash.unwrap(), "abc123");
}

// ============================================
// FileRouteError IntoResponse
// ============================================

#[test]
fn api_error_git_returns_bad_request() {
    let err = FileRouteError::GitError("test error".to_string());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn api_error_invalid_request_returns_bad_request() {
    let err = FileRouteError::InvalidRequest("bad input".to_string());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn api_error_io_returns_internal_server_error() {
    let err = FileRouteError::IoError(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "not found",
    ));
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}
