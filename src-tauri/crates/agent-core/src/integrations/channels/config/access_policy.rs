//! Typed access policy for channel inbound filtering.
//!
//! Replaces the per-channel free-form `policy: String` matched against
//! `"open"` / `"allowlist"` / `"disabled"` with a typed enum + a single
//! `is_peer_allowed` helper, so:
//!
//! - Typos in user config (e.g. `"alowlist"`) cannot silently degrade to
//!   "open"; they fail closed (`Disabled`) and surface a `tracing::warn!`
//!   instead.
//! - The wire format stays the same lower-case strings (`"open"` /
//!   `"allowlist"` / `"disabled"`) so existing `config.json` files keep
//!   working.
//! - `weixin::is_allowed`, `wecom::is_dm_allowed`, `wecom::is_group_allowed`
//!   and the inline match in `feishu::event::process_message` all derive
//!   from this single source of truth.
//!
//! Per the workspace rule "Typed over strings": no other module should
//! match on the raw policy string.

use serde::{Deserialize, Serialize};
use tracing::warn;

/// Wire-format string constants. These appear in user-facing config
/// files and must stay stable; treat as a serialization contract.
pub mod policy_value {
    pub const OPEN: &str = "open";
    pub const ALLOWLIST: &str = "allowlist";
    pub const DISABLED: &str = "disabled";
}

/// Channel inbound access policy.
///
/// `Disabled` is the safe default for unknown values — typos in the
/// config silently opening a channel was the bug this enum closes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessPolicy {
    /// Accept inbound from any peer.
    Open,
    /// Accept inbound only from peers in the channel's allow list.
    Allowlist,
    /// Reject all inbound.
    Disabled,
}

impl AccessPolicy {
    /// Parse a wire-format string into an [`AccessPolicy`].
    ///
    /// Unknown strings fail closed to `Disabled` and emit a
    /// `tracing::warn!` so misconfiguration is visible in production
    /// logs. Empty strings are treated as "no policy set" and resolve
    /// to the caller-supplied `default`, since absence-of-config is
    /// distinct from misconfiguration.
    pub fn parse_or_disabled(raw: &str, channel_label: &str) -> Self {
        Self::parse_with_default(raw, Self::Disabled, channel_label)
    }

    /// Parse with an explicit fallback for the empty-string case.
    /// Unknown non-empty strings still fail closed to `Disabled`.
    pub fn parse_with_default(raw: &str, default: Self, channel_label: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return default;
        }
        match trimmed.to_ascii_lowercase().as_str() {
            policy_value::OPEN => Self::Open,
            policy_value::ALLOWLIST => Self::Allowlist,
            policy_value::DISABLED => Self::Disabled,
            other => {
                warn!(
                    "[{}] unknown access policy {:?} — failing closed to \"disabled\". \
                     Valid values: \"open\", \"allowlist\", \"disabled\".",
                    channel_label, other
                );
                Self::Disabled
            }
        }
    }

    /// Returns `true` when `peer` should be admitted under this policy.
    ///
    /// Allowlist matching is case-insensitive on trimmed entries to
    /// match the previous per-channel implementations (the wecom one
    /// was lower-case, weixin used `eq_ignore_ascii_case` — both
    /// converge here).
    pub fn allows(&self, allow_list: &[String], peer: &str) -> bool {
        match self {
            Self::Open => true,
            Self::Disabled => false,
            Self::Allowlist => allow_list
                .iter()
                .any(|entry| entry.trim().eq_ignore_ascii_case(peer.trim())),
        }
    }
}

/// Single source of truth for channel admission checks.
///
/// Callers pass the raw config string (or already-parsed `AccessPolicy`
/// via [`AccessPolicy::allows`]); unknown strings fail closed.
pub fn is_peer_allowed(
    policy: &str,
    allow_list: &[String],
    peer: &str,
    channel_label: &str,
) -> bool {
    AccessPolicy::parse_or_disabled(policy, channel_label).allows(allow_list, peer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_values() {
        assert_eq!(
            AccessPolicy::parse_or_disabled("open", "test"),
            AccessPolicy::Open
        );
        assert_eq!(
            AccessPolicy::parse_or_disabled("allowlist", "test"),
            AccessPolicy::Allowlist
        );
        assert_eq!(
            AccessPolicy::parse_or_disabled("disabled", "test"),
            AccessPolicy::Disabled
        );
    }

    #[test]
    fn parses_case_insensitive_and_trims() {
        assert_eq!(
            AccessPolicy::parse_or_disabled("  OPEN  ", "test"),
            AccessPolicy::Open
        );
        assert_eq!(
            AccessPolicy::parse_or_disabled("AllowList", "test"),
            AccessPolicy::Allowlist
        );
    }

    #[test]
    fn unknown_strings_fail_closed_to_disabled() {
        // Pre-fix: "alowlist" silently degraded to "open" via the
        // catch-all `_ => true` arm in three different per-channel
        // copies of `is_allowed`. Now it fails closed.
        assert_eq!(
            AccessPolicy::parse_or_disabled("alowlist", "test"),
            AccessPolicy::Disabled
        );
        assert_eq!(
            AccessPolicy::parse_or_disabled("public", "test"),
            AccessPolicy::Disabled
        );
        assert_eq!(
            AccessPolicy::parse_or_disabled("yes", "test"),
            AccessPolicy::Disabled
        );
    }

    #[test]
    fn empty_string_uses_caller_default() {
        assert_eq!(
            AccessPolicy::parse_with_default("", AccessPolicy::Open, "test"),
            AccessPolicy::Open
        );
        assert_eq!(
            AccessPolicy::parse_with_default("", AccessPolicy::Disabled, "test"),
            AccessPolicy::Disabled
        );
    }

    #[test]
    fn allowlist_matches_case_insensitive_with_trim() {
        let list = vec![" Alice ".to_string(), "BOB".to_string()];
        assert!(AccessPolicy::Allowlist.allows(&list, "alice"));
        assert!(AccessPolicy::Allowlist.allows(&list, "bob"));
        assert!(AccessPolicy::Allowlist.allows(&list, "Alice"));
        assert!(!AccessPolicy::Allowlist.allows(&list, "carol"));
    }

    #[test]
    fn open_admits_all_disabled_admits_none() {
        let list = vec!["alice".to_string()];
        assert!(AccessPolicy::Open.allows(&list, "anyone"));
        assert!(AccessPolicy::Open.allows(&[], "anyone"));
        assert!(!AccessPolicy::Disabled.allows(&list, "alice"));
        assert!(!AccessPolicy::Disabled.allows(&[], "anyone"));
    }

    #[test]
    fn helper_unknown_policy_denies() {
        // Regression: a typo in `policy` must not behave like "open".
        assert!(!is_peer_allowed("alowlist", &[], "alice", "test"));
        assert!(!is_peer_allowed(
            "public",
            &["alice".into()],
            "alice",
            "test"
        ));
    }
}
