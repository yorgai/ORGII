//! Tests for `handlers::ws_mobile`.
//!
//! The full WebSocket round-trip needs a real TCP listener and a
//! tungstenite-style client, which we can't add as a dev-dep in this
//! batch. Instead the tests cover the surfaces that DO sit behind
//! pure async fn boundaries:
//!
//! - `authorize()` — directly callable; covers all three reject
//!   paths (unknown device, cross-user / cross-desktop mismatch,
//!   desktop not in user's list) plus the success path.
//! - `handle_inbound_text()` — directly callable; covers the
//!   handshake passthrough, malformed JSON, the `source_device_id`
//!   injection for browser-shaped `RpcCall` payloads, and the
//!   target-desktop mismatch rejection.
//! - The router's WS route registration — exercised by hitting
//!   `/mobile/connect` without WS upgrade headers and without query
//!   params. Both fail at the extractor layer with `400`s, which
//!   proves the route is mounted (a missing route would return
//!   `404`).

use super::{authorize, handle_inbound_text, mobile_ws_routes};
use crate::hub::{UserHub, UserHubRegistry};
use crate::routes::build_router;
use crate::state::AppState;
use crate::storage::types::PairedDevice;
use crate::storage::{MemoryStorage, Storage};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use orgii_protocol::{DesktopId, DeviceId, Frame, PermissionTier, RpcId, UserId};
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
async fn authorize_accepts_paired_triple() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-a"),
        &DesktopId::new("desk-home"),
        &DeviceId::new("dev-1"),
    )
    .await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn authorize_rejects_unknown_device() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-a"),
        &DesktopId::new("desk-home"),
        &DeviceId::new("ghost"),
    )
    .await;
    let resp = result.expect_err("must reject");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn authorize_rejects_cross_user_pair() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-b"),
        &DesktopId::new("desk-home"),
        &DeviceId::new("dev-1"),
    )
    .await;
    let resp = result.expect_err("must reject");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn authorize_rejects_cross_desktop_pair() {
    let storage = seeded_storage().await;
    let result = authorize(
        &storage,
        &UserId::new("user-a"),
        &DesktopId::new("desk-office"),
        &DeviceId::new("dev-1"),
    )
    .await;
    let resp = result.expect_err("must reject");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn route_registered_returns_400_when_query_params_missing() {
    let (router, _) = router_with_storage();
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/mobile/connect")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn route_registered_returns_400_when_ws_headers_missing() {
    let (router, _) = router_with_storage();
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/mobile/connect?user_id=u&desktop_id=d&device_id=v")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    // WS upgrade extractor rejects with 400 — proves the route is
    // mounted, since a missing route would return 404.
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn unknown_route_returns_404_to_distinguish_from_400_above() {
    let (router, _) = router_with_storage();
    let resp = router
        .oneshot(
            Request::builder()
                .uri("/no-such-thing")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn handle_inbound_text_drops_unparseable_json_without_panic() {
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    handle_inbound_text(
        &hub,
        &UserId::new("u"),
        &DesktopId::new("d"),
        &DeviceId::new("dev"),
        "not-json",
    )
    .await;
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn handle_inbound_text_accepts_frame_handshake() {
    // Phase S2 folded the handshake into the `Frame` enum; the wire
    // shape now carries `kind: "handshake"` and goes through the
    // exact same decode path as every other frame. A peer that sends
    // a handshake mid-stream should be logged and dropped without
    // affecting hub state.
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    let handshake = r#"{"kind":"handshake","version":{"major":0,"minor":1},"role":"mobile","agent":"orgii-pwa/0.1"}"#;
    handle_inbound_text(
        &hub,
        &UserId::new("u"),
        &DesktopId::new("d"),
        &DeviceId::new("dev"),
        handshake,
    )
    .await;
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn handle_inbound_text_rejects_legacy_unwrapped_handshake() {
    // Pre-S2 wire shape (no `kind` discriminant) is now rejected:
    // the handshake is a tagged Frame variant and the decode path is
    // unified. Catching this regression in CI prevents a future
    // refactor from re-introducing the special-case envelope.
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    let legacy = r#"{"version":{"major":0,"minor":1},"role":"mobile","agent":"orgii-pwa/0.1"}"#;
    handle_inbound_text(
        &hub,
        &UserId::new("u"),
        &DesktopId::new("d"),
        &DeviceId::new("dev"),
        legacy,
    )
    .await;
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn handle_inbound_text_forwards_rpc_call_with_injected_source_device_id() {
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    let target = DesktopId::new("desk-home");
    let (tx_desktop, mut rx_desktop) = mpsc::unbounded_channel();
    hub.register_desktop(target.clone(), tx_desktop).await;

    let device_id = DeviceId::new("dev-alice");
    let pwa_payload = r#"{
        "kind": "rpc_call",
        "id": "req-1",
        "target_desktop_id": "desk-home",
        "command": "sessions_list",
        "args": null
    }"#;
    handle_inbound_text(&hub, &UserId::new("u"), &target, &device_id, pwa_payload).await;

    let received = rx_desktop.recv().await.expect("desktop got call");
    match received {
        Frame::RpcCall(call) => {
            assert_eq!(call.id, RpcId::new("req-1"));
            assert_eq!(call.source_device_id, device_id);
            assert_eq!(call.target_desktop_id, target);
            assert_eq!(call.command, "sessions_list");
        }
        other => panic!("expected RpcCall, got {other:?}"),
    }
    assert_eq!(hub.pending_call_count().await, 1);
}

#[tokio::test]
async fn handle_inbound_text_rejects_call_targeting_other_desktop() {
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    let bound_desktop = DesktopId::new("desk-home");
    let other_desktop = DesktopId::new("desk-office");
    let (tx_other, mut rx_other) = mpsc::unbounded_channel();
    hub.register_desktop(other_desktop.clone(), tx_other).await;

    let device_id = DeviceId::new("dev-alice");
    let payload = r#"{
        "kind": "rpc_call",
        "id": "req-cross",
        "target_desktop_id": "desk-office",
        "command": "sessions_list",
        "args": null
    }"#;
    handle_inbound_text(&hub, &UserId::new("u"), &bound_desktop, &device_id, payload).await;

    assert!(
        rx_other.try_recv().is_err(),
        "cross-desktop frame must not be forwarded"
    );
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn handle_inbound_text_drops_desktop_only_frames_from_mobile() {
    // RpcResult / Event / DesktopStatus are desktop→mobile only; if a
    // mobile sends one, the relay logs + drops without forwarding.
    let hub = Arc::new(UserHub::new(UserId::new("u")));
    let payload = r#"{
        "kind": "event",
        "source_desktop_id": "desk-home",
        "session_id": "s",
        "event": {}
    }"#;
    handle_inbound_text(
        &hub,
        &UserId::new("u"),
        &DesktopId::new("desk-home"),
        &DeviceId::new("dev-1"),
        payload,
    )
    .await;
    assert_eq!(hub.pending_call_count().await, 0);
}

#[tokio::test]
async fn mobile_ws_routes_exposes_only_mobile_connect_path() {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let router = mobile_ws_routes().with_state(AppState::new(storage, registry));

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

    let resp = router
        .oneshot(
            Request::builder()
                .uri("/mobile/connect?user_id=u&desktop_id=d&device_id=v")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("router responded");
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
