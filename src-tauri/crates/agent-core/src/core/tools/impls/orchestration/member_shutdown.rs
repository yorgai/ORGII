//! Production [`MemberShutdownHook`] backed by [`AgentAppState`].
//!
//! When the coordinator's inbox-drain observes a
//! `ShutdownResponse{accepted=true}` from a member, it must (a)
//! cancel the member's runtime so its in-flight turn (if any)
//! aborts and no new turns are scheduled, and (b) inject a
//! `MemberTerminated` row into the coordinator's own inbox so the
//! coordinator's LLM is told on its next turn that the worker is gone.
//!
//! Step (b) is performed synchronously inside the drain (it is a pure
//! `AgentInboxStore::insert` call). Step (a) needs an `AgentAppState`
//! borrow plus an async `cancel_session` await, so this hook resolves
//! `(member_id, run_id) → session_id` through
//! `AgentOrgRunStore::list_worker_sessions_by_member_ids` and dispatches the cancel on
//! a detached Tokio task. Mirrors `inbox_wake::AppHandleInboxWakeHook`.

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use crate::coordination::agent_org_runs::{AgentOrgRunStore, COORDINATOR_MEMBER_ID};
use crate::core::session::turn::inbox_drain::MemberShutdownHook;
use crate::state::AgentAppState;
use crate::tools::impls::orchestration::inbox_wake::AppHandleInboxWakeHook;
use crate::tools::impls::orchestration::org_send_message::{InboxWakeHook, SelfAbortHook};

/// Production hook: resolve the member's session via the org store,
/// then call `AgentState::cancel_session` on a detached task. Failures
/// are logged at `info!`/`warn!` and swallowed — the persisted
/// `MemberTerminated` inbox row is the source of truth for "we believe
/// this member is gone".
pub struct AppHandleMemberShutdownHook {
    app_handle: AppHandle,
}

impl AppHandleMemberShutdownHook {
    pub fn new(app_handle: AppHandle) -> Arc<Self> {
        Arc::new(Self { app_handle })
    }
}

impl MemberShutdownHook for AppHandleMemberShutdownHook {
    fn cancel_member_session(&self, member_id: &str, org_run_id: &str) {
        let member_id = member_id.to_string();
        let run_id = org_run_id.to_string();
        let app_handle = self.app_handle.clone();
        tokio::spawn(async move {
            cancel_one(app_handle, &member_id, &run_id).await;
        });
    }

    fn wake_coordinator(&self, org_run_id: &str) {
        AppHandleInboxWakeHook::new(self.app_handle.clone())
            .wake_member(COORDINATOR_MEMBER_ID, org_run_id);
    }
}

async fn cancel_one(app_handle: AppHandle, member_id: &str, org_run_id: &str) {
    let mut sessions = match AgentOrgRunStore::list_worker_sessions_by_member_ids(
        org_run_id,
        &[member_id.to_string()],
    ) {
        Ok(sessions) => sessions,
        Err(err) => {
            warn!(
                run_id = %org_run_id,
                member = %member_id,
                error = %err,
                "[member_shutdown] find worker session by member id failed; skipping cancel"
            );
            return;
        }
    };
    let Some(info) = sessions.pop() else {
        info!(
            run_id = %org_run_id,
            member = %member_id,
            "[member_shutdown] no live worker session to cancel"
        );
        return;
    };

    let state = match app_handle.try_state::<AgentAppState>() {
        Some(s) => s,
        None => {
            warn!(
                run_id = %org_run_id,
                member = %member_id,
                "[member_shutdown] AgentAppState not registered on app handle; cannot cancel"
            );
            return;
        }
    };

    let cancelled = state
        .cancel_session(
            &info.session_id,
            crate::state::control_flow::CancelReason::ProgrammaticShutdown,
        )
        .await;
    if cancelled {
        info!(
            run_id = %org_run_id,
            member = %member_id,
            session_id = %info.session_id,
            "[member_shutdown] cancelled member session in response to shutdown_response"
        );
    } else {
        info!(
            run_id = %org_run_id,
            member = %member_id,
            session_id = %info.session_id,
            "[member_shutdown] member session not active at cancel time (already completed)"
        );
    }
}

/// Production [`SelfAbortHook`]: a worker that sent
/// `shutdown_response{accepted=true}` to the coordinator cancels its
/// own active turn so it stops doing work while the coordinator
/// processes the ack. Reuses [`cancel_one`] so the resolution path is
/// identical to the coordinator-driven cancel — the only difference
/// is who initiates it (the worker itself vs. the coordinator's drain).
///
/// Once a worker has accepted shutdown, any further tool calls or
/// turn work would be wasted (and could race with the coordinator's
/// `MemberTerminated` bookkeeping); aborting the active turn at ack
/// time is the cheapest way to enforce that.
pub struct AppHandleSelfAbortHook {
    app_handle: AppHandle,
}

impl AppHandleSelfAbortHook {
    pub fn new(app_handle: AppHandle) -> Arc<Self> {
        Arc::new(Self { app_handle })
    }
}

impl SelfAbortHook for AppHandleSelfAbortHook {
    fn abort_self(&self, sender_member_id: &str, org_run_id: &str) {
        let member_id = sender_member_id.to_string();
        let run_id = org_run_id.to_string();
        let app_handle = self.app_handle.clone();
        tokio::spawn(async move {
            cancel_one(app_handle, &member_id, &run_id).await;
        });
    }
}
