//! Idle reset bookkeeping: detects when a chat's bound session has been
//! quiet long enough to archive, and queues a user-facing notice for the
//! next outbound to that chat.

use crate::bus::InboundMessage;
use crate::gateway::SessionKey;
use crate::state::AgentAppState;
use tracing::{info, warn};

/// Returns `true` if the session is currently processing a turn or has
/// active child (subagent) sessions, meaning it should not be idle-reset.
///
/// On a transient DB error (or panic in the spawn_blocking task) we
/// conservatively return `true` so the idle-reset path is skipped — losing
/// a real reset opportunity is recoverable; tearing down a session that
/// still has live subagents is not.
pub(super) async fn has_active_processes(state: &AgentAppState, session_id: &str) -> bool {
    if let Some(session) = state.get_session(session_id).await {
        if session.active_turn_id().await.is_some() {
            return true;
        }
    }
    let sid = session_id.to_string();
    let sid_for_log = session_id.to_string();
    match tokio::task::spawn_blocking(move || {
        use crate::session::persistence::get_child_sessions;
        get_child_sessions(&sid)
    })
    .await
    {
        Ok(Ok(children)) => children
            .iter()
            .any(|child| child.status == "running" || child.status == "active"),
        Ok(Err(err)) => {
            warn!(
                "[gateway] has_active_processes: DB error querying children for {}: {} \
                 — assuming active to avoid premature idle reset",
                sid_for_log, err
            );
            true
        }
        Err(join_err) => {
            warn!(
                "[gateway] has_active_processes: spawn_blocking panicked for {}: {} \
                 — assuming active to avoid premature idle reset",
                sid_for_log, join_err
            );
            true
        }
    }
}

/// Archive `old_session_id`, clear the `session_key` binding, and queue
/// a user-facing notice for the next outbound message to the same chat.
///
/// Does NOT mint the replacement session id eagerly — the handler
/// continues to "create fresh session" path which derives the base id
/// from `(channel, chat_id)` and bumps the version suffix via
/// `session_id::next_version_for` when a base id is already in use.
///
/// Hermes parallel: the body of `gateway/session.py:720-770` —
/// `reset_session` calls `db.end_session(..., "session_reset")`, clears
/// the in-memory map, and leaves mint-on-next-read to the lazy
/// `get_or_create_session` path.
pub(super) async fn perform_idle_reset(
    state: &AgentAppState,
    session_key: &SessionKey,
    old_session_id: &str,
    msg: &InboundMessage,
    policy: &crate::gateway::ResetPolicy,
) {
    info!(
        "[gateway] Idle reset: session_key={} target={} idle_minutes={}",
        session_key.as_str(),
        old_session_id,
        policy.idle_minutes
    );

    // 1. Archive the old session in persistence so it's hidden from
    //    default list views but still recoverable via status=archived
    //    filter.
    //
    //    Failures here only affect persistence visibility — we still
    //    drop the in-memory runtime and rebind below, so the user-facing
    //    reset still happens. We log instead of swallowing so persistent
    //    archive failures (e.g. DB locked) surface in production logs.
    let session_id_owned = old_session_id.to_string();
    let session_id_for_log = old_session_id.to_string();
    match tokio::task::spawn_blocking(move || {
        crate::session::persistence::update_status(
            &session_id_owned,
            crate::session::SessionStatus::Archived,
        )
    })
    .await
    {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => warn!(
            "[gateway] Idle reset: archive update for {} matched zero rows \
             (session may have been deleted concurrently)",
            session_id_for_log
        ),
        Ok(Err(err)) => warn!(
            "[gateway] Idle reset: failed to archive {}: {}",
            session_id_for_log, err
        ),
        Err(join_err) => warn!(
            "[gateway] Idle reset: spawn_blocking panicked while archiving {}: {}",
            session_id_for_log, join_err
        ),
    }

    // 2. Drop the in-memory runtime so the next message creates a fresh
    //    OS session with the new versioned id.
    state.invalidate_session(old_session_id).await;

    // 3. Clear the binding so the next inbound mints a new session.
    state.gateway_bindings.clear(session_key).await;

    // 4. Queue a notice for the next outbound (only when notify is on
    //    and the channel isn't on the excluded list — currently
    //    hardcoded empty; when we port hermes' `notify_exclude_platforms`
    //    this is where to check it).
    if policy.notify {
        let key = format!("{}:{}", msg.channel, msg.chat_id);
        let hours = (policy.idle_minutes as f64 / 60.0).round() as u64;
        let notice = format!(
            "⏰ Your previous session was auto-reset after {}h of inactivity. Starting fresh.",
            hours.max(1)
        );
        let mut pending = state.pending_reset_notifies.lock().await;
        pending.insert(key, notice);
    }
}
