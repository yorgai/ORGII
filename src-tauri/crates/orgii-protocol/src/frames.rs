//! WebSocket message envelope shared by desktop and mobile peers.
//!
//! Every `Frame` is serialized as a single JSON object with a `kind`
//! discriminant. Frames carry their own routing fields where relevant
//! (`target_desktop_id`, `source_desktop_id`) so the relay can dispatch
//! them without parsing the payload body.

use crate::ids::{DesktopId, DeviceId, RpcId};
use crate::version::{PeerRole, ProtocolVersion};
use serde::{Deserialize, Serialize};

/// Top-level WebSocket message. New variants must be additive — older
/// peers ignore unknown `kind` values rather than dropping the
/// connection (see `version.rs` for the compatibility policy).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Frame {
    /// First frame on every WebSocket. Carries the peer's
    /// [`ProtocolVersion`], its [`PeerRole`], and a free-form
    /// `agent` user-agent string. Folded into [`Frame`] so that
    /// the same `serde_json::from_str::<Frame>(...)` decode path
    /// handles every inbound message — there is no separate
    /// "first-frame envelope" to special-case at the deserializer
    /// layer (callers still gate on receiving `Frame::Handshake`
    /// before any business frame, but that's a state-machine check,
    /// not a parser-shape check).
    Handshake {
        version: ProtocolVersion,
        role: PeerRole,
        agent: String,
    },

    /// Mobile → relay → desktop. Carries one logical RPC invocation.
    RpcCall(RpcCall),

    /// Desktop → relay → mobile. Result for a previously sent RPC call.
    RpcResult(RpcResult),

    /// Mobile → relay. Subscribe to per-session events for one or more
    /// desktops. `desktop_ids: []` is the fleet-view sentinel meaning
    /// "all paired desktops, including ones that pair later".
    Subscribe(Subscription),

    /// Mobile → relay. Cancel a previously requested subscription.
    Unsubscribe(Subscription),

    /// Desktop → relay → mobile. A single session event; the relay
    /// stamps `source_desktop_id` so the mobile UI can render the
    /// origin badge without an extra lookup.
    Event(SessionEvent),

    /// Relay → mobile. Proactive notification when a paired desktop
    /// goes online / offline / is unpaired.
    DesktopStatus(DesktopStatus),

    /// Liveness probes — sent every 30 s from each side.
    Ping,
    Pong,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RpcCall {
    pub id: RpcId,
    pub target_desktop_id: DesktopId,
    /// `DeviceId` of the mobile peer that originated this call. Stamped
    /// by the relay's WS hub from the inbound mobile connection's
    /// authenticated `X-Device-Id` header BEFORE the frame is forwarded
    /// to the destination desktop. The desktop bridge uses this to look
    /// up the per-device `PermissionTier` instead of treating the entire
    /// session under a single tier.
    ///
    /// The mobile client must NOT set this field — anything it sends is
    /// overwritten by the relay. The field is required (no v1-without-
    /// source path); a missing source on the wire is a hard decode error.
    pub source_device_id: DeviceId,
    pub command: String,
    /// Raw JSON value handed straight to the desktop's existing Tauri
    /// command handler. Type is not statically known here because each
    /// command has its own argument shape (see the desktop's
    /// `mobile_remote::dispatch` module for the per-command schemas).
    pub args: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum RpcResult {
    Ok { id: RpcId, data: serde_json::Value },
    Err { id: RpcId, error: String },
}

impl RpcResult {
    pub fn id(&self) -> &RpcId {
        match self {
            RpcResult::Ok { id, .. } | RpcResult::Err { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Subscription {
    pub desktop_ids: Vec<DesktopId>,
    /// Optional session-id substring filter. None = all sessions.
    pub session_filter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionEvent {
    pub source_desktop_id: DesktopId,
    pub session_id: String,
    /// Opaque event payload — schema owned by the desktop's existing
    /// session event broadcaster (see `api/websocket_handler.rs`).
    /// Mobile decodes by looking at the embedded `type` field.
    pub event: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DesktopStatus {
    pub desktop_id: DesktopId,
    pub status: DesktopStatusKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopStatusKind {
    Online,
    Offline,
    Unpaired,
}
