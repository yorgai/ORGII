//! Tests for [`BridgeSupervisor`].
//!
//! `BridgeSupervisor::start` calls `MobileRemoteBridge::start` which
//! requires a real `tauri::AppHandle`; that path is covered by Tauri
//! integration tests in a later phase. Here we exercise the
//! supervisor primitives we *can* drive standalone — the
//! `stop`-aborts-tasks path and the install / take semantics under
//! the inner mutex.

use std::time::Duration;

use super::*;
use crate::bridge::MobileRemoteBridge;

/// Fresh supervisor with an injected bridge: `stop()` must abort the
/// spawned task and clear the inner `Option`, so a follow-up `start`
/// would see `None` and (if a Tauri runtime were available) spawn a
/// fresh bridge.
#[tokio::test]
async fn stop_aborts_injected_bridge_and_clears_inner() {
    let supervisor = BridgeSupervisor::new_for_test();
    let handle = tokio::spawn(async {
        tokio::time::sleep(Duration::from_secs(60)).await;
    });
    let bridge = MobileRemoteBridge::from_handles_for_test(vec![handle]);
    supervisor.install_bridge_for_test(bridge).await;

    assert!(
        supervisor.is_running().await,
        "supervisor with installed bridge must report running"
    );

    supervisor.stop().await;

    assert!(
        !supervisor.is_running().await,
        "after stop the supervisor's inner bridge must be cleared and its task aborted"
    );
}

/// Calling `stop` on an empty supervisor is a no-op (no panic, no
/// hang). Mirrors the URL-setter idempotency case: if the user saves
/// the same URL twice, the second restart still calls
/// `supervisor.stop()` first, and that must be cheap.
#[tokio::test]
async fn stop_on_empty_supervisor_is_noop() {
    let supervisor = BridgeSupervisor::new_for_test();
    supervisor.stop().await;
    assert!(!supervisor.is_running().await);
}

/// `global()` returns the same singleton every call. The singleton
/// itself is not exercised across tests because cargo's parallel
/// runner shares the process; this assertion just locks in the
/// `OnceLock` semantics so a refactor that accidentally re-allocates
/// is caught.
#[test]
fn global_returns_same_instance() {
    let one = BridgeSupervisor::global() as *const BridgeSupervisor;
    let two = BridgeSupervisor::global() as *const BridgeSupervisor;
    assert_eq!(one, two);
}
