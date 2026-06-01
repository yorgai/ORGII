//! `GET /desktop/connect` — the desktop peer's WebSocket upgrade
//! endpoint.
//!
//! The desktop client at
//! `src-tauri/src/api/mobile_remote/relay_client/ws.rs` opens
//! `wss://relay/desktop/connect` from a native (non-browser) client,
//! so it can — and does — set custom headers. Identity therefore
//! arrives as the `X-User-Id` and `X-Desktop-Id` HTTP headers rather
//! than the URL query parameters the mobile (browser) client uses.
//! The two handlers are otherwise structurally identical: see
//! [`super::ws_mobile`] for the route-side rationale that this module
//! mirrors.
//!
//! ## Authorization
//!
//! A desktop is allowed to attach to the relay iff at least one paired
//! mobile device is registered against this `(user_id, desktop_id)`
//! pair — i.e. the desktop has gone through the pairing flow at least
//! once. The check goes through the existing
//! [`Storage::list_paired_devices_for_user`] surface and filters by
//! `desktop_id`; no new storage methods are introduced here.
//!
//! ## Frame loop
//!
//! After the upgrade succeeds:
//!
//! 1. The first inbound text frame is parsed as a [`Frame`] and we
//!    require it to be the [`Frame::Handshake`] variant; its `role` /
//!    `version` are then validated. Folding the handshake into
//!    [`Frame`] means a single decode path handles every inbound
//!    message — no separate top-level envelope to special-case.
//! 2. On success the desktop's mpsc sender is installed on the
//!    [`UserHub`] via [`UserHub::register_desktop`].
//! 3. A `tokio::select!` loop pulls inbound frames off the socket and
//!    outbound frames off the hub-installed mpsc, mirroring
//!    [`super::ws_mobile`]. Disconnect is symmetric and triggers a
//!    single [`UserHub::unregister_desktop`].

use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::SinkExt;
use orgii_protocol::{DesktopId, Frame, PeerRole, ProtocolVersion, UserId, PROTOCOL_VERSION};
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::hub::UserHub;
use crate::state::AppState;
use crate::storage::Storage;

/// Bound on the per-desktop outbound mpsc. A slow desktop drops
/// hub-broadcast frames under sustained backpressure rather than
/// blocking the hub's broadcast / route paths.
const DESKTOP_OUTBOUND_CAPACITY: usize = 64;

/// Identifies the relay-side WS server in the [`Frame::Handshake`]
/// `agent` field. Surfaces in desktop-side debug logs so version
/// skew across the relay / desktop / mobile triplet is debuggable.
const RELAY_AGENT_STRING: &str = "orgii-mobile-relay";

/// Header carrying the desktop's authenticated [`UserId`]. The desktop
/// client at `mobile_remote::relay_client::ws` sends `X-User-Id` and
/// tungstenite normalizes it to lowercase before reaching axum, so we
/// match against the lowercase form to be defensive about future
/// transport changes.
const HEADER_USER_ID: &str = "x-user-id";

/// Header carrying the [`DesktopId`] this WS upgrade is binding to.
/// Same casing rationale as [`HEADER_USER_ID`].
const HEADER_DESKTOP_ID: &str = "x-desktop-id";

/// Public entry point: the route table merged into [`crate::routes`].
pub fn desktop_ws_routes() -> Router<AppState> {
    Router::new().route("/desktop/connect", get(desktop_ws_upgrade))
}

async fn desktop_ws_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    let user_id = match extract_header(&headers, HEADER_USER_ID) {
        Ok(value) => UserId::new(value),
        Err(resp) => return resp,
    };
    let desktop_id = match extract_header(&headers, HEADER_DESKTOP_ID) {
        Ok(value) => DesktopId::new(value),
        Err(resp) => return resp,
    };

    if let Err(resp) = authorize(&state.storage, &user_id, &desktop_id).await {
        return resp;
    }

    let hub = state.hub_registry.get_or_create_hub(&user_id).await;

    ws.on_upgrade(move |socket| async move {
        run_desktop_session(socket, hub, user_id, desktop_id).await;
    })
}

/// Pull a non-empty ASCII header value or build the upgrade-time
/// rejection response. Mirrors [`super::pairing::extract_user_id`]'s
/// shape so the auth surface is consistent across HTTP and WS.
fn extract_header(headers: &HeaderMap, name: &str) -> Result<String, axum::response::Response> {
    let Some(value) = headers.get(name) else {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            header = name,
            "rejecting desktop WS upgrade: missing required header",
        );
        return Err(StatusCode::BAD_REQUEST.into_response());
    };
    let parsed = match value.to_str() {
        Ok(s) => s,
        Err(_) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                header = name,
                "rejecting desktop WS upgrade: header value not valid ASCII",
            );
            return Err(StatusCode::BAD_REQUEST.into_response());
        }
    };
    if parsed.is_empty() {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            header = name,
            "rejecting desktop WS upgrade: header value is empty",
        );
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    Ok(parsed.to_owned())
}

/// Verify that the calling user has at least one paired mobile device
/// targeting this desktop. The 403 conflation mirrors
/// [`super::ws_mobile::authorize`]: we do not want a probe to be able
/// to enumerate desktop ids across users.
async fn authorize(
    storage: &Arc<dyn Storage>,
    user_id: &UserId,
    desktop_id: &DesktopId,
) -> Result<(), axum::response::Response> {
    let paired = match storage.list_paired_devices_for_user(user_id).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                error = %err,
                "storage list_paired_devices_for_user failed",
            );
            return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    let has_pair = paired.iter().any(|row| &row.desktop_id == desktop_id);
    if !has_pair {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            user_id = %user_id,
            desktop_id = %desktop_id,
            "desktop WS upgrade rejected: no paired mobile device targets this desktop",
        );
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

/// Drive a desktop WS session from accepted upgrade through to graceful
/// teardown. The lifecycle, send / receive split, and bridge-task
/// shape are intentionally identical to
/// [`super::ws_mobile::run_mobile_session`] so the two handlers stay
/// easy to keep in sync.
async fn run_desktop_session(
    mut socket: WebSocket,
    hub: Arc<UserHub>,
    user_id: UserId,
    desktop_id: DesktopId,
) {
    tracing::info!(
        target: "orgii_mobile_relay::ws_desktop",
        user_id = %user_id,
        desktop_id = %desktop_id,
        "desktop WS connected",
    );

    // Read the desktop's handshake first. The protocol contract calls
    // for both sides to exchange a `Frame::Handshake` immediately
    // after the upgrade. We block on the first inbound text frame
    // because the hub registration must NOT happen until version +
    // role are validated — otherwise a stale or hostile peer could
    // clobber the routing slot for a legitimately-connected desktop.
    let (peer_version, peer_role) = match read_peer_handshake(&mut socket, &desktop_id).await {
        Ok(parts) => parts,
        Err(()) => return,
    };

    if !PROTOCOL_VERSION.is_compatible_with(peer_version) {
        send_close(
            &mut socket,
            close_code::POLICY,
            format!(
                "protocol major mismatch: relay={}.{} desktop={}.{}",
                PROTOCOL_VERSION.major,
                PROTOCOL_VERSION.minor,
                peer_version.major,
                peer_version.minor,
            ),
        )
        .await;
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            desktop_id = %desktop_id,
            relay = ?PROTOCOL_VERSION,
            peer = ?peer_version,
            "desktop WS rejected: incompatible protocol version",
        );
        return;
    }

    if peer_role != PeerRole::Desktop {
        send_close(
            &mut socket,
            close_code::POLICY,
            format!("wrong role on /desktop/connect: {:?}", peer_role),
        )
        .await;
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            desktop_id = %desktop_id,
            role = ?peer_role,
            "desktop WS rejected: wrong peer role on /desktop/connect",
        );
        return;
    }

    // Send the relay's matching handshake back. We represent ourselves
    // as `PeerRole::Mobile` from the desktop's perspective — the
    // desktop's counterpart inside the bridge is the mobile fleet.
    let server_handshake = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Mobile,
        agent: RELAY_AGENT_STRING.to_owned(),
    };
    let handshake_text = match serde_json::to_string(&server_handshake) {
        Ok(s) => s,
        Err(err) => {
            tracing::error!(
                target: "orgii_mobile_relay::ws_desktop",
                error = %err,
                "serializing handshake failed; closing socket",
            );
            return;
        }
    };
    if let Err(err) = socket.send(Message::Text(handshake_text.into())).await {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_desktop",
            error = %err,
            "failed to send handshake; closing socket",
        );
        return;
    }

    // Bounded outbound queue: hub-side senders that overflow drop the
    // frame and `tracing::warn!` rather than backing up the hub. The
    // bridge task forwards from the unbounded hub channel onto the
    // bounded socket channel, exactly mirroring `ws_mobile`.
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Frame>(DESKTOP_OUTBOUND_CAPACITY);
    let (hub_tx, mut hub_rx) = mpsc::unbounded_channel::<Frame>();
    let outbound_for_bridge = outbound_tx.clone();
    let bridge_desktop_id = desktop_id.clone();
    let hub_bridge = tokio::spawn(async move {
        while let Some(frame) = hub_rx.recv().await {
            if let Err(err) = outbound_for_bridge.try_send(frame) {
                tracing::warn!(
                    target: "orgii_mobile_relay::ws_desktop",
                    error = %err,
                    desktop_id = %bridge_desktop_id,
                    "desktop outbound queue full or closed; dropping frame",
                );
                if matches!(err, mpsc::error::TrySendError::Closed(_)) {
                    break;
                }
            }
        }
    });

    hub.register_desktop(desktop_id.clone(), hub_tx).await;

    // Drop the handler-local clone of the bounded sender so the only
    // remaining reference lives inside the bridge task — see
    // `ws_mobile` for the lifecycle rationale this mirrors.
    drop(outbound_tx);

    loop {
        tokio::select! {
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        handle_inbound_text(&hub, &user_id, &desktop_id, text.as_str()).await;
                    }
                    Some(Ok(Message::Binary(_))) => {
                        tracing::warn!(
                            target: "orgii_mobile_relay::ws_desktop",
                            desktop_id = %desktop_id,
                            "binary WS message rejected; protocol is JSON-only",
                        );
                    }
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        // axum auto-replies to control-frame pings; the
                        // application-level keepalive lives inside
                        // `Frame::Ping` / `Frame::Pong`.
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_desktop",
                            desktop_id = %desktop_id,
                            "desktop WS sent close",
                        );
                        break;
                    }
                    Some(Err(err)) => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_desktop",
                            error = %err,
                            desktop_id = %desktop_id,
                            "desktop WS read error",
                        );
                        break;
                    }
                    None => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_desktop",
                            desktop_id = %desktop_id,
                            "desktop WS stream ended",
                        );
                        break;
                    }
                }
            }
            outbound = outbound_rx.recv() => {
                match outbound {
                    Some(frame) => {
                        let text = match serde_json::to_string(&frame) {
                            Ok(t) => t,
                            Err(err) => {
                                tracing::warn!(
                                    target: "orgii_mobile_relay::ws_desktop",
                                    error = %err,
                                    desktop_id = %desktop_id,
                                    "serializing outbound frame failed; dropping",
                                );
                                continue;
                            }
                        };
                        if let Err(err) = socket.send(Message::Text(text.into())).await {
                            tracing::info!(
                                target: "orgii_mobile_relay::ws_desktop",
                                error = %err,
                                desktop_id = %desktop_id,
                                "WS sink closed while writing; ending session",
                            );
                            break;
                        }
                    }
                    None => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_desktop",
                            desktop_id = %desktop_id,
                            "outbound channel closed; ending session",
                        );
                        break;
                    }
                }
            }
        }
    }

    hub.unregister_desktop(&desktop_id).await;
    let _ = socket.close().await;
    let _ = hub_bridge.await;

    tracing::info!(
        target: "orgii_mobile_relay::ws_desktop",
        user_id = %user_id,
        desktop_id = %desktop_id,
        "desktop WS disconnected",
    );
}

/// Block on the first inbound text frame and decode it as a
/// [`Frame::Handshake`]. Returns `Err(())` (after logging at `warn`)
/// if the peer sends anything other than a valid handshake variant —
/// the caller then closes the socket without registering with the hub.
///
/// The handshake is folded into the [`Frame`] enum so a single
/// `serde_json::from_str::<Frame>` decode path handles every inbound
/// message; this function additionally requires the first frame
/// specifically be `Frame::Handshake { .. }`. Any other variant on
/// the first frame is treated as a protocol violation.
async fn read_peer_handshake(
    socket: &mut WebSocket,
    desktop_id: &DesktopId,
) -> Result<(ProtocolVersion, PeerRole), ()> {
    let first = match socket.recv().await {
        Some(Ok(Message::Text(text))) => text,
        Some(Ok(_other)) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                "first WS message was not a text handshake; closing",
            );
            return Err(());
        }
        Some(Err(err)) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                error = %err,
                "WS read error while waiting for handshake; closing",
            );
            return Err(());
        }
        None => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                "WS stream ended before handshake; closing",
            );
            return Err(());
        }
    };
    match serde_json::from_str::<Frame>(first.as_str()) {
        Ok(Frame::Handshake {
            version,
            role,
            agent: _,
        }) => Ok((version, role)),
        Ok(other) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                received = ?std::mem::discriminant(&other),
                "first frame was not a Handshake variant; closing",
            );
            Err(())
        }
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                error = %err,
                "failed to decode peer handshake; closing",
            );
            Err(())
        }
    }
}

/// Best-effort close-with-reason. Failures are logged at `info` and
/// swallowed because the peer may already be gone.
async fn send_close(socket: &mut WebSocket, code: u16, reason: String) {
    let frame = Some(CloseFrame {
        code,
        reason: reason.into(),
    });
    if let Err(err) = socket.send(Message::Close(frame)).await {
        tracing::info!(
            target: "orgii_mobile_relay::ws_desktop",
            error = %err,
            "send close frame failed; peer likely already gone",
        );
    }
}

/// Decode a single inbound text message and dispatch it. Errors map
/// to `tracing::warn!` rather than tearing down the socket: a single
/// malformed frame from a buggy desktop should not take the
/// connection down.
async fn handle_inbound_text(
    hub: &Arc<UserHub>,
    user_id: &UserId,
    desktop_id: &DesktopId,
    text: &str,
) {
    let frame: Frame = match serde_json::from_str(text) {
        Ok(f) => f,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                error = %err,
                desktop_id = %desktop_id,
                "desktop WS sent frame that failed to decode",
            );
            return;
        }
    };

    match frame {
        Frame::RpcResult(result) => {
            tracing::debug!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                rpc_id = %result.id(),
                "routing RpcResult to mobile originator",
            );
            if let Err(err) = hub.route_result_to_mobile(result).await {
                tracing::warn!(
                    target: "orgii_mobile_relay::ws_desktop",
                    error = %err,
                    desktop_id = %desktop_id,
                    "route_result_to_mobile failed",
                );
            }
        }
        Frame::Event(event) => {
            tracing::debug!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                source_desktop_id = %event.source_desktop_id,
                session_id = %event.session_id,
                "broadcasting session event to user's mobiles",
            );
            hub.broadcast_to_mobiles(Frame::Event(event)).await;
        }
        Frame::DesktopStatus(status) => {
            tracing::debug!(
                target: "orgii_mobile_relay::ws_desktop",
                user_id = %user_id,
                desktop_id = %desktop_id,
                ?status.status,
                "broadcasting desktop status to user's mobiles",
            );
            hub.broadcast_to_mobiles(Frame::DesktopStatus(status)).await;
        }
        Frame::Ping => {
            // Application-level liveness probe. Reply directly via the
            // hub so the response goes through the same routing layer
            // as everything else. Failures are benign — the desktop
            // is either gone or about to be GC'd, and missing one
            // pong does not break the protocol.
            if let Err(err) = hub.route_to_desktop(desktop_id, Frame::Pong).await {
                tracing::debug!(
                    target: "orgii_mobile_relay::ws_desktop",
                    error = %err,
                    desktop_id = %desktop_id,
                    "could not enqueue Pong; desktop likely disconnecting",
                );
            }
        }
        Frame::Pong => {
            // Liveness only — no shared last-seen state yet.
        }
        Frame::RpcCall(_) | Frame::Subscribe(_) | Frame::Unsubscribe(_) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                "desktop sent a mobile→desktop-only frame; dropping",
            );
        }
        Frame::Handshake { .. } => {
            // The handshake variant is a connection-bring-up artifact;
            // any second copy after registration is either a
            // misbehaving client or a replay. Drop it without
            // tearing down the socket — the registered routing
            // state is still valid.
            tracing::warn!(
                target: "orgii_mobile_relay::ws_desktop",
                desktop_id = %desktop_id,
                "desktop sent a duplicate Handshake frame post-registration; dropping",
            );
        }
    }
}

#[cfg(test)]
#[path = "ws_desktop_tests.rs"]
mod tests;
