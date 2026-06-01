//! Relay endpoint configuration for the desktop bridge.
//!
//! Today this is a process-local `RwLock` so the surface compiles and is
//! unit-testable. Phase 4 will persist `RelayUrlConfig` to the ORGII
//! settings store (same place as agent / key-vault config) so the
//! chosen relay survives app restarts.

use serde::{Deserialize, Serialize};
use std::sync::RwLock;

/// Default relay URL. Placeholder — the production relay address will
/// be decided once `orgii-mobile-relay` is deployed.
pub const DEFAULT_RELAY_URL: &str = "https://relay.orgii.ai";

/// Per-process relay endpoint setting.
///
/// `is_default = true` means "user has not overridden the bundled
/// default" — useful for the settings UI to render a "reset" affordance
/// that's a no-op when already at the default.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayUrlConfig {
    pub url: String,
    pub is_default: bool,
}

impl Default for RelayUrlConfig {
    fn default() -> Self {
        Self {
            url: DEFAULT_RELAY_URL.to_owned(),
            is_default: true,
        }
    }
}

static RELAY_URL: RwLock<Option<RelayUrlConfig>> = RwLock::new(None);

fn snapshot_or_default() -> RelayUrlConfig {
    RELAY_URL
        .read()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_default()
}

/// Read the current relay URL configuration.
pub fn get_relay_url() -> RelayUrlConfig {
    snapshot_or_default()
}

/// Replace the relay URL. An empty string resets to [`DEFAULT_RELAY_URL`].
pub fn set_relay_url(url: String) -> RelayUrlConfig {
    let trimmed = url.trim().to_owned();
    let next = if trimmed.is_empty() || trimmed == DEFAULT_RELAY_URL {
        RelayUrlConfig::default()
    } else {
        RelayUrlConfig {
            url: trimmed,
            is_default: false,
        }
    };
    if let Ok(mut guard) = RELAY_URL.write() {
        *guard = Some(next.clone());
    }
    next
}

/// Reset the in-memory cache. Test-only — never call from production code.
#[cfg(test)]
pub fn reset_for_test() {
    if let Ok(mut guard) = RELAY_URL.write() {
        *guard = None;
    }
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
