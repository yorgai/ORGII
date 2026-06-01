//! End-to-end smoke test for `orgii-mobile-relay`.
//!
//! Exercises the entire desktop ↔ mobile message-relay loop in a single
//! tokio runtime against a real axum server bound to `127.0.0.1:0`. We
//! do NOT mock the WebSocket layer — the test uses `tokio-tungstenite`
//! as a client on both sides so a regression in the relay's frame
//! routing, handshake, or hub fan-out logic surfaces here.
//!
//! Why this test exists despite the unit tests in `src/`: the unit
//! tests cover individual handlers in isolation. They do not exercise
//! the end-to-end message path
//!
//!     mobile RPC frame → relay routes → desktop receives →
//!     desktop emits result frame → relay routes → mobile receives →
//!     desktop emits event → relay broadcasts → mobile receives
//!
//! which is the single most expensive seam to break. Routing logic
//! lives in `hub::user_hub`, frame serialization in `orgii_protocol`,
//! and authorization in the WS upgrade handlers; an integration test
//! is the only thing that catches a regression that touches the
//! intersection of the three.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use orgii_mobile_relay::routes::build_router;
use orgii_mobile_relay::storage::{MemoryStorage, Storage};
use orgii_mobile_relay::{hub::UserHubRegistry, AppState};
use orgii_protocol::{
    ConfirmingSide, DesktopId, DeviceId, Frame, PairingClaimRequest, PairingClaimResponse,
    PairingConfirmRequest, PairingConfirmResponse, PairingConfirmStatus, PairingInitRequest,
    PairingInitResponse, PeerRole, PermissionTier, RpcCall, RpcId, RpcResult, SessionEvent,
    PROTOCOL_VERSION,
};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// Per-frame receive budget. Generous enough to absorb scheduler jitter
/// on a loaded CI box; tight enough that a routing regression that
/// black-holes a frame surfaces as a test failure rather than a hang.
const FRAME_RECV_BUDGET: Duration = Duration::from_secs(2);

/// Total wall-clock budget for the whole smoke test. The
/// `tokio::test(flavor = "multi_thread")` harness applies this via
/// [`tokio::time::timeout`] around the body so a hang doesn't pin CI.
const TOTAL_BUDGET: Duration = Duration::from_secs(10);

/// Same agent string the production desktop / PWA clients use as the
/// `Frame::Handshake { agent }` field. The relay only logs it, but
/// matching production keeps relay logs identical between this test
/// and a real client and surfaces protocol-doc drift here first.
const TEST_AGENT_DESKTOP: &str = "orgii-smoke-desktop/0.1";
const TEST_AGENT_MOBILE: &str = "orgii-smoke-mobile/0.1";

type WsStream = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Boot the relay on `127.0.0.1:0`, return the bound `SocketAddr` plus
/// the spawned server task so the caller can abort it on teardown.
async fn spawn_relay() -> (SocketAddr, JoinHandle<()>) {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let state = AppState::new(storage, registry);
    let router = build_router(state);

    // Ephemeral port — `0` instructs the kernel to assign an unused one
    // so concurrent `cargo test` runs don't collide.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral loopback port");
    let addr = listener.local_addr().expect("read local_addr");

    let handle = tokio::spawn(async move {
        // Plain `axum::serve` (no graceful shutdown channel) — the test
        // teardown aborts the task directly. A graceful shutdown would
        // require an additional channel that adds nothing for the
        // smoke-test lifecycle.
        let _ = axum::serve(listener, router).await;
    });

    (addr, handle)
}

/// Drive `POST /pair/init`. Returns the issued pairing code +
/// confirmation phrase wrapper. Errors panic — the smoke test treats
/// pairing failures as test failures, not recoverable conditions.
async fn pair_init(
    client: &reqwest::Client,
    base: &str,
    user_id: &str,
    desktop_id: &str,
) -> PairingInitResponse {
    let body = PairingInitRequest {
        desktop_id: DesktopId::new(desktop_id),
        tier: PermissionTier::Full,
        label: "Smoke Desktop".into(),
        is_primary: true,
        device_pubkey_fingerprint: "fp-desktop-smoke".into(),
    };
    let resp = client
        .post(format!("{base}/pair/init"))
        .header("X-User-Id", user_id)
        .json(&body)
        .send()
        .await
        .expect("pair_init network");
    assert_eq!(resp.status(), 200, "pair_init returned non-200");
    resp.json::<PairingInitResponse>()
        .await
        .expect("pair_init decode")
}

/// Drive `POST /pair/claim`. Returns the response so the caller can
/// stash the freshly-minted `device_id`.
async fn pair_claim(
    client: &reqwest::Client,
    base: &str,
    user_id: &str,
    pairing_code: &orgii_protocol::PairingCode,
) -> PairingClaimResponse {
    let body = PairingClaimRequest {
        pairing_code: pairing_code.clone(),
        device_label: "Smoke Mobile".into(),
        device_pubkey_fingerprint: "fp-mobile-smoke".into(),
    };
    let resp = client
        .post(format!("{base}/pair/claim"))
        .header("X-User-Id", user_id)
        .json(&body)
        .send()
        .await
        .expect("pair_claim network");
    assert_eq!(resp.status(), 200, "pair_claim returned non-200");
    resp.json::<PairingClaimResponse>()
        .await
        .expect("pair_claim decode")
}

/// Drive `POST /pair/confirm`. The relay finalises the pairing only
/// after both sides confirm; intermediate calls return
/// [`PairingConfirmStatus::AwaitingOtherSide`].
async fn pair_confirm(
    client: &reqwest::Client,
    base: &str,
    user_id: &str,
    pairing_code: &orgii_protocol::PairingCode,
    side: ConfirmingSide,
    tier: PermissionTier,
) -> PairingConfirmResponse {
    let body = PairingConfirmRequest {
        pairing_code: pairing_code.clone(),
        confirming_side: side,
        tier,
    };
    let resp = client
        .post(format!("{base}/pair/confirm"))
        .header("X-User-Id", user_id)
        .json(&body)
        .send()
        .await
        .expect("pair_confirm network");
    assert_eq!(resp.status(), 200, "pair_confirm returned non-200");
    resp.json::<PairingConfirmResponse>()
        .await
        .expect("pair_confirm decode")
}

/// Open the desktop WS at `ws://addr/desktop/connect` carrying the
/// `X-User-Id` / `X-Desktop-Id` headers the production desktop client
/// sends. The handler reads the desktop's handshake first, then sends
/// its own; this helper performs both steps and returns the live
/// stream ready for business frames.
async fn open_desktop_ws(addr: SocketAddr, user_id: &str, desktop_id: &str) -> WsStream {
    let url = format!("ws://{addr}/desktop/connect");
    let mut request = url
        .as_str()
        .into_client_request()
        .expect("build desktop ws request");
    request.headers_mut().insert(
        "x-user-id",
        HeaderValue::from_str(user_id).expect("user-id header"),
    );
    request.headers_mut().insert(
        "x-desktop-id",
        HeaderValue::from_str(desktop_id).expect("desktop-id header"),
    );

    let (mut stream, _resp) = connect_async(request)
        .await
        .expect("desktop ws connect_async");

    // Desktop handshake first: the relay's `read_peer_handshake` blocks
    // on this before registering with the user hub.
    let desktop_handshake = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Desktop,
        agent: TEST_AGENT_DESKTOP.into(),
    };
    let text = serde_json::to_string(&desktop_handshake).expect("encode desktop handshake");
    stream
        .send(Message::Text(text.into()))
        .await
        .expect("send desktop handshake");

    // Relay's matching handshake comes back next. We don't assert on
    // its full shape — the unit tests cover that — but we do drain it
    // so subsequent reads pull business frames.
    let server_handshake = recv_frame(&mut stream).await;
    assert!(
        matches!(server_handshake, Frame::Handshake { .. }),
        "expected server handshake on desktop socket, got {server_handshake:?}",
    );

    stream
}

/// Open the mobile WS at `ws://addr/mobile/connect?...`. The PWA is a
/// browser, so the production protocol passes `(user_id, desktop_id,
/// device_id)` as query parameters rather than headers — this helper
/// follows the same convention.
async fn open_mobile_ws(
    addr: SocketAddr,
    user_id: &str,
    desktop_id: &str,
    device_id: &str,
) -> WsStream {
    let url = format!(
        "ws://{addr}/mobile/connect?user_id={user_id}&desktop_id={desktop_id}&device_id={device_id}",
    );
    let request = url
        .as_str()
        .into_client_request()
        .expect("build mobile ws request");

    let (mut stream, _resp) = connect_async(request)
        .await
        .expect("mobile ws connect_async");

    // Relay sends its handshake first on the mobile socket (the
    // handler's `run_mobile_session` flow); drain it before any
    // business frames so the caller can `recv_frame` without
    // accidentally pulling the handshake.
    let server_handshake = recv_frame(&mut stream).await;
    assert!(
        matches!(server_handshake, Frame::Handshake { .. }),
        "expected server handshake on mobile socket, got {server_handshake:?}",
    );

    // The PWA also sends its own handshake (logged but not gated on by
    // the relay). Sending one keeps the test's wire shape identical to
    // the production client and would catch a future protocol-tightening
    // change that starts requiring it.
    let mobile_handshake = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Mobile,
        agent: TEST_AGENT_MOBILE.into(),
    };
    let text = serde_json::to_string(&mobile_handshake).expect("encode mobile handshake");
    stream
        .send(Message::Text(text.into()))
        .await
        .expect("send mobile handshake");

    stream
}

/// Receive the next text WS message and decode it as a [`Frame`].
/// Panics on timeout / non-text / decode failure — the smoke test
/// treats every one of those as a regression worth surfacing.
async fn recv_frame(stream: &mut WsStream) -> Frame {
    let msg = timeout(FRAME_RECV_BUDGET, stream.next())
        .await
        .expect("ws recv timed out")
        .expect("ws stream ended unexpectedly")
        .expect("ws read error");
    match msg {
        Message::Text(text) => serde_json::from_str::<Frame>(&text).expect("decode inbound frame"),
        other => panic!("expected text frame, got {other:?}"),
    }
}

/// Send a [`Frame`] as a single text WS message. Panics on transport
/// errors for the same reason `recv_frame` does.
async fn send_frame(stream: &mut WsStream, frame: &Frame) {
    let text = serde_json::to_string(frame).expect("encode outbound frame");
    stream
        .send(Message::Text(text.into()))
        .await
        .expect("ws send failed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn full_pair_then_relay_rpc_and_event() {
    let result = timeout(TOTAL_BUDGET, run_smoke()).await;
    result.expect("smoke test exceeded total wall-clock budget");
}

async fn run_smoke() {
    // -----------------------------------------------------------------
    // 1. Boot the relay on an ephemeral port with in-memory storage.
    // -----------------------------------------------------------------
    let (addr, server_task) = spawn_relay().await;
    let base = format!("http://{addr}");
    let http = reqwest::Client::builder().build().expect("reqwest client");

    let user_id = "smoke-user";
    let desktop_id = "desk-smoke";

    // -----------------------------------------------------------------
    // 2. Pair desktop + mobile via the HTTP endpoints.
    //    init → claim → confirm(mobile) → confirm(desktop)
    // -----------------------------------------------------------------
    let init = pair_init(&http, &base, user_id, desktop_id).await;
    assert_eq!(
        init.expires_in_seconds,
        orgii_protocol::PAIRING_EXPIRY_SECONDS,
        "pair_init expiry should match protocol constant",
    );

    let claim = pair_claim(&http, &base, user_id, &init.pairing_code).await;
    assert_eq!(claim.confirmation_phrase, init.confirmation_phrase);
    assert_eq!(claim.desktop_id.as_str(), desktop_id);
    let device_id = claim.device_id.clone();

    let mobile_confirm = pair_confirm(
        &http,
        &base,
        user_id,
        &init.pairing_code,
        ConfirmingSide::Mobile,
        PermissionTier::Full,
    )
    .await;
    assert_eq!(
        mobile_confirm.status,
        PairingConfirmStatus::AwaitingOtherSide,
        "mobile-only confirm should leave the pairing pending",
    );

    let desktop_confirm = pair_confirm(
        &http,
        &base,
        user_id,
        &init.pairing_code,
        ConfirmingSide::Desktop,
        PermissionTier::Full,
    )
    .await;
    assert_eq!(
        desktop_confirm.status,
        PairingConfirmStatus::Paired,
        "both sides confirmed → status should be Paired",
    );

    // TODO(T1): once `PairingConfirmResponse` carries `device_id:
    // Option<DeviceId>` (T1 of plan-c is in flight at the time this
    // test was written), tighten this to
    //
    //     assert_eq!(desktop_confirm.device_id.as_ref(), Some(&device_id));
    //
    // For now we assert via `claim.device_id` so the whole pairing
    // chain has been exercised even though the relay's confirm
    // response can't yet echo it back.
    assert!(
        !device_id.as_str().is_empty(),
        "claim should have produced a non-empty device_id",
    );

    // -----------------------------------------------------------------
    // 3. Open both WebSockets — desktop first because the mobile WS
    //    upgrade authorizes against `paired_devices`, which is now
    //    populated, and the desktop WS authorizes on the same row.
    // -----------------------------------------------------------------
    let mut desktop_ws = open_desktop_ws(addr, user_id, desktop_id).await;
    let mut mobile_ws = open_mobile_ws(addr, user_id, desktop_id, device_id.as_str()).await;

    // The hub registers the desktop synchronously inside the WS
    // upgrade task, but the upgrade itself is racy with the next
    // RpcCall send: if the mobile RpcCall lands before the desktop's
    // bridge task has installed its sender, the hub's
    // `forward_rpc_call` would return `PeerNotConnected`. A short
    // settle yield closes the race deterministically; the unit tests
    // cover the un-raced path.
    tokio::time::sleep(Duration::from_millis(50)).await;

    // -----------------------------------------------------------------
    // 4. Mobile → desktop RpcCall routing.
    // -----------------------------------------------------------------
    let rpc_id = RpcId::new("rpc-smoke-1");
    let outgoing_call = Frame::RpcCall(RpcCall {
        id: rpc_id.clone(),
        target_desktop_id: DesktopId::new(desktop_id),
        // Relay overwrites this with the authenticated DeviceId; the
        // value here is intentionally a sentinel so a routing change
        // that forgets the overwrite would be visible.
        source_device_id: DeviceId::new("ignored-by-relay"),
        command: "sessions_list".into(),
        args: serde_json::json!({}),
    });
    send_frame(&mut mobile_ws, &outgoing_call).await;

    let received_call = recv_frame(&mut desktop_ws).await;
    let received_call = match received_call {
        Frame::RpcCall(call) => call,
        other => panic!("desktop expected RpcCall, got {other:?}"),
    };
    assert_eq!(received_call.id, rpc_id);
    assert_eq!(received_call.command, "sessions_list");
    assert_eq!(received_call.target_desktop_id.as_str(), desktop_id);
    assert_eq!(
        received_call.source_device_id, device_id,
        "relay must stamp the authenticated source_device_id on forwarded RpcCalls",
    );

    // -----------------------------------------------------------------
    // 5. Desktop → mobile RpcResult routing.
    // -----------------------------------------------------------------
    let result_frame = Frame::RpcResult(RpcResult::Ok {
        id: rpc_id.clone(),
        data: serde_json::json!({"sessions": []}),
    });
    send_frame(&mut desktop_ws, &result_frame).await;

    let received_result = recv_frame(&mut mobile_ws).await;
    match received_result {
        Frame::RpcResult(RpcResult::Ok { id, data }) => {
            assert_eq!(id, rpc_id);
            assert_eq!(data, serde_json::json!({"sessions": []}));
        }
        other => panic!("mobile expected RpcResult::Ok, got {other:?}"),
    }

    // -----------------------------------------------------------------
    // 6. Desktop → mobile event routing.
    // -----------------------------------------------------------------
    let event_frame = Frame::Event(SessionEvent {
        source_desktop_id: DesktopId::new(desktop_id),
        session_id: "sess-smoke".into(),
        event: serde_json::json!({"type": "smoke", "payload": 1}),
    });
    send_frame(&mut desktop_ws, &event_frame).await;

    let received_event = recv_frame(&mut mobile_ws).await;
    match received_event {
        Frame::Event(ev) => {
            assert_eq!(ev.session_id, "sess-smoke");
            assert_eq!(ev.source_desktop_id.as_str(), desktop_id);
            assert_eq!(ev.event, serde_json::json!({"type": "smoke", "payload": 1}));
        }
        other => panic!("mobile expected Event, got {other:?}"),
    }

    // -----------------------------------------------------------------
    // 7. Clean shutdown.
    // -----------------------------------------------------------------
    let _ = mobile_ws.close(None).await;
    let _ = desktop_ws.close(None).await;
    server_task.abort();
    let _ = server_task.await;
}
