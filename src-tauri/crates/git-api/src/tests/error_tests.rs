use axum::http::StatusCode;

use crate::error::GitApiError;

#[test]
fn test_error_status_codes() {
    assert_eq!(
        GitApiError::RepoNotFound {
            repo_id: "test".into()
        }
        .status_code(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        GitApiError::PathTraversal {
            path: "../etc/passwd".into()
        }
        .status_code(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        GitApiError::MergeConflict {
            message: "conflict".into(),
            files: vec![]
        }
        .status_code(),
        StatusCode::CONFLICT
    );
}

#[test]
fn test_from_git_error() {
    let err = GitApiError::from_git_error("nothing to commit, working tree clean");
    assert!(matches!(err, GitApiError::NothingToCommit));

    let err = GitApiError::from_git_error("Authentication failed for 'https://...'");
    assert!(matches!(err, GitApiError::AuthenticationFailed { .. }));
}
