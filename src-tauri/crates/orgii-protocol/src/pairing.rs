//! Pairing data types — used by the relay's HTTP API and by the desktop /
//! mobile clients during the QR-plus-SAS flow.
//!
//! Refer to `Documentation/MainApp/collaboration/mobile-remote-control--0504.md`
//! → "Pairing flow" for the end-to-end sequence and security rationale.

use crate::ids::{DesktopId, DeviceId, UserId};
use crate::tier::PermissionTier;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Default time-to-live for a fresh pairing session, in seconds. The
/// relay generates the code+phrase on `POST /pair/init` and discards
/// them after this window if the mobile side never claims.
pub const PAIRING_EXPIRY_SECONDS: u32 = 600;

/// 6-character pairing code, alphanumeric (uppercase + digits, no
/// look-alikes like 0/O or 1/I/L). Case-insensitive on input. Five-minute
/// TTL on the relay; this transit identifier is the QR's payload.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingCode(pub String);

impl PairingCode {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PairingCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Three-word + 4-digit Diceware-style phrase (~50 bits of entropy)
/// shown verbatim on both desktop and mobile so the user can confirm
/// out-of-band that the two devices are talking to the same pairing
/// session. Defends against shoulder-surfing the QR and relay-level
/// MITM.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConfirmationPhrase(pub String);

impl ConfirmationPhrase {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ConfirmationPhrase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// `POST /pair/init` body (desktop → relay).
///
/// `device_pubkey_fingerprint` is a hex-encoded SHA-256 fingerprint of
/// the desktop's public key. The relay records it on the pairing row
/// so the mobile side can verify, post-confirm, that the desktop it
/// later talks to over WS is the same one it paired with. For
/// Phase 2 the field is stored but not yet challenge-verified — a
/// stronger MITM check lands once the desktop has a real key pair.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingInitRequest {
    pub desktop_id: DesktopId,
    pub tier: PermissionTier,
    pub label: String,
    pub is_primary: bool,
    pub device_pubkey_fingerprint: String,
}

/// `POST /pair/init` response (relay → desktop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingInitResponse {
    pub pairing_code: PairingCode,
    pub confirmation_phrase: ConfirmationPhrase,
    pub expires_in_seconds: u32,
}

/// `POST /pair/claim` body (mobile → relay). The mobile side picks a
/// human label for itself ("Alice's iPhone") and submits its own
/// public-key fingerprint so the relay can record it on the paired
/// device row. The relay generates the `DeviceId` — the mobile does
/// not get to pick it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingClaimRequest {
    pub pairing_code: PairingCode,
    pub device_label: String,
    pub device_pubkey_fingerprint: String,
}

/// `POST /pair/claim` response. Mobile shows `confirmation_phrase`
/// alongside what the desktop is showing; user confirms a match before
/// proceeding to `POST /pair/confirm`.
///
/// `device_id` is the freshly-minted ID for this mobile peer — the
/// relay generates it and the mobile must persist it for use as the
/// claim subject in future calls. `desktop_id` and `user_id` echo back
/// the values the relay already knew so the mobile can render a
/// "Pairing with desktop X for user Y" confirmation screen without an
/// extra round-trip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingClaimResponse {
    pub desktop_id: DesktopId,
    pub user_id: UserId,
    pub device_id: DeviceId,
    pub tier: PermissionTier,
    pub label: String,
    pub confirmation_phrase: ConfirmationPhrase,
}

/// Identifies which side of the pairing is calling `POST /pair/confirm`.
/// The relay marks only that side confirmed; pairing finalises only
/// once *both* sides have called confirm in any order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmingSide {
    Desktop,
    Mobile,
}

/// `POST /pair/confirm` body. The desktop confirms the chosen tier (it
/// is the side that owns the permission decision); the mobile cannot
/// upgrade its own permissions, so when `confirming_side == Mobile` the
/// `tier` field is ignored by the relay. The asymmetry is intentional
/// — see `Auth & Pairing → Permission Model` in the design doc.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingConfirmRequest {
    pub pairing_code: PairingCode,
    pub confirming_side: ConfirmingSide,
    pub tier: PermissionTier,
}

/// Relay's reply to `POST /pair/confirm`. `Paired` is terminal —
/// when both sides have confirmed, the relay inserts a row in the
/// `paired_devices` table and the pairing code is one-shot consumed.
/// `AwaitingOtherSide` means the call was accepted but the partner
/// hasn't confirmed yet; the same code remains valid until expiry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingConfirmStatus {
    Paired,
    AwaitingOtherSide,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PairingConfirmResponse {
    pub status: PairingConfirmStatus,
    /// Freshly-issued device id for the now-paired mobile peer. Populated
    /// only when `status == Paired` (i.e. both sides have confirmed).
    /// `None` when `status == AwaitingOtherSide` because the device id is
    /// already known to the mobile (it was returned by `/pair/claim`) and
    /// the desktop side still needs to confirm before the row is finalised.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<DeviceId>,
}

// ============================================================
// Device CRUD endpoints (Phase 5: Lane-A A3)
// ============================================================
//
// `GET /devices`           → list all paired mobile devices for the caller's user
// `DELETE /devices/:id`    → revoke a paired device (relay-side enforced)
// `PUT /devices/:id/primary` → mark a desktop as the user's primary
//
// All three reuse the temporary `X-User-Id` header for auth (see
// `orgii_mobile_relay::handlers::pairing` for the rationale and the
// Phase 3 replacement plan).

/// One row in the device list returned by `GET /devices`. Mirrors
/// `storage::types::PairedDevice` minus the `user_id` (the caller is
/// the user; echoing it back wastes bytes) and `device_pubkey_fingerprint`
/// (we'll add a dedicated fingerprint endpoint when the desktop has
/// real keys; until then the value is a placeholder and not useful
/// for the client).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeviceListEntry {
    pub device_id: DeviceId,
    pub desktop_id: DesktopId,
    pub label: String,
    pub tier: PermissionTier,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
    pub is_primary: bool,
}

/// Response body for `GET /devices`. A struct rather than a bare
/// array so we can add pagination fields later without breaking the
/// wire shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeviceListResponse {
    pub devices: Vec<DeviceListEntry>,
}

/// Response body for `PUT /devices/:id/primary`. Echoes back which
/// `desktop_id` is now primary so the client can update local state
/// without a follow-up `GET`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SetPrimaryDesktopResponse {
    pub desktop_id: DesktopId,
}
