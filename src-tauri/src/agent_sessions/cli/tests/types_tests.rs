use super::*;

// ============================================
// SessionStatus
// ============================================

#[test]
fn session_status_parse_all_known_values() {
    assert_eq!(
        SessionStatus::parse("pending"),
        Some(SessionStatus::Pending)
    );
    assert_eq!(
        SessionStatus::parse("running"),
        Some(SessionStatus::Running)
    );
    assert_eq!(
        SessionStatus::parse("completed"),
        Some(SessionStatus::Completed)
    );
    assert_eq!(SessionStatus::parse("failed"), Some(SessionStatus::Failed));
    assert_eq!(
        SessionStatus::parse("cancelled"),
        Some(SessionStatus::Cancelled)
    );
}

#[test]
fn session_status_parse_unknown_returns_none() {
    assert_eq!(SessionStatus::parse(""), None);
    assert_eq!(SessionStatus::parse("unknown"), None);
    assert_eq!(SessionStatus::parse("PENDING"), None);
}

#[test]
fn session_status_is_terminal() {
    assert!(SessionStatus::Completed.is_terminal());
    assert!(SessionStatus::Failed.is_terminal());
    assert!(SessionStatus::Cancelled.is_terminal());
    assert!(!SessionStatus::Pending.is_terminal());
    assert!(!SessionStatus::Running.is_terminal());
}

#[test]
fn session_status_is_resumable() {
    assert!(SessionStatus::Running.is_resumable());
    assert!(SessionStatus::Failed.is_resumable());
    assert!(SessionStatus::Pending.is_resumable());
    assert!(!SessionStatus::Completed.is_resumable());
    assert!(!SessionStatus::Cancelled.is_resumable());
}

#[test]
fn session_status_display_roundtrip() {
    for status in [
        SessionStatus::Pending,
        SessionStatus::Running,
        SessionStatus::Completed,
        SessionStatus::Failed,
        SessionStatus::Cancelled,
    ] {
        let formatted = format!("{}", status);
        let parsed = SessionStatus::parse(&formatted);
        assert_eq!(
            parsed,
            Some(status),
            "Display roundtrip failed for {:?}",
            status
        );
    }
}

#[test]
fn session_status_as_ref_matches_display() {
    for status in [
        SessionStatus::Pending,
        SessionStatus::Running,
        SessionStatus::Completed,
        SessionStatus::Failed,
        SessionStatus::Cancelled,
    ] {
        let display = format!("{}", status);
        assert_eq!(status.as_ref(), display);
    }
}

// ============================================
// SessionRunner
// ============================================

#[test]
fn session_runner_parse_local() {
    assert_eq!(SessionRunner::parse("local"), Some(SessionRunner::Local));
}

#[test]
fn session_runner_parse_unknown_returns_none() {
    // Empty / unknown runner strings must not silently coerce to
    // `Local` — a future remote-runner variant would otherwise be
    // re-routed to the local execution path.
    assert_eq!(SessionRunner::parse(""), None);
    assert_eq!(SessionRunner::parse("remote"), None);
    assert_eq!(SessionRunner::parse("LOCAL"), None);
}

#[test]
fn session_runner_display_as_ref() {
    assert_eq!(format!("{}", SessionRunner::Local), "local");
    assert_eq!(SessionRunner::Local.as_ref(), "local");
}

// ============================================
// Constants
// ============================================

#[test]
fn default_code_session_flow_is_quick() {
    assert_eq!(DEFAULT_CODE_SESSION_FLOW, "quick");
}

// ============================================
// Session defaults
// ============================================

#[test]
fn session_defaults_non_empty() {
    assert!(!session_defaults::CODE_SESSION_NAME.is_empty());
    #[allow(clippy::assertions_on_constants)]
    {
        assert!(session_defaults::MAX_NAME_LENGTH > 0);
    }
}

#[test]
fn proxy_env_non_empty() {
    assert!(!proxy_env::HTTPS_PROXY.is_empty());
    assert!(!proxy_env::HTTPS_PROXY_LOWER.is_empty());
    assert!(!proxy_env::SSL_CERT_FILE.is_empty());
    assert!(!proxy_env::NODE_EXTRA_CA_CERTS.is_empty());
}
