//! Stable session-id derivation for per-chat OS sessions and per-project
//! SDE sessions, plus versioning helpers used by the idle-reset
//! flow.
//!
//! # Design
//!
//! A versioned id is `{base}` for v1 and `{base}-v{n}` for v≥2.
//! Keeping v1 unsuffixed pins the id-stability invariant: a chat's
//! first incarnation always uses the bare `{base}` id, and only the
//! auto-reset path (idle expiry) introduces a `-v{n}` suffix. This
//! lets channels render `osagent-tg-42` for the common case and
//! reserves the suffixed form for sessions that have actually been
//! reset.
//!
//! Hermes parallel: `gateway/session.py:734` mints new ids on reset
//! using a timestamp+uuid suffix. We pick an incrementing integer
//! suffix instead because channels like Telegram show session ids in
//! `/status` replies and short human-readable ids (`osagent-tg-42-v2`)
//! are easier to correlate across a conversation than a UUID tail.
//! The divergence is explicitly called out in the plan.

use rusqlite::Result as SqliteResult;

use crate::definitions::prefix_lookup::OS_SESSION_PREFIX;
use database::db;

/// Lowercase + collapse non-`[a-z0-9\-_]` runs to `-`, trim leading/
/// trailing hyphens. Returns `fallback` when the result is empty so the
/// session id never degenerates to `osagent--` or `sdeagent-`.
pub(crate) fn slugify_segment(input: &str, fallback: &str) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Base (version-less) OS session id for an external chat.
pub fn os_session_id_base(channel: &str, chat_id: &str) -> String {
    let channel_slug = slugify_segment(channel, "channel");
    let chat_slug = slugify_segment(chat_id, "chat");
    format!("{}{}-{}", OS_SESSION_PREFIX, channel_slug, chat_slug)
}

/// Attach a version suffix. `version == 1` keeps the base id unchanged
/// (backward compat); `version >= 2` produces `{base}-v{n}`.
pub fn with_version(base: &str, version: u32) -> String {
    if version <= 1 {
        base.to_string()
    } else {
        format!("{}-v{}", base, version)
    }
}

/// Scan `agent_sessions` for the next free version suffix for `base`.
///
/// Semantics:
/// - no row at all → `1` (first-time creation uses the bare base id)
/// - base id exists (v1), no `-v{n}` suffixes → `2`
/// - highest suffix is `-v{n}` → `n + 1`
///
/// Called by the channel inbound handler (a brand-new chat gets v1 and a
/// chat whose previous session was archived by idle-reset gets v2+) and
/// by the compact-fork path. The scan is O(matching rows)
/// which is tiny in practice — one chat rarely accrues more than a
/// handful of forked sessions.
pub fn next_version_for(base: &str) -> SqliteResult<u32> {
    let conn = db::get_connection()?;
    let like = format!("{}%", base);
    let mut stmt =
        conn.prepare("SELECT session_id FROM agent_sessions WHERE session_id LIKE ?1")?;
    let rows = stmt.query_map([like], |row| row.get::<_, String>(0))?;

    let suffix_prefix = format!("{}-v", base);
    let mut base_exists = false;
    let mut max_version: u32 = 0;
    let mut row_count = 0usize;
    for sid in rows.flatten() {
        row_count += 1;
        if sid == base {
            base_exists = true;
            continue;
        }
        if let Some(tail) = sid.strip_prefix(&suffix_prefix) {
            if let Ok(v) = tail.parse::<u32>() {
                if v > max_version {
                    max_version = v;
                }
            }
        }
    }

    tracing::debug!(
        "[next_version_for] base={:?} rows={} base_exists={} max_version={}",
        base,
        row_count,
        base_exists,
        max_version
    );

    Ok(if max_version > 0 {
        max_version + 1
    } else if base_exists {
        2
    } else {
        1
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_base_is_per_chat() {
        assert_eq!(
            os_session_id_base("telegram", "123456"),
            "osagent-telegram-123456"
        );
        assert_ne!(
            os_session_id_base("telegram", "123"),
            os_session_id_base("telegram", "456")
        );
    }

    #[test]
    fn os_base_handles_dirty_input() {
        assert_eq!(
            os_session_id_base("telegram:bot", "-100:4567"),
            "osagent-telegram-bot-100-4567"
        );
    }

    #[test]
    fn os_base_never_empty() {
        assert_eq!(os_session_id_base("!!!", "???"), "osagent-channel-chat");
    }

    #[test]
    fn with_version_v1_unchanged() {
        assert_eq!(
            with_version("osagent-telegram-42", 1),
            "osagent-telegram-42"
        );
        assert_eq!(
            with_version("osagent-telegram-42", 0),
            "osagent-telegram-42"
        );
    }

    #[test]
    fn with_version_appends_suffix() {
        assert_eq!(
            with_version("osagent-telegram-42", 2),
            "osagent-telegram-42-v2"
        );
        assert_eq!(
            with_version("osagent-telegram-42", 17),
            "osagent-telegram-42-v17"
        );
    }
}
