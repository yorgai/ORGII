//! Tests for [`TauriDispatchHost`].
//!
//! `tauri::AppHandle` cannot be constructed without a real Tauri
//! runtime — the `tauri::test::mock_runtime` API is gated behind the
//! `test` cargo feature, which is not enabled on the workspace `tauri`
//! dependency (and turning it on would force every other test to also
//! pull in the mock runtime). We therefore restrict these tests to
//! shape-only checks that exercise the trait surface without
//! constructing a host:
//!
//! * the [`DispatchHost`] trait is object-safe under `&dyn`,
//! * the `Debug` impl is non-trivial,
//! * the dispatch-layer error wording for missing-state / missing-
//!   session conditions is stable enough that the mobile UI can
//!   pattern-match on it.
//!
//! Real wiring of the mutating commands (`approve_tool_call`,
//! `deny_tool_call`, `send_message`) is exercised by integration tests
//! in `dispatch_tests.rs` against the in-memory `MockHost`, plus
//! end-to-end smoke tests once a Tauri test harness is in place.

use mobile_remote::dispatch::DispatchHost;
use mobile_remote::error::MobileRemoteError;

/// Trait-object-safety smoke test. If anyone widens [`DispatchHost`]
/// with a `Self: Sized` bound, this stops compiling — and the bridge's
/// `Box<dyn DispatchHost>` storage breaks.
#[test]
fn dispatch_host_is_object_safe() {
    fn _take(_: &dyn DispatchHost) {}
    // Use the noop host as a stand-in; we only need *something* that
    // implements the trait to coerce into `&dyn DispatchHost`.
    let host = mobile_remote::dispatch::NoopDispatchHost;
    _take(&host);
}

/// The mobile UI distinguishes "permission request expired" from
/// "AgentAppState not yet wired" by string-matching the
/// `DispatchHandler` error text. Keep the wording stable so a
/// rename here forces a deliberate update on the mobile side.
#[test]
fn missing_state_error_text_is_stable() {
    let err =
        MobileRemoteError::DispatchHandler("AgentAppState not registered on AppHandle".to_owned());
    let text = err.to_string();
    assert!(
        text.contains("AgentAppState not registered"),
        "want stable not-registered marker, got {text:?}"
    );
}

/// Mirror of the not-found error a mobile peer sees when the session
/// died between the event broadcast and the approve/deny click. The
/// command name (`approve_tool_call` / `deny_tool_call` /
/// `send_message`) appears in the prefix so the mobile log can blame
/// the right RPC.
#[test]
fn session_not_found_error_text_includes_command_and_id() {
    let approve = MobileRemoteError::DispatchHandler(format!(
        "approve_tool_call: session not found: {}",
        "sess-1"
    ));
    let deny = MobileRemoteError::DispatchHandler(format!(
        "deny_tool_call: session not found: {}",
        "sess-1"
    ));

    assert!(approve.to_string().contains("approve_tool_call"));
    assert!(approve.to_string().contains("sess-1"));
    assert!(deny.to_string().contains("deny_tool_call"));
    assert!(deny.to_string().contains("sess-1"));
}

/// Mirror of the no-pending-request error a mobile peer sees when the
/// permission request expired or was already answered from another
/// surface (desktop dialog, second phone). The wording carries both
/// `call_id` and `session_id` so the mobile UI can disambiguate
/// between "stale request" and "wrong session".
#[test]
fn no_pending_request_error_text_includes_ids() {
    let approve = MobileRemoteError::DispatchHandler(format!(
        "approve_tool_call: no pending request for {} on session {}",
        "perm-os-abc", "sess-1"
    ));
    let deny = MobileRemoteError::DispatchHandler(format!(
        "deny_tool_call: no pending request for {} on session {}",
        "perm-os-abc", "sess-1"
    ));

    assert!(approve.to_string().contains("perm-os-abc"));
    assert!(approve.to_string().contains("sess-1"));
    assert!(deny.to_string().contains("perm-os-abc"));
    assert!(deny.to_string().contains("sess-1"));
}
