use std::time::Duration;

use orgii_protocol::{DesktopId, UserId};

use super::{RelayWsClient, RelayWsConfig, WsLifecycleEvent};
use crate::error::MobileRemoteError;

fn ids() -> (UserId, DesktopId) {
    (UserId::new("user-test"), DesktopId::new("desk-test"))
}

#[tokio::test]
async fn new_starts_disconnected() {
    let (user_id, desktop_id) = ids();
    let client = RelayWsClient::new("wss://relay.example/desktop/connect", user_id, desktop_id);
    assert!(!client.is_connected());
    assert!(client.outbound_tx().is_none());
}

#[tokio::test]
async fn url_round_trip() {
    let (user_id, desktop_id) = ids();
    let url = "wss://relay.example/desktop/connect";
    let client = RelayWsClient::new(url, user_id, desktop_id);
    assert_eq!(client.url(), url);
}

#[tokio::test]
async fn connect_once_to_invalid_url_returns_err() {
    let (user_id, desktop_id) = ids();
    // Port 1 on loopback should refuse instantly on every supported
    // platform; the 1s timeout is a hard ceiling so the test never
    // hangs CI even on weird IPv6-only hosts.
    let config = RelayWsConfig {
        url: "ws://127.0.0.1:1/desktop/connect".to_owned(),
        user_id,
        desktop_id,
        ping_interval: Duration::from_secs(30),
        handshake_timeout: Duration::from_secs(1),
    };
    let mut client = RelayWsClient::with_config(config);
    let result = client.connect_once().await;
    match result {
        Err(MobileRemoteError::RelayUnreachable(_)) => {}
        Err(other) => panic!("expected RelayUnreachable, got {other:?}"),
        Ok(()) => panic!("expected connect to fail against port 1"),
    }
    assert!(!client.is_connected());
}

/// `take_lifecycle_rx` returns the receiver exactly once. The bridge
/// relies on this to ensure only one consumer drives the reconnect
/// loop.
#[tokio::test]
async fn lifecycle_rx_taken_once() {
    let (user_id, desktop_id) = ids();
    let mut client = RelayWsClient::new("wss://relay.example/desktop/connect", user_id, desktop_id);
    assert!(client.take_lifecycle_rx().is_some());
    assert!(
        client.take_lifecycle_rx().is_none(),
        "second take must yield None"
    );
}

/// Sanity check: the lifecycle channel receives `Disconnected` when
/// the read loop's underlying stream terminates. We exercise this by
/// driving `connect_once` against an unreachable port — that path
/// fails before any read loop spawns, so we cannot observe a
/// `Disconnected` for a real stream here. Instead this test asserts
/// the inverse invariant: a failed `connect_once` does NOT push
/// anything onto the lifecycle channel. The successful-then-broken
/// path is exercised by the bridge's integration tests once a real
/// relay test harness is available.
#[tokio::test]
async fn failed_connect_once_does_not_emit_lifecycle_event() {
    let (user_id, desktop_id) = ids();
    let config = RelayWsConfig {
        url: "ws://127.0.0.1:1/desktop/connect".to_owned(),
        user_id,
        desktop_id,
        ping_interval: Duration::from_secs(30),
        handshake_timeout: Duration::from_secs(1),
    };
    let mut client = RelayWsClient::with_config(config);
    let mut lifecycle_rx = client
        .take_lifecycle_rx()
        .expect("first take returns the receiver");
    let _ = client.connect_once().await;
    // The receiver should be empty: connect failures bubble up via
    // the `Result` return, not via the lifecycle channel. We use
    // `try_recv` so the test fails fast instead of hanging.
    match lifecycle_rx.try_recv() {
        Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {}
        Ok(event) => panic!("unexpected lifecycle event: {event:?}"),
        Err(other) => panic!("unexpected channel state: {other:?}"),
    }
    // Touching the variant to prove it's reachable from the test
    // surface — guards against the type being marked private by a
    // future refactor.
    let _ = WsLifecycleEvent::Connected;
}
