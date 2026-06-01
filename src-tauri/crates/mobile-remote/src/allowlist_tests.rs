use super::*;

#[test]
fn read_only_allows_session_get() {
    assert!(is_allowed(PermissionTier::ReadOnly, "session_get"));
    assert!(is_allowed(PermissionTier::ReadOnly, "sessions_list"));
}

#[test]
fn read_only_rejects_session_create() {
    assert!(!is_allowed(PermissionTier::ReadOnly, "session_create"));
    assert!(!is_allowed(PermissionTier::ReadOnly, "agent_send_message"));
}

#[test]
fn full_allows_session_create() {
    assert!(is_allowed(PermissionTier::Full, "session_create"));
    assert!(is_allowed(PermissionTier::Full, "agent_send_message"));
}

#[test]
fn full_is_a_superset_of_read_only() {
    for cmd in PermissionTier::ReadOnly.allowed_commands() {
        assert!(
            is_allowed(PermissionTier::Full, cmd),
            "Full tier should include {cmd:?}"
        );
    }
}

#[test]
fn check_or_reject_returns_command_not_allowed() {
    let err = check_or_reject(PermissionTier::ReadOnly, "session_create").unwrap_err();
    match err {
        MobileRemoteError::CommandNotAllowed(cmd) => assert_eq!(cmd, "session_create"),
        other => panic!("expected CommandNotAllowed, got {other:?}"),
    }
}

#[test]
fn check_or_reject_passes_when_allowed() {
    check_or_reject(PermissionTier::Full, "session_create").expect("Full tier allows create");
}

#[test]
fn unknown_commands_are_always_rejected() {
    assert!(!is_allowed(
        PermissionTier::Full,
        "delete_account_and_burn_house_down"
    ));
    assert!(!is_allowed(PermissionTier::ReadOnly, "totally_made_up"));
}
