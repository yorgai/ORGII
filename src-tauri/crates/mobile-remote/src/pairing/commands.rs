//! Tauri command surface for the mobile-remote settings page.
//!
//! Phase 4 wires each command into a real `PairingHttpClient` call
//! against the configured relay. Persistence of paired devices lives
//! in `pairing::storage`; the per-install desktop identity lives in
//! `pairing::desktop_identity`.
//!
//! The commands are NOT registered in `tauri::generate_handler!` yet;
//! that wiring lands in a parent commit alongside dispatch / WS work.

use orgii_protocol::{
    ConfirmingSide, DesktopId, DeviceId, PairingCode, PairingConfirmRequest, PairingConfirmStatus,
    PairingInitRequest, PermissionTier, UserId,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::config;
use crate::error::MobileRemoteError;
use crate::pairing::desktop_identity::{load_or_create_desktop_id, placeholder_fingerprint};
use crate::pairing::qr_payload::QrPayload;
use crate::pairing::storage::{
    add_paired_device, load_paired_devices, remove_paired_device, save_paired_devices,
    PairedDeviceRecord,
};
use crate::relay_client::PairingHttpClient;
use crate::supervisor::BridgeSupervisor;

/// Phase 4 placeholder user identity. Phase 5+ replaces this with a
/// real account ID issued by the ORGII account service (or a
/// pre-shared key for self-hosted relays). Anything calling the
/// relay must agree on this value, so we centralize it here.
const PLACEHOLDER_USER_ID: &str = "local-user";

/// String values accepted from the frontend for `tier`. Mirror
/// `PermissionTier`'s serde rename_all = "snake_case".
const TIER_READ_ONLY: &str = "read_only";
const TIER_FULL: &str = "full";

/// Output of `mobile_remote_pair_init` — what the desktop renders
/// alongside the QR code.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInitOutput {
    pub pairing_code: String,
    pub confirmation_phrase: String,
    /// JSON-encoded `QrPayload`. Frontend renders this string directly
    /// into a QR component without re-parsing.
    pub qr_payload: String,
    pub expires_in_seconds: u32,
}

/// One row in the paired-device list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceInfo {
    pub device_id: String,
    /// Desktop the device is paired to. Required for the
    /// "set as primary" affordance, which targets a desktop (not a
    /// device) at the relay layer.
    pub desktop_id: String,
    pub label: String,
    /// `"read_only"` or `"full"` — matches `orgii_protocol::PermissionTier`'s
    /// `Display` impl. Kept as a string at the wire boundary so the
    /// frontend doesn't need to import the Rust enum's serde shape.
    pub tier: String,
    pub is_primary: bool,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
}

impl From<PairedDeviceRecord> for PairedDeviceInfo {
    fn from(rec: PairedDeviceRecord) -> Self {
        Self {
            device_id: rec.device_id,
            desktop_id: rec.desktop_id,
            label: rec.label,
            tier: rec.tier.to_string(),
            is_primary: rec.is_primary,
            paired_at_ms: rec.paired_at_ms,
            last_seen_ms: rec.last_seen_ms,
        }
    }
}

/// Snapshot of [`config::RelayUrlConfig`] reshaped for the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayUrlInfo {
    pub url: String,
    pub is_default: bool,
}

impl From<config::RelayUrlConfig> for RelayUrlInfo {
    fn from(cfg: config::RelayUrlConfig) -> Self {
        Self {
            url: cfg.url,
            is_default: cfg.is_default,
        }
    }
}

/// Parse the wire string into the typed enum, rejecting unknown values
/// at the boundary so internal code only ever holds typed `PermissionTier`.
fn parse_tier(value: &str) -> Result<PermissionTier, String> {
    match value {
        TIER_READ_ONLY => Ok(PermissionTier::ReadOnly),
        TIER_FULL => Ok(PermissionTier::Full),
        other => Err(format!(
            "invalid tier {other:?}: expected {TIER_READ_ONLY:?} or {TIER_FULL:?}"
        )),
    }
}

/// Build a `PairingHttpClient` against the configured relay URL. Used
/// by every command in this file; broken out so a future change of
/// auth model only edits one place.
fn build_client() -> Result<PairingHttpClient, MobileRemoteError> {
    let cfg = config::get_relay_url();
    PairingHttpClient::new(cfg.url, UserId::new(PLACEHOLDER_USER_ID))
}

// ============================================================
// Commands
// ============================================================

/// Begin a pairing session. Calls `POST /pair/init`, derives the QR
/// payload from the relay's response, and returns shape ready for
/// the settings page to render.
#[tauri::command]
pub async fn mobile_remote_pair_init(
    tier: String,
    label: String,
    is_primary: bool,
) -> Result<PairingInitOutput, String> {
    let tier_enum = parse_tier(&tier)?;
    let desktop_id = load_or_create_desktop_id().map_err(|err| err.to_string())?;
    let fingerprint = placeholder_fingerprint(&desktop_id);

    let client = build_client().map_err(|err| err.to_string())?;
    let request = PairingInitRequest {
        desktop_id: desktop_id.clone(),
        tier: tier_enum,
        label,
        is_primary,
        device_pubkey_fingerprint: fingerprint,
    };

    let response = client
        .pair_init(&request)
        .await
        .map_err(|err| err.to_string())?;

    let qr = QrPayload {
        relay_url: client.base_url().to_owned(),
        pairing_code: response.pairing_code.clone(),
        desktop_id,
        fingerprint_hex: QrPayload::fingerprint_from_phrase(&response.confirmation_phrase),
    };

    Ok(PairingInitOutput {
        pairing_code: response.pairing_code.to_string(),
        confirmation_phrase: response.confirmation_phrase.to_string(),
        qr_payload: qr.to_json(),
        expires_in_seconds: response.expires_in_seconds,
    })
}

/// Confirm the SAS match and finalize pairing on the desktop side.
/// Calls `POST /pair/confirm`; if the relay reports `Paired` we
/// persist a `PairedDeviceRecord` locally so the device shows up in
/// `mobile_remote_list_devices`.
///
/// `tier` mirrors what the user picked at `pair_init` time. The
/// frontend already has it (it picked the value); passing it through
/// avoids needing a separate "what tier did we pick?" round-trip.
#[tauri::command]
pub async fn mobile_remote_pair_complete(pairing_code: String, tier: String) -> Result<(), String> {
    let tier_enum = parse_tier(&tier)?;
    let client = build_client().map_err(|err| err.to_string())?;
    let request = PairingConfirmRequest {
        pairing_code: PairingCode::new(pairing_code),
        confirming_side: ConfirmingSide::Desktop,
        tier: tier_enum,
    };

    let response = client
        .pair_confirm(&request)
        .await
        .map_err(|err| err.to_string())?;

    match response.status {
        PairingConfirmStatus::Paired => {
            // The relay echoes the freshly-minted DeviceId on the
            // terminal Paired response (post-T1 protocol contract); we
            // persist it verbatim so the on-disk record matches what
            // the relay's `paired_devices` row holds and so subsequent
            // RPCs from this device pass the bridge's tier-resolution
            // lookup without needing a manual sync.
            let device_id = response
                .device_id
                .ok_or(MobileRemoteError::PairingResponseMissingDeviceId)
                .map_err(|err| err.to_string())?;
            let desktop_id = load_or_create_desktop_id().map_err(|err| err.to_string())?;
            let now_ms = chrono::Utc::now().timestamp_millis();
            let record = PairedDeviceRecord {
                device_id: device_id.to_string(),
                desktop_id: desktop_id.to_string(),
                label: format!("Paired device ({})", request.pairing_code.as_str()),
                tier: tier_enum,
                is_primary: false,
                paired_at_ms: now_ms,
                last_seen_ms: None,
                device_pubkey_fingerprint: String::new(),
            };
            add_paired_device(record).map_err(|err| err.to_string())?;
            // First-pair case: at boot the bridge returned `Ok(None)`
            // because the paired-devices file was empty, and the
            // supervisor recorded "inactive". Now that we just wrote
            // a record, kick the supervisor so the bridge spins up
            // and starts accepting RPCs from the new device without
            // requiring an app restart.
            BridgeSupervisor::global().restart().await;
            Ok(())
        }
        PairingConfirmStatus::AwaitingOtherSide => {
            // The wizard drives both confirms in sequence, so the only
            // way to land here is a real flow bug. Refusing to write a
            // half-finalised record matches the "no fallback" rule and
            // surfaces the issue rather than silently producing a
            // record that points at no relay-side row.
            Err(MobileRemoteError::PairingNotFinalized.to_string())
        }
    }
}

/// List devices already paired to this desktop, read from the local
/// JSON store. Use [`mobile_remote_sync_devices`] to reconcile this
/// cache against the relay's authoritative list.
#[tauri::command]
pub async fn mobile_remote_list_devices() -> Result<Vec<PairedDeviceInfo>, String> {
    let records = load_paired_devices().map_err(|err| err.to_string())?;
    Ok(records.into_iter().map(PairedDeviceInfo::from).collect())
}

/// Reconcile the local paired-device cache against the relay's
/// authoritative `GET /devices` list. Returns the post-sync list so
/// the frontend can refresh its UI in one round-trip.
///
/// Sync semantics: we replace any local record whose `device_id` the
/// relay knows about with the relay's row (canonical source for tier,
/// label, primary flag, last_seen). Local records the relay does NOT
/// know about are dropped — they're either already-revoked or
/// pending-pairing placeholders that never finalised. Relay records
/// not yet in the local cache are added so freshly-completed pairings
/// pick up their real `device_id`.
#[tauri::command]
pub async fn mobile_remote_sync_devices() -> Result<Vec<PairedDeviceInfo>, String> {
    let client = build_client().map_err(|err| err.to_string())?;
    let response = client.list_devices().await.map_err(|err| err.to_string())?;

    let now_ms = chrono::Utc::now().timestamp_millis();
    let synced: Vec<PairedDeviceRecord> = response
        .devices
        .into_iter()
        .map(|entry| PairedDeviceRecord {
            device_id: entry.device_id.to_string(),
            desktop_id: entry.desktop_id.to_string(),
            label: entry.label,
            tier: entry.tier,
            is_primary: entry.is_primary,
            paired_at_ms: entry.paired_at_ms,
            last_seen_ms: entry.last_seen_ms.or(Some(now_ms)),
            device_pubkey_fingerprint: String::new(),
        })
        .collect();

    // Atomically replace local cache so a partial failure can't leave
    // it in an inconsistent state. `save_paired_devices` does the
    // tempfile + rename dance internally.
    save_paired_devices(&synced).map_err(|err| err.to_string())?;

    Ok(synced.into_iter().map(PairedDeviceInfo::from).collect())
}

/// Revoke a paired device. Calls `DELETE /devices/:id` so the relay
/// also drops the row; on success the local on-disk cache is updated.
///
/// If the relay returns 404 we still drop the local record — the
/// device was already gone server-side and our cache was stale.
#[tauri::command]
pub async fn mobile_remote_revoke_device(device_id: String) -> Result<(), String> {
    let client = build_client().map_err(|err| err.to_string())?;
    let typed_id = DeviceId::new(device_id.clone());

    match client.revoke_device(&typed_id).await {
        Ok(()) => {}
        Err(MobileRemoteError::RelayRejected { status: 404, .. }) => {
            warn!(
                device_id = %device_id,
                "relay reported device already revoked; reconciling local cache",
            );
        }
        Err(err) => return Err(err.to_string()),
    }

    let removed = remove_paired_device(&device_id).map_err(|err| err.to_string())?;
    if !removed {
        warn!(device_id = %device_id, "local cache had no record for revoked device");
    }
    // Tier map / primary device may have shifted (revoking the
    // primary device promotes whichever record is now first). Restart
    // the bridge so it picks up the new `device_tiers` and
    // `fallback_tier` snapshot. If we just revoked the only paired
    // device, restart drives `start` → `Ok(None)` → bridge inactive,
    // which is exactly what we want.
    BridgeSupervisor::global().restart().await;
    Ok(())
}

/// Set the primary desktop for the user's account. Calls
/// `PUT /desktops/:id/primary` and refreshes the local cache from the
/// relay's response so the frontend sees the new primary flag without
/// a separate sync call.
#[tauri::command]
pub async fn mobile_remote_set_primary_desktop(desktop_id: String) -> Result<(), String> {
    let client = build_client().map_err(|err| err.to_string())?;
    let typed_id = DesktopId::new(desktop_id.clone());

    let _ = client
        .set_primary_desktop(&typed_id)
        .await
        .map_err(|err| err.to_string())?;

    // Mirror the change locally so the next list_devices reflects it
    // without waiting for a sync. We update is_primary in-place on the
    // matching desktop and clear it on every other.
    let mut current = load_paired_devices().map_err(|err| err.to_string())?;
    for record in current.iter_mut() {
        record.is_primary = record.desktop_id == desktop_id;
    }
    save_paired_devices(&current).map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn mobile_remote_set_relay_url(url: String) -> Result<(), String> {
    let previous = config::get_relay_url();
    let next = config::set_relay_url(url);
    // Idempotent: if the user clicked Save with the same URL still
    // in the field (or Reset on an already-default config), don't
    // churn the live WS connection. Comparing the full `RelayUrlConfig`
    // (url + is_default) is cheaper than a string equality check
    // because `set_relay_url` already trims and normalizes.
    if previous == next {
        return Ok(());
    }
    BridgeSupervisor::global().restart().await;
    Ok(())
}

#[tauri::command]
pub async fn mobile_remote_get_relay_url() -> Result<RelayUrlInfo, String> {
    Ok(config::get_relay_url().into())
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
