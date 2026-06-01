//! `KeySource` — where credentials come from for a session.
//!
//! Hoisted into `core_types` so non-`agent_sessions` crates (key vault,
//! marketplace billing, project management) can reason about own-key vs
//! hosted-key sessions without forming a reverse dependency on
//! `agent_sessions`. Imported directly from `core_types::key_source`
//! everywhere; the previous `agent_sessions::common::KeySource` shim
//! has been deleted.

use std::fmt;

use serde::{Deserialize, Serialize};

/// Where credentials come from for a session.
///
/// This is the primary distinction between:
/// - User's own API keys (BYOK - Bring Your Own Key)
/// - Hosted ORGII keys routed through the ORGII proxy
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    /// User's own API keys from Code Accounts (BYOK).
    #[default]
    OwnKey,
    /// Hosted ORGII key routed through the ORGII proxy.
    HostedKey,
}

impl KeySource {
    /// Parse from a string value (DB column / wire payload).
    ///
    /// Returns `None` for unknown variants. Callers MUST decide whether to
    /// reject the input (DB read, filter param) or fall back to a documented
    /// default — silent catch-all is a billing footgun: routing a corrupt or
    /// typo'd value to `OwnKey` charges the user for what was actually a
    /// hosted session (or vice versa).
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "own_key" => Some(Self::OwnKey),
            "hosted_key" => Some(Self::HostedKey),
            _ => None,
        }
    }
}

impl fmt::Display for KeySource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_ref())
    }
}

impl AsRef<str> for KeySource {
    fn as_ref(&self) -> &str {
        match self {
            Self::OwnKey => "own_key",
            Self::HostedKey => "hosted_key",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::KeySource;

    #[test]
    fn parse_known_variants() {
        assert_eq!(KeySource::parse("own_key"), Some(KeySource::OwnKey));
        assert_eq!(KeySource::parse("hosted_key"), Some(KeySource::HostedKey));
    }

    #[test]
    fn parse_unknown_returns_none() {
        // Realistic typo / corruption cases that previously slipped through
        // the catch-all and were silently mapped to OwnKey.
        assert_eq!(KeySource::parse(""), None);
        assert_eq!(KeySource::parse("hosted"), None);
        assert_eq!(KeySource::parse("hsoted_key"), None); // transposed
        assert_eq!(KeySource::parse("OwnKey"), None); // wrong case
        assert_eq!(KeySource::parse("subscription_key"), None);
        // Old wire string is no longer accepted (Phase 4 rename).
        assert_eq!(KeySource::parse("market_key"), None);
    }

    #[test]
    fn parse_round_trips_with_as_ref() {
        for variant in [KeySource::OwnKey, KeySource::HostedKey] {
            let s = variant.as_ref();
            assert_eq!(KeySource::parse(s), Some(variant), "round-trip for {s}");
        }
    }
}
