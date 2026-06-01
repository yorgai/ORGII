//! Compact-fork primitive.
//!
//! When a *channel-attached* session triggers context compaction, we don't
//! want to keep mutating the same `session_id` — the chat user expects each
//! conversation thread to be addressable and the long-running session can
//! become a graveyard of compacted summaries. Instead we **fork**: persist
//! the compacted transcript into a *new* session whose `parent_session_id`
//! points at the old one, archive the old session, and rebind the chat's
//! `gateway_bindings` row to the new id. The user sees a one-line notice on
//! the next outbound message.
//!
//! Hermes parallel:
//! - Auto-compact fork: `hermes-agent/run_agent.py:7240-7301`
//!   (`end_session` → `create_session(parent_session_id=...)` →
//!   `rewrite_transcript(...)`).
//! - Manual `/compress`: `hermes-agent/gateway/run.py:6226-6321`
//!   (same plus `session_entry.session_id = new_id` to flip the binding).
//!
//! App-side (IDE-launched) sessions retain the existing in-place compact
//! behaviour — see `processor.rs:812-907`. The decision branch is
//! `BindingStore::find_by_target(session_id).is_some()`: a binding hit
//! means the session is owned by an external chat and must fork; no
//! binding means an app session and we keep the in-place semantics.
//!
//! # Failure mode
//!
//! If any step of the fork fails (DB write, binding update, etc.), the
//! caller falls back to in-place compaction so the user's turn still goes
//! through. The fork is best-effort — Hermes does the same: a failed
//! `create_session` falls back to logging and continuing the existing one.

use tracing::{info, warn};

use crate::integrations::gateway::ResetPolicy;
use crate::state::AgentAppState;

use super::super::persistence as unified_persistence;
use super::super::session_id::{next_version_for, with_version};
use super::super::SessionStatus;

/// Outcome of `attempt_fork`.
#[derive(Debug)]
pub enum ForkOutcome {
    /// Fork succeeded — caller must abort the current turn and re-dispatch
    /// the inbound message against `new_session_id`. The compacted
    /// transcript has already been persisted under the new id; the old
    /// session row is archived and the binding now points at the new id.
    Forked { new_session_id: String },
    /// Session is not channel-attached (no binding pointing at it). Caller
    /// keeps the in-place compaction path.
    NotChannelAttached,
    /// A fork was attempted but a step failed; caller falls back to
    /// in-place compaction so the user's turn still completes. The
    /// attached `reason` is also logged at `warn` level — keep it short
    /// and human-readable (e.g. `"next_version_for: sqlite locked"`).
    /// Exposed via the debug endpoint so E2E can assert on the
    /// failure mode without scraping server logs.
    Failed(String),
}

/// Inputs for `attempt_fork`. Bundled so the call site in
/// `processor.rs` stays terse.
pub struct ForkInputs<'a> {
    pub state: &'a AgentAppState,
    /// Compacted in-memory transcript (output of `ContextCompactor::compact`
    /// after `post_compact_cleanup`). The fork persists THIS into the new
    /// session, not the pre-compact transcript.
    pub compacted_messages: &'a [serde_json::Value],
    /// Old session id (the one currently being processed).
    pub old_session_id: &'a str,
    /// Reset policy is consulted only for `notify` flag — we honour the
    /// same user-visibility setting as idle-reset.
    pub reset_policy: &'a ResetPolicy,
}

/// Detect whether `session_id` is owned by a gateway binding and, if so,
/// perform the fork: persist compacted transcript under a new versioned
/// id, archive the old session, rebind the chat, queue notify.
///
/// Caller is responsible for aborting the current turn on `Forked` so the
/// user message gets re-dispatched against the new id (see
/// `ProcessingResult::fork_redirect`).
pub async fn attempt_fork(inputs: ForkInputs<'_>) -> ForkOutcome {
    let ForkInputs {
        state,
        compacted_messages,
        old_session_id,
        reset_policy,
    } = inputs;

    // 1. Detect channel attachment via reverse lookup.
    let Some(binding) = state.gateway_bindings.find_by_target(old_session_id).await else {
        return ForkOutcome::NotChannelAttached;
    };

    // 2. Mint the next versioned id under the same base.
    //
    // Strip a trailing `-vN` from `old_session_id` to recover the base.
    // Example: `osagent-telegram-42-v3` → base `osagent-telegram-42` → v4.
    // For first-time fork (`osagent-telegram-42`) the base IS the session id.
    //
    // `next_version_for` scans `agent_sessions` for existing rows. The
    // caller's `old_session_id` is, by `attempt_fork`'s contract, a live
    // in-memory session — it may or may not be committed to the DB yet
    // (see #p61: a session can be in the in-memory runtime pool but
    // still have an async pending `upsert_session`). We therefore treat
    // `old_session_id` as implicitly existing regardless of whether the
    // DB scan sees it, so `next_v >= old_v + 1` is guaranteed.
    let base = strip_version_suffix(old_session_id);
    let scanned_next_v = match tokio::task::spawn_blocking({
        let base = base.to_string();
        move || next_version_for(&base)
    })
    .await
    {
        Ok(Ok(v)) => v,
        Ok(Err(err)) => {
            let reason = format!("next_version_for({}): {}", base, err);
            warn!("[compact_fork] {} — falling back to in-place", reason);
            return ForkOutcome::Failed(reason);
        }
        Err(err) => {
            let reason = format!("next_version_for join error: {}", err);
            warn!("[compact_fork] {} — falling back to in-place", reason);
            return ForkOutcome::Failed(reason);
        }
    };
    // Raise `next_v` past the caller's current version. The caller's
    // version is `1` when `old_session_id == base`, else parsed from
    // the trailing `-vN`. This avoids a race where `old_session_id`
    // hasn't yet been flushed to `agent_sessions` (e.g. E2E driving
    // fork immediately after session creation — the row is pending an
    // async write and the DB scan returns 0 rows).
    let old_v: u32 = if old_session_id == base {
        1
    } else {
        old_session_id
            .rsplit_once("-v")
            .and_then(|(_, tail)| tail.parse::<u32>().ok())
            .unwrap_or(1)
    };
    let next_v = scanned_next_v.max(old_v + 1);
    let new_session_id = with_version(base, next_v);
    if new_session_id == old_session_id {
        let reason = format!(
            "computed new_session_id equals old ({}): base={:?}, scanned_next_v={}, old_v={}, next_v={}",
            old_session_id, base, scanned_next_v, old_v, next_v
        );
        warn!("[compact_fork] {}", reason);
        return ForkOutcome::Failed(reason);
    }

    // 3. Load old session record for parent metadata copy. If the row
    // hasn't been persisted yet (race with create-and-route: the binding
    // landed but `upsert_session` is still pending on a blocking
    // task), fall back to a minimal record synthesised from the
    // binding's `SessionKey`. The `channel` / `chat_id` on the
    // `SessionKey` are our source of truth for user-visible
    // addressing; `model` / `agent_definition_id` / `name` are left
    // as `None` and the re-dispatched message will refill them the
    // first time the new session boots.
    let old_record = match tokio::task::spawn_blocking({
        let sid = old_session_id.to_string();
        move || unified_persistence::get_session(&sid)
    })
    .await
    {
        Ok(Ok(Some(rec))) => rec,
        Ok(Ok(None)) => {
            warn!(
                "[compact_fork] get_session({}): no row — synthesising minimal record \
                 from binding (race: session row not yet flushed)",
                old_session_id
            );
            // `SessionKey` wraps the wire form `{channel}:{chat_id}`
            // (with an optional trailing `:{sender_id}` when
            // `group_sessions_per_user` is on). The first two fields
            // are what `prepend_reset_notice` keys on, so we carve
            // them off here.
            let raw = &binding.session_key.0;
            let mut parts = raw.splitn(3, ':');
            let channel = parts.next().unwrap_or("").to_string();
            let chat_id = parts.next().unwrap_or("").to_string();
            unified_persistence::UnifiedSessionRecord {
                session_id: old_session_id.to_string(),
                channel: if channel.is_empty() {
                    None
                } else {
                    Some(channel)
                },
                chat_id: if chat_id.is_empty() {
                    None
                } else {
                    Some(chat_id)
                },
                ..Default::default()
            }
        }
        Ok(Err(err)) => {
            let reason = format!("get_session({}): {}", old_session_id, err);
            warn!("[compact_fork] {}", reason);
            return ForkOutcome::Failed(reason);
        }
        Err(err) => {
            let reason = format!("get_session join error: {}", err);
            warn!("[compact_fork] {}", reason);
            return ForkOutcome::Failed(reason);
        }
    };

    // 4. Insert new session row with parent linkage. Inherits the full
    // identity quartet from the parent — see `build_forked_record` for
    // the contract.
    let now = chrono::Utc::now().to_rfc3339();
    let rec = build_forked_record(&old_record, &new_session_id, old_session_id, &now);
    let upsert_result =
        tokio::task::spawn_blocking(move || unified_persistence::upsert_session(&rec)).await;
    match upsert_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            let reason = format!("upsert_session({}): {}", new_session_id, err);
            warn!("[compact_fork] {}", reason);
            return ForkOutcome::Failed(reason);
        }
        Err(err) => {
            let reason = format!("upsert_session join error: {}", err);
            warn!("[compact_fork] {}", reason);
            return ForkOutcome::Failed(reason);
        }
    }

    // 5. Persist compacted transcript under new session id. Reuses
    // `save_subagent_transcript` because its row-by-row JSON shape
    // matches what the compactor produces (serde_json::Value).
    let persist_messages = compacted_messages.to_vec();
    let persist_result = tokio::task::spawn_blocking({
        let sid = new_session_id.clone();
        move || unified_persistence::save_subagent_transcript(&sid, &persist_messages)
    })
    .await;
    match persist_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            let reason = format!("save_subagent_transcript({}): {}", new_session_id, err);
            warn!(
                "[compact_fork] {} — old session still active; falling back to in-place",
                reason
            );
            let _ = tokio::task::spawn_blocking({
                let sid = new_session_id.clone();
                move || unified_persistence::delete_session(&sid)
            })
            .await;
            return ForkOutcome::Failed(reason);
        }
        Err(err) => {
            let reason = format!("save_subagent_transcript join error: {}", err);
            warn!("[compact_fork] {}", reason);
            return ForkOutcome::Failed(reason);
        }
    }

    // 6. Archive old session so it disappears from `list_sessions` (Phase
    // 59 filter `status != 'archived'`). Lineage is preserved via
    // `parent_session_id` on the new row.
    let archive_result = tokio::task::spawn_blocking({
        let sid = old_session_id.to_string();
        move || unified_persistence::update_status(&sid, SessionStatus::Archived)
    })
    .await;
    if let Ok(Err(err)) = archive_result {
        warn!(
            "[compact_fork] failed to archive old session {}: {} — fork will continue but
             old row remains visible in list_sessions",
            old_session_id, err
        );
        // Non-fatal: the binding is already updated below; UI will just
        // show two rows for one chat until a manual cleanup. Don't roll back.
    }

    // 7. Invalidate the old session's in-memory runtime so any cached
    // UnifiedMessageProcessor with the old session_id is torn down. The
    // re-dispatched message rebuilds a fresh runtime under the new id.
    // idle-reset takes the same step — see `perform_idle_reset`
    // in `state/commands/gateway.rs:524-527`.
    state.invalidate_session(old_session_id).await;

    // 8. Rebind chat → new session id. Both in-memory and DB are updated
    // by `BindingStore::set` (see binding.rs:152-185).
    state
        .gateway_bindings
        .set(binding.session_key.clone(), new_session_id.clone())
        .await;

    // 9. Queue user-facing notice (delivered as prefix on the next
    //    outbound message — same machinery as idle-reset).
    //
    // `prepend_reset_notice` in gateway.rs keys by `{channel}:{chat_id}`
    // (2 parts, not the full session_key which can carry a trailing
    // `:sender_id` when `group_sessions_per_user` is enabled). We derive
    // the 2-part shape from the old session record's channel/chat_id
    // fields so both the "reset" and "fork" notice paths share a key.
    if reset_policy.notify {
        match (&old_record.channel, &old_record.chat_id) {
            (Some(channel), Some(chat_id)) => {
                let key = format!("{}:{}", channel, chat_id);
                let notice = format!(
                    "🗜️ Context compacted. Continuing in new session `{}` (previous: `{}`).",
                    new_session_id, old_session_id
                );
                let mut guard = state.pending_reset_notifies.lock().await;
                guard.insert(key, notice);
            }
            _ => {
                warn!(
                    "[compact_fork] old session {} has no channel/chat_id — skipping notice",
                    old_session_id
                );
            }
        }
    }

    info!(
        "[compact_fork] forked {} → {} (binding rebound, parent linked, old archived)",
        old_session_id, new_session_id
    );

    ForkOutcome::Forked { new_session_id }
}

/// Build the new `UnifiedSessionRecord` written by a successful fork.
///
/// Pure helper extracted from `attempt_fork` so the inheritance contract
/// can be unit-tested without bringing up `AgentAppState` + a real DB.
///
/// Identity inheritance contract: the four billing/runtime-identity fields
/// (`model`, `account_id`, `workspace_path`, `key_source`) MUST round-trip
/// from `old_record` to the new row. The compactor produces a fresh
/// transcript but does not change *who* is paying or *which* code repo
/// the agent is operating against — those carry over so the resumed
/// session bills the same wallet and resolves the same workspace.
/// Skipping `account_id` / `key_source` was the original split-brain
/// shape: a hosted_key parent forking into an own_key child mis-billed
/// the post-compaction transcript to the user's BYOK wallet (or vice
/// versa). Status starts `Idle` — re-dispatched message flips it to
/// `Running` via the normal pipeline.
fn build_forked_record(
    old_record: &unified_persistence::UnifiedSessionRecord,
    new_session_id: &str,
    old_session_id: &str,
    now: &str,
) -> unified_persistence::UnifiedSessionRecord {
    unified_persistence::UnifiedSessionRecord {
        session_id: new_session_id.to_string(),
        name: old_record.name.clone(),
        status: SessionStatus::Idle.as_str().to_string(),
        model: old_record.model.clone(),
        account_id: old_record.account_id.clone(),
        workspace_path: old_record.workspace_path.clone(),
        session_type: old_record.session_type.clone(),
        channel: old_record.channel.clone(),
        chat_id: old_record.chat_id.clone(),
        user_input: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        parent_session_id: Some(old_session_id.to_string()),
        agent_definition_id: old_record.agent_definition_id.clone(),
        key_source: old_record.key_source,
        ..Default::default()
    }
}

/// Strip a trailing `-v{n}` suffix from a session id. Returns the input
/// unchanged when no suffix matches.
///
/// Examples:
/// - `osagent-telegram-42` → `osagent-telegram-42`
/// - `osagent-telegram-42-v2` → `osagent-telegram-42`
/// - `osagent-telegram-42-v17` → `osagent-telegram-42`
/// - `osagent-foo-v` → `osagent-foo-v` (no digits — not a version suffix)
fn strip_version_suffix(sid: &str) -> &str {
    if let Some(idx) = sid.rfind("-v") {
        let tail = &sid[idx + 2..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            return &sid[..idx];
        }
    }
    sid
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_types::key_source::KeySource;

    /// Pin the identity-quartet inheritance contract from the docstring on
    /// `build_forked_record`. The four fields below are the same matrix
    /// audited under "P1 Multi-field session identity resolvers" in
    /// `Documentation/RustBackend/agent-core-cleanup-todo--0429.md`:
    /// dropping any one of them on fork was the original split-brain
    /// shape (a hosted_key parent compacting into an own_key child, etc.).
    #[test]
    fn build_forked_record_inherits_identity_quartet() {
        let parent = unified_persistence::UnifiedSessionRecord {
            session_id: "osagent-telegram-42".into(),
            name: "Channel: telegram".into(),
            status: SessionStatus::Running.as_str().to_string(),
            model: Some("claude-opus-4-6".into()),
            account_id: Some("acct_market_42".into()),
            workspace_path: Some("/repos/example".into()),
            session_type: unified_persistence::session_type::CODING.to_string(),
            channel: Some("telegram".into()),
            chat_id: Some("42".into()),
            agent_definition_id: Some("builtin:sde".into()),
            key_source: KeySource::HostedKey,
            created_at: "2026-04-29T00:00:00Z".into(),
            updated_at: "2026-04-29T00:00:00Z".into(),
            ..Default::default()
        };

        let child = build_forked_record(
            &parent,
            "osagent-telegram-42-v2",
            "osagent-telegram-42",
            "2026-04-29T01:00:00Z",
        );

        assert_eq!(child.session_id, "osagent-telegram-42-v2");
        assert_eq!(
            child.parent_session_id.as_deref(),
            Some("osagent-telegram-42")
        );
        assert_eq!(child.status, SessionStatus::Idle.as_str());
        assert_eq!(child.model, parent.model);
        assert_eq!(child.account_id, parent.account_id);
        assert_eq!(child.workspace_path, parent.workspace_path);
        assert_eq!(
            child.key_source, parent.key_source,
            "key_source must inherit — fork must not silently downgrade \
             a hosted_key parent to an own_key child (billing footgun)"
        );
        assert_eq!(child.session_type, parent.session_type);
        assert_eq!(child.channel, parent.channel);
        assert_eq!(child.chat_id, parent.chat_id);
        assert_eq!(child.agent_definition_id, parent.agent_definition_id);
        assert!(
            child.user_input.is_none(),
            "fork starts with empty user_input"
        );
    }

    #[test]
    fn build_forked_record_inherits_own_key_too() {
        let parent = unified_persistence::UnifiedSessionRecord {
            session_id: "osagent-x".into(),
            account_id: Some("acct_byok".into()),
            key_source: KeySource::OwnKey,
            ..Default::default()
        };
        let child = build_forked_record(&parent, "osagent-x-v2", "osagent-x", "now");
        assert_eq!(child.key_source, KeySource::OwnKey);
        assert_eq!(child.account_id.as_deref(), Some("acct_byok"));
    }

    #[test]
    fn strip_version_suffix_no_suffix() {
        assert_eq!(
            strip_version_suffix("osagent-telegram-42"),
            "osagent-telegram-42"
        );
    }

    #[test]
    fn strip_version_suffix_v2() {
        assert_eq!(
            strip_version_suffix("osagent-telegram-42-v2"),
            "osagent-telegram-42"
        );
    }

    #[test]
    fn strip_version_suffix_high_version() {
        assert_eq!(
            strip_version_suffix("osagent-telegram-42-v123"),
            "osagent-telegram-42"
        );
    }

    #[test]
    fn strip_version_suffix_not_a_version() {
        // "-v" followed by non-digits is NOT a version suffix.
        assert_eq!(strip_version_suffix("osagent-vendor"), "osagent-vendor");
        assert_eq!(strip_version_suffix("osagent-foo-v"), "osagent-foo-v");
        assert_eq!(
            strip_version_suffix("osagent-foo-vbeta"),
            "osagent-foo-vbeta"
        );
    }

    #[test]
    fn strip_version_suffix_idempotent() {
        let once = strip_version_suffix("osagent-telegram-42-v3");
        let twice = strip_version_suffix(once);
        assert_eq!(once, twice);
    }
}
