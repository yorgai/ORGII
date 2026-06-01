//! Permission tier and the static command allowlist.
//!
//! The tier is set at pairing time and immutable for the life of the
//! issued device token. To "upgrade" a device's tier, revoke and re-pair.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Two-tier permission model picked at pairing time.
///
/// Three tiers were considered (read-only / scoped / full) but rejected
/// as over-granular for v1; revisit only after real usage data shows a
/// scoped middle ground is needed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionTier {
    /// Read-only: list and watch sessions, no mutating commands.
    ReadOnly,

    /// Full control: read-only + create / message / approve / cancel.
    /// Excludes destructive admin commands (KeyVault writes, settings,
    /// arbitrary file writes outside an active agent session).
    Full,
}

impl PermissionTier {
    /// Returns the static set of command names allowed for this tier.
    ///
    /// The list is intentionally hard-coded here (no string config / no
    /// runtime extension) so that an attacker who somehow gains relay
    /// access cannot widen a paired device's authority by editing data.
    /// To add a command, edit this function and ship a new build.
    pub const fn allowed_commands(self) -> &'static [&'static str] {
        match self {
            PermissionTier::ReadOnly => READ_ONLY_COMMANDS,
            PermissionTier::Full => FULL_COMMANDS,
        }
    }

    /// Returns true iff `command` is permitted under this tier.
    pub fn allows(self, command: &str) -> bool {
        self.allowed_commands().contains(&command)
    }
}

impl fmt::Display for PermissionTier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            PermissionTier::ReadOnly => "read_only",
            PermissionTier::Full => "full",
        };
        f.write_str(s)
    }
}

/// Read-only allowlist. Matches the design doc's "Wire Protocol →
/// command namespace" table.
const READ_ONLY_COMMANDS: &[&str] = &[
    "sessions_list",
    "session_get",
    "subscribe_session_events",
    "unsubscribe_session_events",
    "desktop_info",
];

/// Full-control allowlist. Strictly a superset of [`READ_ONLY_COMMANDS`].
const FULL_COMMANDS: &[&str] = &[
    "sessions_list",
    "session_get",
    "subscribe_session_events",
    "unsubscribe_session_events",
    "desktop_info",
    "session_create",
    "session_cancel",
    "agent_send_message",
    "agent_answer_question",
    "tool_call_approve",
    "tool_call_deny",
];
