//! Stable per-install desktop identifier.
//!
//! The relay needs a `DesktopId` that is consistent across pairing
//! sessions on the same machine — otherwise every fresh app launch
//! would look like a brand-new desktop. We persist a UUID-based ID to
//! `~/.orgii/mobile-remote/desktop_id.txt` on first read.
//!
//! Phase 4 simplification: this is a tiny text file rather than a row
//! in the ORGII SQLite store. Phase 5+ will move identity into the
//! same auth surface that issues signed device tokens.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use orgii_protocol::DesktopId;

use crate::error::MobileRemoteError;

/// Subdirectory under `~/.orgii/` for mobile-remote state. Sibling to
/// `screenshots/`, `projects/`, etc.
pub(crate) const MOBILE_REMOTE_DIR: &str = "mobile-remote";
const DESKTOP_ID_FILE: &str = "desktop_id.txt";

/// Cached so repeated `load_or_create_desktop_id()` calls in the same
/// process don't pay the disk round-trip. Filled lazily on first hit.
static CACHED: OnceLock<DesktopId> = OnceLock::new();

/// Resolve `~/.orgii/mobile-remote/`. Caller is responsible for
/// `create_dir_all` before writing into it.
pub(crate) fn mobile_remote_dir() -> PathBuf {
    app_paths::orgii_root().join(MOBILE_REMOTE_DIR)
}

fn desktop_id_path() -> PathBuf {
    mobile_remote_dir().join(DESKTOP_ID_FILE)
}

/// Read the persisted desktop ID, generating + writing a fresh UUID
/// on first call. Subsequent calls (in this process or future runs)
/// return the same value.
pub fn load_or_create_desktop_id() -> Result<DesktopId, MobileRemoteError> {
    if let Some(id) = CACHED.get() {
        return Ok(id.clone());
    }
    let id = read_or_create_at(&desktop_id_path())?;
    // First writer wins; if another thread raced and won, prefer the
    // value already cached so all callers see the same DesktopId for
    // the life of the process.
    let _ = CACHED.set(id.clone());
    Ok(CACHED.get().cloned().unwrap_or(id))
}

/// Lower-level read/create that operates on an explicit path. Kept
/// `pub(crate)` so tests can drive it against a temp directory
/// without going through the global `OnceLock` cache.
pub(crate) fn read_or_create_at(path: &Path) -> Result<DesktopId, MobileRemoteError> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let trimmed = contents.trim();
            if trimmed.is_empty() {
                generate_and_persist(path)
            } else {
                Ok(DesktopId::new(trimmed))
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => generate_and_persist(path),
        Err(err) => Err(MobileRemoteError::Io(err)),
    }
}

fn generate_and_persist(path: &Path) -> Result<DesktopId, MobileRemoteError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let id = DesktopId::new(format!("desktop-{}", uuid::Uuid::new_v4()));
    fs::write(path, id.as_str())?;
    Ok(id)
}

/// Hex-encoded SHA-256 fingerprint placeholder for `PairingInitRequest::
/// device_pubkey_fingerprint`. Phase 4 doesn't yet have a real keypair
/// per desktop, so we hash a stable string that incorporates the
/// `DesktopId` — different installs produce different fingerprints
/// without being cryptographically meaningful. Phase 5+ will replace
/// this with the real public-key fingerprint.
pub fn placeholder_fingerprint(desktop_id: &DesktopId) -> String {
    use sha2::{Digest, Sha256};
    let input = format!("orgii-desktop-{}", desktop_id.as_str());
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
#[path = "desktop_identity_tests.rs"]
mod tests;
