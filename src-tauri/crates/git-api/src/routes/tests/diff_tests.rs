use crate::error::GitApiError;
use crate::routes::diff::{map_commit_diff_error, map_file_content_error};

#[test]
fn map_commit_diff_error_maps_missing_commit() {
    let mapped = map_commit_diff_error(
        "abc1234",
        "Failed to resolve commit 'abc1234': not found".to_string(),
    );
    assert!(matches!(mapped, GitApiError::CommitNotFound { .. }));
}

#[test]
fn map_commit_diff_error_maps_parent_selection_failure() {
    let mapped = map_commit_diff_error(
        "abc1234",
        "Failed to get parent: parent index 2 out of range".to_string(),
    );
    assert!(matches!(mapped, GitApiError::InvalidRequest { .. }));
}

#[test]
fn map_file_content_error_maps_invalid_ref() {
    let mapped = map_file_content_error(
        "src/main.ts",
        "bad-ref",
        "Failed to resolve ref 'bad-ref'".to_string(),
    );
    assert!(matches!(mapped, GitApiError::InvalidRef { .. }));
}
