//! Routing-correctness tests for `UserHub` and `UserHubRegistry`.
//!
//! These run against the real types (no mocks) because the routing
//! state is small enough to construct directly and because mocking
//! `mpsc::UnboundedSender` would just re-implement it badly.

use super::*;
use orgii_protocol::{DesktopId, DeviceId, Frame, RpcCall, RpcId, RpcResult, UserId};
use std::sync::Arc;
use tokio::sync::mpsc;

fn make_ping() -> Frame {
    Frame::Ping
}

#[tokio::test]
async fn two_desktops_register_and_appear_in_list() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx_a, _rx_a) = mpsc::unbounded_channel();
    let (tx_b, _rx_b) = mpsc::unbounded_channel();
    hub.register_desktop(DesktopId::new("home"), tx_a).await;
    hub.register_desktop(DesktopId::new("office"), tx_b).await;
    let mut listed = hub.list_connected_desktops().await;
    listed.sort_by_key(|d| d.as_str().to_owned());
    assert_eq!(
        listed,
        vec![DesktopId::new("home"), DesktopId::new("office")]
    );
}

#[tokio::test]
async fn route_to_unknown_desktop_returns_peer_not_connected() {
    let hub = UserHub::new(UserId::new("u"));
    let result = hub
        .route_to_desktop(&DesktopId::new("nope"), make_ping())
        .await;
    assert!(matches!(result, Err(RouteError::PeerNotConnected)));
}

#[tokio::test]
async fn route_to_desktop_after_receiver_dropped_returns_channel_closed() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx, rx) = mpsc::unbounded_channel();
    hub.register_desktop(DesktopId::new("d"), tx).await;
    drop(rx);
    let result = hub
        .route_to_desktop(&DesktopId::new("d"), make_ping())
        .await;
    assert!(matches!(result, Err(RouteError::ChannelClosed)));
}

#[tokio::test]
async fn route_to_desktop_delivers_frame() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx, mut rx) = mpsc::unbounded_channel();
    hub.register_desktop(DesktopId::new("d"), tx).await;
    hub.route_to_desktop(&DesktopId::new("d"), make_ping())
        .await
        .expect("delivery");
    let received = rx.recv().await.expect("frame received");
    assert_eq!(received, Frame::Ping);
}

#[tokio::test]
async fn broadcast_fanout_reaches_every_connected_mobile() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx_a, mut rx_a) = mpsc::unbounded_channel();
    let (tx_b, mut rx_b) = mpsc::unbounded_channel();
    hub.register_mobile_peer(DeviceId::new("ma"), tx_a).await;
    hub.register_mobile_peer(DeviceId::new("mb"), tx_b).await;
    hub.broadcast_to_mobiles(Frame::Ping).await;
    assert_eq!(rx_a.recv().await.unwrap(), Frame::Ping);
    assert_eq!(rx_b.recv().await.unwrap(), Frame::Ping);
}

#[tokio::test]
async fn unregister_mobile_removes_from_list() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx, _rx) = mpsc::unbounded_channel();
    let device = DeviceId::new("dev");
    hub.register_mobile_peer(device.clone(), tx).await;
    assert_eq!(hub.list_connected_mobiles().await.len(), 1);
    hub.unregister_mobile_peer(&device).await;
    assert!(hub.list_connected_mobiles().await.is_empty());
}

#[tokio::test]
async fn registry_isolates_users_no_cross_talk() {
    let registry = UserHubRegistry::new();
    let user_a = UserId::new("a");
    let user_b = UserId::new("b");
    let hub_a = registry.get_or_create_hub(&user_a).await;
    let hub_b = registry.get_or_create_hub(&user_b).await;

    let (tx, mut rx) = mpsc::unbounded_channel();
    hub_a
        .register_desktop(DesktopId::new("shared-id"), tx)
        .await;

    // Same DesktopId on user_b's hub: should not exist.
    let result = hub_b
        .route_to_desktop(&DesktopId::new("shared-id"), Frame::Ping)
        .await;
    assert!(matches!(result, Err(RouteError::PeerNotConnected)));

    // Same ID on user_a's hub: should be reachable.
    hub_a
        .route_to_desktop(&DesktopId::new("shared-id"), Frame::Ping)
        .await
        .expect("delivery to user_a's desktop");
    assert_eq!(rx.recv().await.unwrap(), Frame::Ping);
}

#[tokio::test]
async fn registry_get_or_create_returns_same_hub_for_same_user() {
    let registry = UserHubRegistry::new();
    let user = UserId::new("u");
    let first = registry.get_or_create_hub(&user).await;
    let second = registry.get_or_create_hub(&user).await;
    assert!(Arc::ptr_eq(&first, &second), "same user → same hub");
    assert_eq!(registry.user_count().await, 1);
}

#[tokio::test]
async fn route_error_converts_into_relay_error_protocol() {
    let err: crate::error::RelayError = RouteError::PeerNotConnected.into();
    matches!(err, crate::error::RelayError::Protocol(_));
}

#[tokio::test]
async fn forward_rpc_call_stamps_source_device_id_from_inbound_mobile() {
    // The relay must overwrite whatever `source_device_id` the mobile
    // client claimed with the authenticated id from its own WS
    // handshake — otherwise a compromised mobile could spoof another
    // device and bypass the desktop bridge's per-device tier lookup.
    let hub = UserHub::new(UserId::new("u"));
    let (tx, mut rx) = mpsc::unbounded_channel();
    let target = DesktopId::new("desk-home");
    hub.register_desktop(target.clone(), tx).await;

    let authenticated_mobile = DeviceId::new("dev-alice-iphone");
    let spoofed = DeviceId::new("dev-attacker");
    let call = RpcCall {
        id: RpcId::new("req-1"),
        target_desktop_id: target.clone(),
        // Mobile claims to be the attacker's device id; the relay must
        // ignore this and stamp `authenticated_mobile` instead.
        source_device_id: spoofed,
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };

    hub.forward_rpc_call(&authenticated_mobile, call)
        .await
        .expect("delivery to registered desktop");

    let received = rx.recv().await.expect("desktop receives forwarded frame");
    match received {
        Frame::RpcCall(forwarded) => {
            assert_eq!(
                forwarded.source_device_id, authenticated_mobile,
                "relay must stamp inbound mobile's authenticated id, not the wire value"
            );
            assert_eq!(forwarded.target_desktop_id, target);
        }
        other => panic!("expected Frame::RpcCall, got {other:?}"),
    }
}

#[tokio::test]
async fn forward_rpc_call_to_unknown_desktop_returns_peer_not_connected() {
    let hub = UserHub::new(UserId::new("u"));
    let call = RpcCall {
        id: RpcId::new("req-2"),
        target_desktop_id: DesktopId::new("ghost"),
        source_device_id: DeviceId::new("dev-1"),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    let result = hub.forward_rpc_call(&DeviceId::new("dev-1"), call).await;
    assert!(matches!(result, Err(RouteError::PeerNotConnected)));
}

#[tokio::test]
async fn forward_rpc_call_records_pending_correlation() {
    let hub = UserHub::new(UserId::new("u"));
    let (tx, _rx) = mpsc::unbounded_channel();
    let target = DesktopId::new("desk-home");
    hub.register_desktop(target.clone(), tx).await;

    let mobile = DeviceId::new("dev-alice");
    let call = RpcCall {
        id: RpcId::new("req-A"),
        target_desktop_id: target,
        source_device_id: mobile.clone(),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    hub.forward_rpc_call(&mobile, call).await.expect("forward");

    assert_eq!(hub.pending_call_count().await, 1);
}

#[tokio::test]
async fn forward_rpc_call_failure_rolls_back_pending() {
    // No desktop registered; forward must fail AND must not leave a
    // dangling pending_calls entry behind for that RpcId.
    let hub = UserHub::new(UserId::new("u"));
    let mobile = DeviceId::new("dev-bob");
    let call = RpcCall {
        id: RpcId::new("req-rollback"),
        target_desktop_id: DesktopId::new("ghost"),
        source_device_id: mobile.clone(),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    let result = hub.forward_rpc_call(&mobile, call).await;
    assert!(matches!(result, Err(RouteError::PeerNotConnected)));
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn route_result_to_mobile_delivers_to_originating_mobile_only() {
    let hub = UserHub::new(UserId::new("u"));

    let (tx_desktop, mut rx_desktop) = mpsc::unbounded_channel();
    hub.register_desktop(DesktopId::new("desk-home"), tx_desktop)
        .await;

    let alice = DeviceId::new("dev-alice");
    let bob = DeviceId::new("dev-bob");
    let (tx_alice, mut rx_alice) = mpsc::unbounded_channel();
    let (tx_bob, mut rx_bob) = mpsc::unbounded_channel();
    hub.register_mobile_peer(alice.clone(), tx_alice).await;
    hub.register_mobile_peer(bob.clone(), tx_bob).await;

    let call = RpcCall {
        id: RpcId::new("req-X"),
        target_desktop_id: DesktopId::new("desk-home"),
        source_device_id: alice.clone(),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    hub.forward_rpc_call(&alice, call).await.expect("forward");
    let _ = rx_desktop.recv().await.expect("desktop got call");

    let result = RpcResult::Ok {
        id: RpcId::new("req-X"),
        data: serde_json::json!({ "sessions": [] }),
    };
    hub.route_result_to_mobile(result.clone())
        .await
        .expect("route result");

    let received = rx_alice.recv().await.expect("alice receives result");
    assert_eq!(received, Frame::RpcResult(result));
    assert!(
        rx_bob.try_recv().is_err(),
        "bob must not see alice's result"
    );
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn route_result_to_mobile_unknown_id_returns_unknown_rpc_id() {
    let hub = UserHub::new(UserId::new("u"));
    let result = RpcResult::Err {
        id: RpcId::new("never-issued"),
        error: "stale".to_owned(),
    };
    let outcome = hub.route_result_to_mobile(result).await;
    assert!(matches!(outcome, Err(RouteError::UnknownRpcId)));
}

#[tokio::test]
async fn unregister_mobile_peer_prunes_pending_calls() {
    // After a mobile disconnects, any in-flight correlations it owned
    // must be dropped — otherwise a reconnect under the same DeviceId
    // would deliver stale results from the previous connection.
    let hub = UserHub::new(UserId::new("u"));
    let (tx_desktop, _rx_desktop) = mpsc::unbounded_channel();
    hub.register_desktop(DesktopId::new("desk"), tx_desktop)
        .await;

    let mobile = DeviceId::new("dev-disconnect");
    let (tx_mobile, _rx_mobile) = mpsc::unbounded_channel();
    hub.register_mobile_peer(mobile.clone(), tx_mobile).await;

    let call = RpcCall {
        id: RpcId::new("req-pending"),
        target_desktop_id: DesktopId::new("desk"),
        source_device_id: mobile.clone(),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    hub.forward_rpc_call(&mobile, call).await.expect("forward");
    assert_eq!(hub.pending_call_count().await, 1);

    hub.unregister_mobile_peer(&mobile).await;
    assert_eq!(hub.pending_call_count().await, 0);
}
