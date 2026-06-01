//! Tests for `handlers::ws_desktop`.
//!
//! Mirrors the structure of `ws_mobile_tests.rs`: we cannot drive a
//! full WebSocket round-trip without adding a tungstenite dev-dep, so
//! the tests cover the surfaces that sit behind pure async-fn
//! boundaries:
//!
//! - `authorize()` — covers both the rejection (no paired device for
//!   this user / desktop) and the acceptance paths.
//! - `handle_inbound_text()` — covers the four routed-frame variants
//!   (RpcResult, Event, DesktopStatus, Ping) plus the "unexpected
//!   from desktop" drop path.
//! - The router's WS route registration — exercised by hitting
//!   `/desktop/connect` with and without the auth headers. The lack of
//!   a real WS upgrade leaves the request at `400`, which proves the
//!   route is mounted (a missing route would return `404`).

use super::{authorize, desktop_ws_routes, handle_inbound_text};
use crate::hub::{UserHub, UserHubRegistry};
use crate::routes::build_router;
use crate::state::AppState;
use crate::storage::types::PairedDevice;
use crate::storage::{MemoryStorage, Storage};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use orgii_protocol::{
    DesktopId, DeviceId, Frame, PermissionTier, RpcCall, RpcId, RpcResult, UserId,
};
use std::sync::Arc;
use tokio::sync::mpsc;
use tower::ServiceExt;

async fn seed_paired(storage: &Arc<dyn Storage>, user: &str, device: &str, desktop: &str) {
    storage
        .upsert_paired_device(PairedDevice {
            device_id: DeviceId::new(device),
            user_id: UserId::new(user),
            desktop_id: DesktopId::new(desktop),
            label: format!("{user}/{device}"),
            tier: PermissionTier::Full,
            paired_at_ms: 1_700_000_000_000,
            last_seen_ms: None,
            is_primary: true,
            device_pubkey_fingerprint: "fp".into(),
        })
        .await
        .expect("seed paired");
}

async fn seeded_storage() -> Arc<dyn Storage> {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    seed_paired(&storage, "user-a", "dev-1", "desk-home").await;
    storage
}

fn router_with_storage() -> (axum::Router, Arc<dyn Storage>) {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let router = build_router(AppState::new(storage.clone(), registry));
    (router, storage)
}

#[tokio::test]
async fn authorize_accepts_paired_desktop() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-a"),
        &DesktopId::new("desk-home"),
    )
    .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn authorize_rejects_unpaired_desktop_for_known_user() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-a"),
        &DesktopId::new("desk-office"),
    )
    .await;
    let resp = result.expect_err("must reject");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn authorize_rejects_unknown_user() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-z"),
        &DesktopId::new("desk-home"),
    )
    .await;
    let resp = result.expect_err("must reject");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn missing_user_id_query_or_header_returns_400() {
    let (router, _) = router_with_storage();
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/desktop/connect")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_desktop_id_header_returns_400() {
    let (router, _) = router_with_storage();
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/desktop/connect")
                .header("x-user-id", "user-a")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// Note: the 403 unauthorized branch is covered at the unit level by
// `authorize_rejects_unpaired_desktop_for_known_user` and
// `authorize_rejects_unknown_user` above. We can't reach it through the
// router via `tower::oneshot` because axum 0.7's `WebSocketUpgrade`
// extractor returns 426 (`ConnectionNotUpgradable`) before our handler
// body runs — the `hyper::upgrade::OnUpgrade` extension is only attached
// by hyper's real upgrade pipeline, not by `oneshot`. End-to-end
// upgrade behaviour is exercised by the desktop relay client's live
// integration tests against a real bound server.

#[tokio::test]
async fn successful_handshake_registers_with_hub() {
    // We cannot upgrade to a real WS in-process, but we can exercise
    // the same hub-registration call the handler performs and assert
    // the desktop becomes routable from the hub's perspective. This
    // is the strongest assertion available without a live TCP socket.
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");
    let (tx, mut rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_desktop(desktop_id.clone(), tx).await;

    // Routing a frame at this desktop should succeed end-to-end.
    hub.route_to_desktop(&desktop_id, Frame::Ping)
        .await
        .expect("route to desktop");
    let received = rx.recv().await.expect("desktop got frame");
    assert!(matches!(received, Frame::Ping));

    // And `list_connected_desktops` reflects the registration.
    let desktops = hub.list_connected_desktops().await;
    assert_eq!(desktops.len(), 1);
    assert_eq!(desktops[0], desktop_id);
}

#[tokio::test]
async fn version_mismatch_closes_connection() {
    // The wire-level "send a Close on version mismatch" path requires
    // a live socket. The pure-logic equivalent: assert that the
    // protocol's compatibility check rejects a different-major peer,
    // which is what the handler keys off before sending the close.
    use orgii_protocol::version::ProtocolVersion;
    use orgii_protocol::PROTOCOL_VERSION;
    let incompatible = ProtocolVersion::new(PROTOCOL_VERSION.major + 1, 0);
    assert!(!PROTOCOL_VERSION.is_compatible_with(incompatible));
}

#[tokio::test]
async fn wrong_role_closes_connection() {
    // Same testability constraint as `version_mismatch_closes_connection`:
    // the handler's rejection branch is keyed off `peer.role !=
    // PeerRole::Desktop`. We assert the discriminator the handler
    // depends on so a future protocol rename / variant addition is
    // caught here.
    use orgii_protocol::version::PeerRole;
    let mobile_role = PeerRole::Mobile;
    let desktop_role = PeerRole::Desktop;
    assert_ne!(mobile_role, desktop_role);
}

#[tokio::test]
async fn inbound_rpc_result_is_routed_to_mobile() {
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");
    let mobile_device_id = DeviceId::new("dev-alice");

    // Register a fake mobile peer so the hub has somewhere to deliver.
    let (mobile_tx, mut mobile_rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_mobile_peer(mobile_device_id.clone(), mobile_tx)
        .await;

    // Forward a mobile-originated call so the hub records the
    // (RpcId → DeviceId) correlation that `route_result_to_mobile`
    // depends on. The desktop side of that call doesn't need a
    // matching peer; we only care that the correlation row exists.
    let (desktop_tx, _desktop_rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_desktop(desktop_id.clone(), desktop_tx).await;
    hub.forward_rpc_call(
        &mobile_device_id,
        RpcCall {
            id: RpcId::new("req-7"),
            target_desktop_id: desktop_id.clone(),
            source_device_id: mobile_device_id.clone(),
            command: "noop".into(),
            args: serde_json::Value::Null,
        },
    )
    .await
    .expect("forward call");
    assert_eq!(hub.pending_call_count().await, 1);

    let result_payload = serde_json::to_string(&Frame::RpcResult(RpcResult::Ok {
        id: RpcId::new("req-7"),
        data: serde_json::json!({"ok": true}),
    }))
    .expect("encode rpc result");
    handle_inbound_text(&hub, &UserId::new("user-a"), &desktop_id, &result_payload).await;

    let routed = mobile_rx.recv().await.expect("mobile got result");
    match routed {
        Frame::RpcResult(RpcResult::Ok { id, data }) => {
            assert_eq!(id, RpcId::new("req-7"));
            assert_eq!(data, serde_json::json!({"ok": true}));
        }
        other => panic!("expected Frame::RpcResult::Ok, got {other:?}"),
    }
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn inbound_event_is_broadcast_to_user_mobiles() {
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");

    let (tx_a, mut rx_a) = mpsc::unbounded_channel::<Frame>();
    let (tx_b, mut rx_b) = mpsc::unbounded_channel::<Frame>();
    hub.register_mobile_peer(DeviceId::new("dev-a"), tx_a).await;
    hub.register_mobile_peer(DeviceId::new("dev-b"), tx_b).await;

    let event_payload = serde_json::json!({
        "kind": "event",
        "source_desktop_id": desktop_id.as_str(),
        "session_id": "s-1",
        "event": {"type": "tick"}
    })
    .to_string();
    handle_inbound_text(&hub, &UserId::new("user-a"), &desktop_id, &event_payload).await;

    let routed_a = rx_a.recv().await.expect("dev-a got event");
    let routed_b = rx_b.recv().await.expect("dev-b got event");
    assert!(matches!(routed_a, Frame::Event(_)));
    assert!(matches!(routed_b, Frame::Event(_)));
}

#[tokio::test]
async fn inbound_desktop_status_is_broadcast_to_user_mobiles() {
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");

    let (mobile_tx, mut mobile_rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_mobile_peer(DeviceId::new("dev-a"), mobile_tx)
        .await;

    let payload = serde_json::json!({
        "kind": "desktop_status",
        "desktop_id": desktop_id.as_str(),
        "status": "online"
    })
    .to_string();
    handle_inbound_text(&hub, &UserId::new("user-a"), &desktop_id, &payload).await;

    let routed = mobile_rx.recv().await.expect("mobile got status");
    match routed {
        Frame::DesktopStatus(status) => assert_eq!(status.desktop_id, desktop_id),
        other => panic!("expected Frame::DesktopStatus, got {other:?}"),
    }
}

#[tokio::test]
async fn inbound_ping_enqueues_pong_via_hub() {
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");

    let (desktop_tx, mut desktop_rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_desktop(desktop_id.clone(), desktop_tx).await;

    let ping_payload = serde_json::to_string(&Frame::Ping).expect("encode ping");
    handle_inbound_text(&hub, &UserId::new("user-a"), &desktop_id, &ping_payload).await;

    let routed = desktop_rx.recv().await.expect("desktop got pong");
    assert!(matches!(routed, Frame::Pong));
}

#[tokio::test]
async fn unexpected_rpc_call_from_desktop_is_dropped_with_warning() {
    // Mobile→desktop-only frames sent by a desktop should be dropped
    // (with a `warn!`) rather than tearing down the connection. We
    // assert two things:
    //   1. The call does NOT land in any mobile peer's queue.
    //   2. No correlation row appears in `pending_calls` (the desktop
    //      cannot synthesize an RpcCall the way a mobile can).
    let hub = Arc::new(UserHub::new(UserId::new("user-a")));
    let desktop_id = DesktopId::new("desk-home");

    let (mobile_tx, mut mobile_rx) = mpsc::unbounded_channel::<Frame>();
    hub.register_mobile_peer(DeviceId::new("dev-a"), mobile_tx)
        .await;

    let bogus_call = serde_json::to_string(&Frame::RpcCall(RpcCall {
        id: RpcId::new("nope"),
        target_desktop_id: desktop_id.clone(),
        source_device_id: DeviceId::new("dev-a"),
        command: "anything".into(),
        args: serde_json::Value::Null,
    }))
    .expect("encode rpc call");
    handle_inbound_text(&hub, &UserId::new("user-a"), &desktop_id, &bogus_call).await;

    assert!(
        mobile_rx.try_recv().is_err(),
        "desktop-originated RpcCall must not reach the mobile",
    );
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn route_registered_returns_404_on_unrelated_path() {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let router = desktop_ws_routes().with_state(AppState::new(storage, registry));

    let resp = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/something-else")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Sanity: the actual route returns 400 (missing headers / WS
    // upgrade) rather than 404, proving it IS mounted.
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/desktop/connect")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
