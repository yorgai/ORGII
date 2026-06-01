//! Wire protocol for ORGII's mobile remote control feature.
//!
//! The desktop `mobile_remote` module and the standalone `orgii-mobile-relay`
//! server share this crate so both ends agree on the shape of every byte
//! that crosses the WebSocket.
//!
//! ## What lives here
//!
//! - [`Frame`]: the top-level WebSocket message envelope
//! - [`PermissionTier`]: read-only vs full-control allowlist key
//! - ID newtypes ([`UserId`], [`DesktopId`], [`DeviceId`], [`RpcId`])
//! - Pairing payloads ([`PairingInitRequest`], [`PairingClaimRequest`], etc.)
//! - Protocol version constants and the [`Frame::Handshake`] variant
//!
//! ## What does NOT live here
//!
//! - Network IO (no tokio, reqwest, axum, tungstenite)
//! - Storage (no sqlx, rusqlite)
//! - Tauri / desktop-specific types (`SessionAggregateRecord`, etc.)
//! - Authentication policy beyond the static allowlist that follows the
//!   tier enum
//!
//! Keep additions to this crate "data-only". Anything that needs an
//! `await` belongs in a consumer crate.

pub mod frames;
pub mod ids;
pub mod pairing;
pub mod tier;
pub mod version;

pub use frames::{
    DesktopStatus, DesktopStatusKind, Frame, RpcCall, RpcResult, SessionEvent, Subscription,
};
pub use ids::{DesktopId, DeviceId, RpcId, UserId};
pub use pairing::{
    ConfirmationPhrase, ConfirmingSide, DeviceListEntry, DeviceListResponse, PairingClaimRequest,
    PairingClaimResponse, PairingCode, PairingConfirmRequest, PairingConfirmResponse,
    PairingConfirmStatus, PairingInitRequest, PairingInitResponse, SetPrimaryDesktopResponse,
    PAIRING_EXPIRY_SECONDS,
};
pub use tier::PermissionTier;
pub use version::{PeerRole, ProtocolVersion, PROTOCOL_VERSION};

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
