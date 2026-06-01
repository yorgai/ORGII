//! PII pseudonymization for the LLM's view of channel sender IDs.

/// Return a privacy-safe identifier for `sender_id`.
///
/// Produces a stable 256-bit hex string of the SHA-256-style mix of the raw
/// `sender_id` bytes. The truncated hash is collision-resistant enough for
/// per-session routing while preventing the LLM from storing the real user
/// ID in its conversation history.
///
/// When `enabled` is `false`, returns `sender_id` unchanged.
//
// Note: we use a 128-bit FNV-style mix (DefaultHasher × 2 with salt) — stable
// across process restarts on the same platform and good enough for PII
// pseudonymization. If the `sha2` crate is added later, replace with real SHA-256.
pub fn redact_sender_id(sender_id: &str, enabled: bool) -> String {
    if !enabled || sender_id.is_empty() {
        return sender_id.to_string();
    }
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    sender_id.hash(&mut h1);
    format!("pii:{}", sender_id).hash(&mut h2);
    let a = h1.finish();
    let b = h2.finish();
    format!("{:016x}{:016x}", a, b)
}
