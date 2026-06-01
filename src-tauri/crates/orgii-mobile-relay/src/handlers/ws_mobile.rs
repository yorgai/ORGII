//! `GET /mobile/connect` — the mobile peer's WebSocket upgrade
//! endpoint.
//!
//! The PWA in `mobile-pwa/` opens this socket from a browser. Browsers
//! cannot set custom headers on `new WebSocket(...)`, so the upgrade
//! request carries `user_id`, `desktop_id`, and `device_id` as URL
//! query parameters instead of the `X-User-Id` / `X-Desktop-Id` /
//! `X-Device-Id` triplet the desktop side uses. The validation done
//! here is intentionally identical: the device must be present in the
//! relay's `paired_devices` table for this user, and the desktop the
//! mobile is targeting must also belong to the user.
//!
//! TODO(phase 9 — auth): swap the query-param triplet for a real
//! short-lived bearer token derived from the pairing flow. The
//! present scheme is the same placeholder the desktop handler uses
//! via `X-User-Id`; see `handlers::devices` for the shared rationale
//! and the rolling replacement plan.
//!
//! ## Frame loop
//!
//! After the upgrade succeeds the handler:
//!
//! 1. Sends a [`Frame::Handshake`] variant (the protocol's first-frame
//!    contract). The handshake is folded into the [`Frame`] enum so a
//!    single decode path handles every inbound message — see
//!    `crates/orgii-protocol/src/frames.rs`.
//! 2. Registers an mpsc sender with the [`UserHub`] so the desktop
//!    side of the relay can route results and events back here.
//! 3. Drives a `tokio::select!` loop that simultaneously pulls
//!    inbound `Frame`s off the socket and outbound `Frame`s off the
//!    hub-installed mpsc.
//!
//! Disconnect is symmetric: whichever side of the loop notices the
//! close first ends the loop, which triggers a single
//! [`UserHub::unregister_mobile_peer`] so the mpsc sender doesn't
//! leak.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::SinkExt;
use orgii_protocol::{DesktopId, DeviceId, Frame, PeerRole, UserId, PROTOCOL_VERSION};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::hub::UserHub;
use crate::state::AppState;
use crate::storage::Storage;

/// Bound on the per-mobile outbound mpsc. A slow mobile peer therefore
/// drops events under sustained backpressure rather than blocking the
/// hub's broadcast / route paths — see the design doc's "mobile drops
/// events under sustained backpressure" gotcha.
const MOBILE_OUTBOUND_CAPACITY: usize = 32;

/// Identifies the relay-side WS server in the [`Frame::Handshake`]
/// `agent` field. Surfaces in mobile-side debug logs so version
/// skew across the relay / desktop / mobile triplet is debuggable.
const RELAY_AGENT_STRING: &str = "orgii-mobile-relay";

/// Query string for `GET /mobile/connect`. All three fields are
/// required because the relay refuses to mount a mobile peer that
/// isn't already in the paired-devices table, and the only way the
/// browser can convey identity is via the URL.
#[derive(Debug, Deserialize)]
pub struct MobileConnectParams {
    pub user_id: String,
    pub desktop_id: String,
    pub device_id: String,
}

/// Public entry point: the route table merged into [`crate::routes`].
pub fn mobile_ws_routes() -> Router<AppState> {
    Router::new().route("/mobile/connect", get(mobile_ws_upgrade))
}

async fn mobile_ws_upgrade(
    State(state): State<AppState>,
    Query(params): Query<MobileConnectParams>,
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    if params.user_id.is_empty() || params.desktop_id.is_empty() || params.device_id.is_empty() {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_mobile",
            "rejecting mobile WS upgrade: empty user_id / desktop_id / device_id"
        );
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    }

    let user_id = UserId::new(params.user_id);
    let desktop_id = DesktopId::new(params.desktop_id);
    let device_id = DeviceId::new(params.device_id);

    if let Err(resp) = authorize(&state.storage, &user_id, &desktop_id, &device_id).await {
        return resp;
    }

    let hub = state.hub_registry.get_or_create_hub(&user_id).await;

    ws.on_upgrade(move |socket| async move {
        run_mobile_session(socket, hub, user_id, desktop_id, device_id).await;
    })
}

/// Verify the (user, desktop, device) triple corresponds to a real
/// row in `paired_devices`. Returns the upgrade-time HTTP error to
/// reply with on failure; on success returns `Ok(())` and the WS
/// upgrade proceeds.
///
/// The 403 conflation is deliberate, mirroring `handlers::devices`:
/// we don't want a probe to be able to enumerate `device_id`s across
/// users.
async fn authorize(
    storage: &Arc<dyn Storage>,
    user_id: &UserId,
    desktop_id: &DesktopId,
    device_id: &DeviceId,
) -> Result<(), axum::response::Response> {
    let paired = match storage.get_paired_device(device_id).await {
        Ok(p) => p,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_mobile",
                error = %err,
                "storage lookup failed during mobile WS authorize",
            );
            return Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    let Some(row) = paired else {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_mobile",
            device_id = %device_id,
            user_id = %user_id,
            "mobile WS upgrade rejected: device not paired",
        );
        return Err(axum::http::StatusCode::FORBIDDEN.into_response());
    };
    if &row.user_id != user_id || &row.desktop_id != desktop_id {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_mobile",
            device_id = %device_id,
            user_id = %user_id,
            desktop_id = %desktop_id,
            "mobile WS upgrade rejected: paired record does not match query params",
        );
        return Err(axum::http::StatusCode::FORBIDDEN.into_response());
    }

    let desktops = match storage.list_paired_desktops_for_user(user_id).await {
        Ok(d) => d,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_mobile",
                error = %err,
                "storage list_paired_desktops_for_user failed",
            );
            return Err(axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    if !desktops.contains(desktop_id) {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_mobile",
            user_id = %user_id,
            desktop_id = %desktop_id,
            "mobile WS upgrade rejected: desktop_id not paired for this user",
        );
        return Err(axum::http::StatusCode::FORBIDDEN.into_response());
    }

    Ok(())
}

async fn run_mobile_session(
    mut socket: WebSocket,
    hub: Arc<UserHub>,
    user_id: UserId,
    desktop_id: DesktopId,
    device_id: DeviceId,
) {
    tracing::info!(
        target: "orgii_mobile_relay::ws_mobile",
        user_id = %user_id,
        desktop_id = %desktop_id,
        device_id = %device_id,
        "mobile WS connected",
    );

    // Send the relay's handshake first. The protocol contract calls
    // for both sides to exchange a `Frame::Handshake` immediately
    // after the upgrade. The relay represents itself as
    // `PeerRole::Desktop` from the mobile's perspective — the mobile's
    // counterpart is the desktop side of the bridge, and this is the
    // field the mobile logs surface for debugging.
    let server_handshake = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Desktop,
        agent: RELAY_AGENT_STRING.to_owned(),
    };
    let handshake_text = match serde_json::to_string(&server_handshake) {
        Ok(s) => s,
        Err(err) => {
            tracing::error!(
                target: "orgii_mobile_relay::ws_mobile",
                error = %err,
                "serializing handshake failed; closing socket",
            );
            return;
        }
    };
    if let Err(err) = socket.send(Message::Text(handshake_text.into())).await {
        tracing::warn!(
            target: "orgii_mobile_relay::ws_mobile",
            error = %err,
            "failed to send handshake; closing socket",
        );
        return;
    }

    // Bounded outbound queue: hub-side senders that overflow drop the
    // frame and `tracing::warn!` rather than backing up the hub. We
    // bridge a bounded receiver onto the hub's `UnboundedSender` API
    // by spawning a tiny forwarder task.
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<Frame>(MOBILE_OUTBOUND_CAPACITY);
    let (hub_tx, mut hub_rx) = mpsc::unbounded_channel::<Frame>();
    let outbound_for_bridge = outbound_tx.clone();
    let bridge_device_id = device_id.clone();
    let hub_bridge = tokio::spawn(async move {
        while let Some(frame) = hub_rx.recv().await {
            if let Err(err) = outbound_for_bridge.try_send(frame) {
                tracing::warn!(
                    target: "orgii_mobile_relay::ws_mobile",
                    error = %err,
                    device_id = %bridge_device_id,
                    "mobile outbound queue full or closed; dropping frame",
                );
                if matches!(err, mpsc::error::TrySendError::Closed(_)) {
                    break;
                }
            }
        }
    });

    hub.register_mobile_peer(device_id.clone(), hub_tx).await;

    // Drop the handler-local clone of the bounded sender so the only
    // remaining reference lives inside the bridge task. When the
    // hub's `UnboundedSender` is dropped on `unregister_mobile_peer`,
    // the bridge task ends, which drops its sender clone, which
    // closes `outbound_rx` and lets the loop exit cleanly.
    drop(outbound_tx);

    loop {
        tokio::select! {
            inbound = socket.recv() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        handle_inbound_text(&hub, &user_id, &desktop_id, &device_id, text.as_str()).await;
                    }
                    Some(Ok(Message::Binary(_))) => {
                        tracing::warn!(
                            target: "orgii_mobile_relay::ws_mobile",
                            device_id = %device_id,
                            "binary WS message rejected; protocol is JSON-only",
                        );
                    }
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                        // axum auto-replies to control-frame pings; the
                        // application-level keepalive lives inside
                        // `Frame::Ping` / `Frame::Pong`. No-op here.
                    }
                    Some(Ok(Message::Close(_))) => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_mobile",
                            device_id = %device_id,
                            "mobile WS sent close",
                        );
                        break;
                    }
                    Some(Err(err)) => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_mobile",
                            error = %err,
                            device_id = %device_id,
                            "mobile WS read error",
                        );
                        break;
                    }
                    None => {
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_mobile",
                            device_id = %device_id,
                            "mobile WS stream ended",
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
                                    target: "orgii_mobile_relay::ws_mobile",
                                    error = %err,
                                    device_id = %device_id,
                                    "serializing outbound frame failed; dropping",
                                );
                                continue;
                            }
                        };
                        if let Err(err) = socket.send(Message::Text(text.into())).await {
                            tracing::info!(
                                target: "orgii_mobile_relay::ws_mobile",
                                error = %err,
                                device_id = %device_id,
                                "WS sink closed while writing; ending session",
                            );
                            break;
                        }
                    }
                    None => {
                        // Bridge task ended (hub unregistered us
                        // externally, e.g. the device was revoked).
                        tracing::info!(
                            target: "orgii_mobile_relay::ws_mobile",
                            device_id = %device_id,
                            "outbound channel closed; ending session",
                        );
                        break;
                    }
                }
            }
        }
    }

    hub.unregister_mobile_peer(&device_id).await;
    // Closing the WS is best-effort — peer may have already gone.
    let _ = socket.close().await;
    let _ = hub_bridge.await;

    tracing::info!(
        target: "orgii_mobile_relay::ws_mobile",
        user_id = %user_id,
        desktop_id = %desktop_id,
        device_id = %device_id,
        "mobile WS disconnected",
    );
}

/// Decode a single inbound text message and forward / reject as
/// appropriate. Errors map to `tracing::warn!` rather than tearing
/// down the socket: a malformed frame from a buggy client should not
/// take the connection down — but we never echo synthetic errors
/// back as RPC results, since those would pollute the conversation.
async fn handle_inbound_text(
    hub: &Arc<UserHub>,
    user_id: &UserId,
    desktop_id: &DesktopId,
    device_id: &DeviceId,
    text: &str,
) {
    let mut value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_mobile",
                error = %err,
                device_id = %device_id,
                "mobile WS sent unparseable JSON",
            );
            return;
        }
    };

    // The PWA's `RpcCall` payload omits `source_device_id` because
    // the relay is the authoritative source of that field (see
    // `forward_rpc_call`'s contract). Inject the authenticated
    // `device_id` before calling `from_value::<Frame>` so the
    // protocol's `RpcCall { source_device_id: DeviceId }` decode
    // succeeds. `forward_rpc_call` will overwrite it again on the
    // forward path; the injection here exists purely so the strict
    // `serde` decode of `RpcCall` doesn't reject the frame.
    if value.get("kind").and_then(|v| v.as_str()) == Some("rpc_call") {
        if let Some(obj) = value.as_object_mut() {
            obj.entry("source_device_id".to_owned())
                .or_insert_with(|| serde_json::Value::String(device_id.as_str().to_owned()));
        }
    }

    let frame: Frame = match serde_json::from_value(value) {
        Ok(f) => f,
        Err(err) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_mobile",
                error = %err,
                device_id = %device_id,
                "mobile WS sent frame that failed to decode",
            );
            return;
        }
    };

    match frame {
        Frame::RpcCall(call) => {
            tracing::info!(
                target: "orgii_mobile_relay::ws_mobile",
                rpc_id = %call.id,
                command = %call.command,
                device_id = %device_id,
                target_desktop_id = %call.target_desktop_id,
                "forwarding mobile RpcCall",
            );
            if call.target_desktop_id != *desktop_id {
                tracing::warn!(
                    target: "orgii_mobile_relay::ws_mobile",
                    rpc_id = %call.id,
                    device_id = %device_id,
                    requested = %call.target_desktop_id,
                    bound = %desktop_id,
                    "mobile attempted to address a desktop other than the one this socket is bound to; rejecting",
                );
                return;
            }
            if let Err(err) = hub.forward_rpc_call(device_id, call).await {
                tracing::warn!(
                    target: "orgii_mobile_relay::ws_mobile",
                    error = %err,
                    device_id = %device_id,
                    "forward_rpc_call failed",
                );
            }
        }
        Frame::Subscribe(_) | Frame::Unsubscribe(_) => {
            // Phase 5 spike: subscriptions are accepted at the wire
            // but not yet routed; the desktop side doesn't emit
            // events for the mobile to subscribe to. Logging here is
            // enough to verify the wire path.
            tracing::debug!(
                target: "orgii_mobile_relay::ws_mobile",
                device_id = %device_id,
                "subscribe/unsubscribe accepted (no-op in phase 5)",
            );
        }
        Frame::Pong | Frame::Ping => {
            // Application-level liveness probes. We don't emit Pings
            // from the relay yet, so a Ping from the mobile gets
            // dropped silently; if we start emitting Pings later, the
            // mobile's Pong will land here.
        }
        Frame::RpcResult(_) | Frame::Event(_) | Frame::DesktopStatus(_) => {
            tracing::warn!(
                target: "orgii_mobile_relay::ws_mobile",
                device_id = %device_id,
                "mobile sent a desktop→mobile-only frame; dropping",
            );
        }
        Frame::Handshake {
            version,
            role,
            agent,
        } => {
            // First-frame handshake from the mobile peer. Phase 5 has
            // nothing to negotiate beyond protocol-major compatibility,
            // and the mobile already authenticated via header / query
            // before the upgrade succeeded, so we just log it. Adding
            // `Frame::Handshake` to this match — instead of routing
            // it through a separate top-level envelope — is the whole
            // point of phase S2: a single decode path for every
            // inbound message.
            tracing::debug!(
                target: "orgii_mobile_relay::ws_mobile",
                device_id = %device_id,
                user_id = %user_id,
                desktop_id = %desktop_id,
                ?version,
                ?role,
                %agent,
                "mobile peer sent Handshake",
            );
        }
    }
}

#[cfg(test)]
#[path = "ws_mobile_tests.rs"]
mod tests;
