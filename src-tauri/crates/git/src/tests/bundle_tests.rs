use crate::bundle::*;

// ============================================
// Git repo info tests
// ============================================

#[test]
fn test_git_repo_info_non_repo() {
    // Test with a path that's not a git repo (like /tmp)
    let result = get_git_repo_info("/tmp".to_string());
    assert!(result.is_ok());
    let info = result.unwrap();
    assert!(!info.is_git_repo || info.branch_name.is_some());
}

// ============================================
// Ahead/behind calculation tests
// ============================================

#[test]
fn test_ahead_behind_invalid_path() {
    // Test with non-existent path
    let result = calculate_ahead_behind("/nonexistent/path".to_string(), "abc123".to_string());
    assert!(result.is_err());
}

#[test]
fn test_ahead_behind_non_repo() {
    // Test with path that exists but is not a git repo
    let result = calculate_ahead_behind("/tmp".to_string(), "abc123".to_string());
    assert!(result.is_err());
}

#[test]
fn test_ahead_behind_invalid_sha() {
    // This test needs a real git repo, so we use the current project
    // The test will fail with "invalid SHA" error which is expected
    let result = calculate_ahead_behind(".".to_string(), "invalid_sha".to_string());
    // Should error because "invalid_sha" is not a valid git object
    assert!(result.is_err());
}

// Note: Testing actual ahead/behind calculations requires a real git repo
// with known commit history. These tests verify error handling.
// Integration tests with actual repos would be needed for full coverage.
