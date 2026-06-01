//! QR payload shown on the desktop during the pair-init step.
//!
//! The mobile app scans this JSON, calls `/pair/claim` with the
//! `pairing_code`, then prompts the user to compare the SAS against the
//! `fingerprint_hex` rendered alongside the QR. See
//! `Documentation/MainApp/collaboration/mobile-remote-control--0504.md`
//! → "Pairing flow".

use orgii_protocol::{ConfirmationPhrase, DesktopId, PairingCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// JSON payload encoded into the desktop's QR code.
///
/// `fingerprint_hex` is derived from the [`ConfirmationPhrase`] so the
/// mobile side can verify (without trusting the relay) that the phrase
/// the user sees on their phone matches the one the desktop generated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPayload {
    pub relay_url: String,
    pub pairing_code: PairingCode,
    pub desktop_id: DesktopId,
    pub fingerprint_hex: String,
}

impl QrPayload {
    /// Serialize to a compact JSON string for QR encoding.
    pub fn to_json(&self) -> String {
        // Safe to unwrap: `QrPayload`'s fields are all serializable
        // strings; `serde_json::to_string` only fails on cycles or
        // custom serializer panics, neither of which apply here.
        serde_json::to_string(self).expect("QrPayload serializes to JSON")
    }

    /// Derive the SAS fingerprint from a [`ConfirmationPhrase`].
    ///
    /// SHA-256, truncated to the first 16 bytes, hex-encoded → 32-char
    /// lowercase hex string. Truncation is acceptable here because the
    /// fingerprint is only used for human-eye comparison alongside the
    /// already-low-entropy SAS.
    pub fn fingerprint_from_phrase(phrase: &ConfirmationPhrase) -> String {
        let mut hasher = Sha256::new();
        hasher.update(phrase.as_str().as_bytes());
        let digest = hasher.finalize();
        hex::encode(&digest[..16])
    }
}

#[cfg(test)]
#[path = "qr_payload_tests.rs"]
mod tests;
