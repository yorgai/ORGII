//! Production [`InboxWakeHook`] backed by [`AgentAppState`].
//!
//! # What this hook does
//!
//! When `OrgSendMessageTool` writes a row to `agent_inbox`, the
//! recipient session may be idle or in a terminal state (`Completed` /
//! `Failed` / `Cancelled` / `Abandoned` / `Timeout`). Without a wake,
//! that session would never run another turn and the message would
//! sit unread in the inbox forever.
//!
//! [`AppHandleInboxWakeHook`] handles the wake by reusing the same
//! user-driven entry point that the IDE uses for "user resumed a
//! stopped session": [`send_message_impl`] called with empty content
//! and `is_resume=true`. That tells the processor to skip persisting
//! a synthetic user turn (`should_save_user_msg = !(is_resume &&
//! content.is_empty())` in `processor/mod.rs`) and to drain the
//! inbox payload at turn-boundary entry instead (`inbox_drain` hook
//! in the same file).
//!
//! # Why the inbox row is the source of truth (and the wake doesn't
//! re-attach the message)
//!
//! Every send is persisted to SQLite before this hook fires, so the
//! message survives recipient death independently of the wake. The
//! wake's only job is to start the turn loop again so the persisted
//! row gets drained. Re-attaching the message to the resumed loop's
//! prompt would duplicate it.

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use crate::coordination::agent_org_runs::{AgentOrgRunStatus, AgentOrgRunStore};
use crate::core::session::SessionStatus;
use crate::state::AgentAppState;
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;

/// Production [`InboxWakeHook`] that resolves the recipient session by
/// canonical `member_id` and, when the session is idle or terminal, fires
/// `send_message_impl(session_id, "", is_resume=true)` on a detached Tokio
/// task.
///
/// Failures (DB lookup errors, missing app handle, in-flight session)
/// are logged at `info!`/`warn!` and swallowed — the persisted inbox
/// row remains the source of truth, so a missed wake just means the
/// message is drained the next time the materialized recipient session
/// takes a turn.
pub struct AppHandleInboxWakeHook {
    app_handle: AppHandle,
}

impl AppHandleInboxWakeHook {
    pub fn new(app_handle: AppHandle) -> Arc<Self> {
        Arc::new(Self { app_handle })
    }
}

impl InboxWakeHook for AppHandleInboxWakeHook {
    fn wake_member(&self, member_id: &str, org_run_id: &str) {
        let member = member_id.to_string();
        let run_id = org_run_id.to_string();
        let app_handle = self.app_handle.clone();
        tokio::spawn(async move {
            wake_one_member(app_handle, &member, &run_id).await;
        });
    }
}

fn should_dispatch_wake(status: SessionStatus) -> bool {
    matches!(
        status,
        SessionStatus::Idle
            | SessionStatus::Completed
            | SessionStatus::Failed
            | SessionStatus::Cancelled
            | SessionStatus::Abandoned
            | SessionStatus::Timeout
    )
}

async fn wake_one_member(app_handle: AppHandle, member_id: &str, org_run_id: &str) {
    // Pause gate: do not dispatch wakes while the org run is paused. The
    // inbox row remains pending and will be drained once the run is resumed.
    match AgentOrgRunStore::get_run_status(org_run_id) {
        Ok(Some(AgentOrgRunStatus::Paused)) => {
            info!(
                run_id = %org_run_id,
                member_id = %member_id,
                "[inbox_wake] run is paused; deferring wake until resumed"
            );
            return;
        }
        Ok(_) => {}
        Err(err) => {
            warn!(
                run_id = %org_run_id,
                member_id = %member_id,
                error = %err,
                "[inbox_wake] run status lookup failed; proceeding with wake"
            );
        }
    }

    let info = if member_id == crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID {
        match AgentOrgRunStore::find_coordinator_session_by_member_id(org_run_id, member_id) {
            Ok(info) => info,
            Err(err) => {
                warn!(
                    run_id = %org_run_id,
                    member_id = %member_id,
                    error = %err,
                    "[inbox_wake] coordinator session lookup failed; skipping wake"
                );
                return;
            }
        }
    } else {
        match AgentOrgRunStore::list_worker_sessions_by_member_ids(
            org_run_id,
            &[member_id.to_string()],
        ) {
            Ok(mut sessions) => sessions.pop().map(|session| {
                crate::coordination::agent_org_runs::WorkerSessionInfo {
                    session_id: session.session_id,
                    status: session.status,
                    updated_at: session.updated_at,
                }
            }),
            Err(err) => {
                warn!(
                    run_id = %org_run_id,
                    member_id = %member_id,
                    error = %err,
                    "[inbox_wake] member session lookup failed; skipping wake"
                );
                return;
            }
        }
    };
    let Some(info) = info else {
        info!(
            run_id = %org_run_id,
            member_id = %member_id,
            "[inbox_wake] no materialized member session; inbox row remains pending"
        );
        return;
    };

    wake_session(
        app_handle,
        &info.session_id,
        info.status,
        member_id,
        org_run_id,
    )
    .await;
}

async fn wake_session(
    app_handle: AppHandle,
    session_id: &str,
    status: SessionStatus,
    recipient_member_id: &str,
    org_run_id: &str,
) {
    if !should_dispatch_wake(status) {
        info!(
            run_id = %org_run_id,
            member_id = %recipient_member_id,
            session_id = %session_id,
            status = status.as_str(),
            "[inbox_wake] session status is not wakeable; inbox row remains pending"
        );
        return;
    }

    // Borrow `AgentAppState` from Tauri-managed state. Returning early
    // when this fails (test environments, headless callers) keeps the
    // hook safe to invoke unconditionally from `OrgSendMessageTool`.
    let state = match app_handle.try_state::<AgentAppState>() {
        Some(s) => s,
        None => {
            warn!(
                run_id = %org_run_id,
                member_id = %recipient_member_id,
                "[inbox_wake] AgentAppState not registered on app handle; cannot wake"
            );
            return;
        }
    };

    // Empty `content` + `is_resume=true` → processor skips persisting
    // an empty user row (see `should_save_user_msg` branch in
    // `processor/mod.rs`), then `inbox_drain` injects the inbox
    // payload as the user attachment at turn-boundary entry. The
    // resumed turn therefore opens with the inbox contents as user
    // input, exactly like a normal "user typed a message" turn.
    let result = crate::state::commands::session::message::send_message_impl_for_wake(
        &state,
        session_id.to_string(),
    )
    .await;
    match result {
        Ok(_) => {
            info!(
                run_id = %org_run_id,
                member_id = %recipient_member_id,
                session_id = %session_id,
                "[inbox_wake] queued resume turn for stopped recipient"
            );
        }
        Err(err) => {
            warn!(
                run_id = %org_run_id,
                member_id = %recipient_member_id,
                session_id = %session_id,
                error = %err,
                "[inbox_wake] resume turn dispatch failed"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_gate_dispatches_idle_and_terminal_member_sessions() {
        for status in [
            SessionStatus::Idle,
            SessionStatus::Completed,
            SessionStatus::Failed,
            SessionStatus::Cancelled,
            SessionStatus::Abandoned,
            SessionStatus::Timeout,
        ] {
            assert!(should_dispatch_wake(status), "status={}", status.as_str());
        }
    }

    #[test]
    fn wake_gate_does_not_double_dispatch_in_flight_or_archived_sessions() {
        for status in [
            SessionStatus::Running,
            SessionStatus::Pending,
            SessionStatus::Paused,
            SessionStatus::WaitingForUser,
            SessionStatus::WaitingForFunds,
            SessionStatus::Archived,
        ] {
            assert!(!should_dispatch_wake(status), "status={}", status.as_str());
        }
    }
}
