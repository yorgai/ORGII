//! On-disk record of locally-paired mobile devices.
//!
//! Phase 4: a tiny JSON file at `~/.orgii/mobile-remote/paired_devices.json`.
//! Phase 5+ may move this into the main ORGII SQLite DB once the relay's
//! `paired_devices` table needs cross-device sync of revocation state.
//!
//! The on-disk shape is a JSON array of [`PairedDeviceRecord`]; writes are
//! atomic via the standard `.tmp` + rename dance.

use std::fs;
use std::path::{Path, PathBuf};

use orgii_protocol::PermissionTier;
use serde::{Deserialize, Serialize};

use crate::error::MobileRemoteError;
use crate::pairing::desktop_identity::mobile_remote_dir;

const PAIRED_DEVICES_FILE: &str = "paired_devices.json";

/// One paired-device row as persisted to disk.
///
/// Mirrors `commands::PairedDeviceInfo` but additionally records
/// `desktop_id` and `device_pubkey_fingerprint` for forensics — those
/// fields are not surfaced to the frontend today but are useful for
/// debugging "why did this device's connection get rejected?" reports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct PairedDeviceRecord {
    pub device_id: String,
    pub desktop_id: String,
    pub label: String,
    pub tier: PermissionTier,
    pub is_primary: bool,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
    pub device_pubkey_fingerprint: String,
}

/// Resolve the on-disk path for the paired-devices file.
fn paired_devices_path() -> PathBuf {
    mobile_remote_dir().join(PAIRED_DEVICES_FILE)
}

/// Load the persisted device list. Missing file = empty list (no
/// pairings yet); malformed JSON propagates as `Serialize` so the
/// caller can surface "your local pairing file is corrupt" instead
/// of pretending no devices exist.
pub fn load_paired_devices() -> Result<Vec<PairedDeviceRecord>, MobileRemoteError> {
    load_at(&paired_devices_path())
}

/// Replace the entire device list on disk. Atomic via tempfile + rename.
pub fn save_paired_devices(records: &[PairedDeviceRecord]) -> Result<(), MobileRemoteError> {
    save_at(&paired_devices_path(), records)
}

/// Append (or upsert by `device_id`) a single record.
pub fn add_paired_device(record: PairedDeviceRecord) -> Result<(), MobileRemoteError> {
    add_at(&paired_devices_path(), record)
}

/// Remove the record matching `device_id`. Returns `Ok(false)` if no
/// such device exists; `Ok(true)` if one was removed.
pub fn remove_paired_device(device_id: &str) -> Result<bool, MobileRemoteError> {
    remove_at(&paired_devices_path(), device_id)
}

// ============================================================
// Path-explicit helpers (testable without touching `~/.orgii/`)
// ============================================================

pub(crate) fn load_at(path: &Path) -> Result<Vec<PairedDeviceRecord>, MobileRemoteError> {
    match fs::read_to_string(path) {
        Ok(body) => {
            if body.trim().is_empty() {
                return Ok(Vec::new());
            }
            serde_json::from_str::<Vec<PairedDeviceRecord>>(&body).map_err(MobileRemoteError::from)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(MobileRemoteError::Io(err)),
    }
}

pub(crate) fn save_at(
    path: &Path,
    records: &[PairedDeviceRecord],
) -> Result<(), MobileRemoteError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Serialize first so a structural error doesn't leave a half-
    // written file behind.
    let body = serde_json::to_vec_pretty(records)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &body)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub(crate) fn add_at(path: &Path, record: PairedDeviceRecord) -> Result<(), MobileRemoteError> {
    let mut existing = load_at(path)?;
    if let Some(slot) = existing
        .iter_mut()
        .find(|r| r.device_id == record.device_id)
    {
        *slot = record;
    } else {
        existing.push(record);
    }
    save_at(path, &existing)
}

pub(crate) fn remove_at(path: &Path, device_id: &str) -> Result<bool, MobileRemoteError> {
    let mut existing = load_at(path)?;
    let before = existing.len();
    existing.retain(|r| r.device_id != device_id);
    let removed = existing.len() != before;
    if removed {
        save_at(path, &existing)?;
    }
    Ok(removed)
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
