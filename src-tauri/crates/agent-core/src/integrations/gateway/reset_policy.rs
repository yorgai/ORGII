//! Session idle-reset policy.
//!
//! Hermes reference: `SessionResetPolicy` in
//! `hermes-agent/gateway/config.py:101-139`.
//!
//! We deliberately implement only the `idle` mode for now — daily reset
//! (`at_hour`) and `both` are hermes features that assume a long-running
//! process with a clock, and we don't need them for the initial rollout.
//! The enum shape is kept compatible so adding them later is purely
//! additive (no serde breakage for existing configs).
//!
//! Unlike hermes, reset is *lazy*: `GatewayInboundHandler` checks the
//! policy on every inbound message and resets only the affected chat's
//! binding. There is no background sweeper task — matches hermes
//! `_is_session_expired` + `_should_reset` which are both called from
//! `get_or_create_session`.

use serde::{Deserialize, Serialize};

/// Which reset trigger(s) are enabled.
///
/// Hermes parallel: `SessionResetPolicy.mode` string
/// (`"daily" | "idle" | "both" | "none"`). We model it as an enum to get
/// exhaustive matching on the Rust side; serde_rename keeps the wire
/// format lowercase so future config migration from hermes is a copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ResetMode {
    /// Reset disabled (default for app-only installations with no channels).
    None,
    /// Reset when `last_activity_at` exceeds `idle_minutes`.
    #[default]
    Idle,
    // Daily / Both intentionally deferred — see module docs.
}

/// Idle-reset configuration for the gateway.
///
/// Hermes parallel: `SessionResetPolicy` dataclass. Field names match
/// where possible; wire format is `camelCase` to match the surrounding
/// `ChannelsConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetPolicy {
    #[serde(default)]
    pub mode: ResetMode,
    /// Minutes of inactivity before a chat's binding is reset and a new
    /// versioned session is minted. Hermes default is 1440 (24h); we
    /// pick 240 (4h) because channel conversations on phones are
    /// typically more bursty than Hermes's desktop API usage.
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u64,
    /// When true, the gateway prepends a one-line notice to the next
    /// outbound reply informing the user their session was auto-reset
    /// (hermes `SessionResetPolicy.notify`, `gateway/run.py:3519-3551`).
    #[serde(default = "app_utils::default_true")]
    pub notify: bool,
}

fn default_idle_minutes() -> u64 {
    240
}

impl Default for ResetPolicy {
    fn default() -> Self {
        Self {
            mode: ResetMode::default(),
            idle_minutes: default_idle_minutes(),
            notify: app_utils::default_true(),
        }
    }
}

impl ResetPolicy {
    /// Returns `true` iff this policy's active mode would ever reset a
    /// session. Cheap precondition check so the handler can skip the
    /// `list_expired` scan when disabled.
    pub fn is_active(&self) -> bool {
        matches!(self.mode, ResetMode::Idle) && self.idle_minutes > 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_idle() {
        let p = ResetPolicy::default();
        assert_eq!(p.mode, ResetMode::Idle);
        assert!(p.is_active());
    }

    #[test]
    fn idle_mode_active_when_positive_minutes() {
        let p = ResetPolicy {
            mode: ResetMode::Idle,
            idle_minutes: 60,
            notify: true,
        };
        assert!(p.is_active());
    }

    #[test]
    fn idle_mode_inactive_with_zero_minutes() {
        let p = ResetPolicy {
            mode: ResetMode::Idle,
            idle_minutes: 0,
            notify: true,
        };
        assert!(!p.is_active());
    }

    #[test]
    fn serde_roundtrip_matches_wire_format() {
        let p = ResetPolicy {
            mode: ResetMode::Idle,
            idle_minutes: 120,
            notify: false,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"mode\":\"idle\""));
        assert!(json.contains("\"idleMinutes\":120"));
        assert!(json.contains("\"notify\":false"));
        let back: ResetPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mode, ResetMode::Idle);
        assert_eq!(back.idle_minutes, 120);
        assert!(!back.notify);
    }
}
