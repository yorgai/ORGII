//! Pure data structs that flow between the storage trait and its
//! callers. Kept free of `rusqlite::Row` so the trait can also have an
//! in-memory impl for tests.
//!
//! Timestamps are i64 milliseconds since UNIX epoch
//! (`chrono::Utc::now().timestamp_millis()`); SQLite stores them as
//! INTEGER columns.

use orgii_protocol::{
    ConfirmationPhrase, DesktopId, DeviceId, PairingCode, PermissionTier, UserId,
};
use serde::{Deserialize, Serialize};

/// Logical "peer role" used by the connection-history table. Mirrors
/// `orgii_protocol::version::PeerRole` but kept separate so storage rows
/// don't drag the version module's serde tag conventions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerKind {
    Desktop,
    Mobile,
}

impl PeerKind {
    /// Wire/SQL representation. Used by both the `peer_role` TEXT
    /// column and the JSON wire format.
    pub const fn as_str(self) -> &'static str {
        match self {
            PeerKind::Desktop => "desktop",
            PeerKind::Mobile => "mobile",
        }
    }
}

/// Row in `paired_devices`. One per (mobile device, desktop) pair —
/// the relay never collapses a phone paired with two desktops into a
/// single row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairedDevice {
    pub device_id: DeviceId,
    pub user_id: UserId,
    pub desktop_id: DesktopId,
    pub label: String,
    pub tier: PermissionTier,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
    pub is_primary: bool,
    pub device_pubkey_fingerprint: String,
}

/// Row in `pending_pairings`. Lives only between `POST /pair/init` and
/// the second `POST /pair/confirm` (or expiry, whichever first).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingPairing {
    pub pairing_code: PairingCode,
    pub user_id: UserId,
    pub desktop_id: DesktopId,
    pub requested_tier: PermissionTier,
    pub confirmation_phrase: ConfirmationPhrase,
    pub expires_at_ms: i64,
    pub claimed_by_device_id: Option<DeviceId>,
    pub confirmed_by_desktop: bool,
    pub confirmed_by_mobile: bool,
    pub device_label: Option<String>,
    pub device_pubkey_fingerprint: Option<String>,
    pub desktop_pubkey_fingerprint: String,
}

/// Append-only audit row. Written for every dispatched RPC and for
/// system events (then `device_id` is None).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub user_id: UserId,
    pub device_id: Option<DeviceId>,
    pub command: String,
    pub ok: bool,
    pub latency_ms: i64,
    pub occurred_at_ms: i64,
    pub error_message: Option<String>,
}

/// Row in `connection_history`. `disconnected_at_ms` and the byte
/// counters are filled on close.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionHistoryEntry {
    pub user_id: UserId,
    pub peer_role: PeerKind,
    pub peer_id: String,
    pub connected_at_ms: i64,
    pub disconnected_at_ms: Option<i64>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}
