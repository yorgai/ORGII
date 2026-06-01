//! Tier-based command allowlist.
//!
//! The static command list itself lives in `orgii_protocol::tier` so the
//! desktop, the relay, and the mobile PWA agree on it byte-for-byte.
//! This module just exposes the protocol's helpers under the
//! `mobile_remote` namespace and adds a typed `Result` wrapper for use
//! by the dispatcher.

pub use orgii_protocol::PermissionTier;

use crate::error::MobileRemoteError;

/// Pure check — returns `true` iff `command` is permitted under `tier`.
pub fn is_allowed(tier: PermissionTier, command: &str) -> bool {
    tier.allows(command)
}

/// Allow-or-reject helper that produces a typed
/// [`MobileRemoteError::CommandNotAllowed`] for the dispatcher to bubble
/// up as an `RpcResult::Err`.
pub fn check_or_reject(tier: PermissionTier, command: &str) -> Result<(), MobileRemoteError> {
    if is_allowed(tier, command) {
        Ok(())
    } else {
        Err(MobileRemoteError::CommandNotAllowed(command.to_owned()))
    }
}

#[cfg(test)]
#[path = "allowlist_tests.rs"]
mod tests;
