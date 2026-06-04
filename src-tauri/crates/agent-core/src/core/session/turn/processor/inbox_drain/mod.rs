//! Per-agent inbox drain hook for the unified turn processor.
//!
//! See [`drain_and_render_deferred`] for the production entry point and
//! [`hooks`] / [`render`] sub-modules for the shutdown hook trait and
//! attachment XML renderer respectively.

pub mod hooks;
pub(super) mod render;

#[cfg(test)]
pub use hooks::MemberShutdownHookGuard;
pub use hooks::{install_member_shutdown_hook, MemberShutdownHook, NoopMemberShutdownHook};

use serde_json::Value;
use tracing::{info, warn};

use crate::coordination::agent_inbox::{
    AgentInboxRecord, AgentInboxStore, AgentMessage, InsertInboxParams, MemberTerminationReason,
    SYSTEM_SENDER_ID, USER_SENDER_ID,
};
use chrono::{Duration, Utc};

use crate::coordination::agent_member_interventions::AgentMemberInterventionStore;
use crate::coordination::agent_org_runs::{
    AgentOrgContextMember, AgentOrgRunContext, AgentOrgRunStatus, AgentOrgRunStore,
    COORDINATOR_MEMBER_ID,
};
use crate::coordination::agent_org_tasks::AgentOrgTaskStore;
use crate::state::AgentSession;

use self::hooks::current_member_shutdown_hook;
use self::render::{render_inbox_attachment, render_inbox_transcript};

const STALE_WORKER_TASK_RELEASE_TIMEOUT_SECS: i64 = 15 * 60;

/// Pending mark-read commit returned by [`drain_and_render_deferred`].
///
/// The guard owns the IDs of inbox rows that were materialised into the
/// turn's in-memory `messages` vector and applied as side effects, but
/// have **not yet been marked read**. Callers must invoke [`Self::commit`]
/// only after the turn has progressed past the point where a failure
/// would cause the rendered attachment to be permanently lost (i.e.
/// the user-message has been persisted and / or the turn has succeeded).
///
/// If the guard is dropped without `commit()`, the rows stay unread and
/// will be re-drained on the next turn — strictly preferable to the
/// alternative (marking read on a turn that ultimately fails, losing
/// the messages forever). Rows are only marked read after they are
/// reliably queued.
#[must_use = "DrainGuard::commit must be called after the turn succeeds; \
              dropping without commit leaves rows unread for next turn"]
pub struct DrainGuard {
    run_id: String,
    recipient_member_id: String,
    pending_ids: Vec<i64>,
    transcript_content: Option<String>,
}

impl DrainGuard {
    fn empty(run_id: &str, recipient_member_id: &str) -> Self {
        Self {
            run_id: run_id.to_string(),
            recipient_member_id: recipient_member_id.to_string(),
            pending_ids: Vec::new(),
            transcript_content: None,
        }
    }

    fn drained(
        run_id: &str,
        recipient_member_id: &str,
        pending_ids: Vec<i64>,
        transcript: String,
    ) -> Self {
        Self {
            run_id: run_id.to_string(),
            recipient_member_id: recipient_member_id.to_string(),
            pending_ids,
            transcript_content: Some(transcript),
        }
    }

    pub fn transcript_content(&self) -> Option<&str> {
        self.transcript_content.as_deref()
    }

    /// Number of rows that were drained-and-rendered. `0` means there
    /// was nothing to commit and `commit()` is a no-op.
    ///
    /// Used by the test-only [`drain_and_render`] wrapper to report
    /// the drain count after immediate commit, and by the
    /// `drain-inbox` debug endpoint so E2E scenarios can assert how
    /// many rows the call drained without re-reading the inbox after
    /// commit. Production turn code does not consult it.
    pub fn drained_count(&self) -> usize {
        self.pending_ids.len()
    }

    /// Mark all drained rows as read. Idempotent w.r.t. partial mark
    /// failures: any row that already happens to be marked read is
    /// silently skipped by the underlying store. Failures are logged
    /// and swallowed — re-drain on the next turn is the recovery.
    pub fn commit(self) {
        if self.pending_ids.is_empty() {
            return;
        }
        match AgentInboxStore::mark_many_read(&self.pending_ids) {
            Ok(updated) => {
                info!(
                    run_id = %self.run_id,
                    member_id = %self.recipient_member_id,
                    marked = updated,
                    pending = self.pending_ids.len(),
                    "[inbox_drain] marked drained rows as read after turn success"
                );
            }
            Err(err) => {
                warn!(
                    run_id = %self.run_id,
                    member_id = %self.recipient_member_id,
                    error = %err,
                    pending = self.pending_ids.len(),
                    "[inbox_drain] mark_many_read failed; rows will be re-drained next turn"
                );
            }
        }
    }
}

fn resolve_recipient_member_id(
    org_context: &AgentOrgRunContext,
    recipient_agent_id: &str,
    session: Option<&AgentSession>,
) -> Option<String> {
    if let Some(session) = session {
        match crate::session::persistence::get_session(&session.id) {
            Ok(Some(record)) => {
                if let Some(member_id) = record.org_member_id {
                    return Some(member_id);
                }
            }
            Ok(None) => {}
            Err(err) => {
                warn!(
                    run_id = %org_context.run_id,
                    session_id = %session.id,
                    recipient = %recipient_agent_id,
                    error = %err,
                    "[inbox_drain] session persistence lookup failed while resolving org member id"
                );
            }
        }
    }

    if let Some(session) = session {
        match AgentOrgRunStore::is_root_session(&org_context.run_id, &session.id) {
            Ok(true) => return Some(COORDINATOR_MEMBER_ID.to_string()),
            Ok(false) => {}
            Err(err) => {
                warn!(
                    run_id = %org_context.run_id,
                    session_id = %session.id,
                    error = %err,
                    "[inbox_drain] root-session check failed while resolving coordinator member id"
                );
            }
        }
    }

    warn!(
        run_id = %org_context.run_id,
        session_agent_definition_id = %recipient_agent_id,
        "[inbox_drain] missing recipient_member_id for non-roster session; skipping drain"
    );
    None
}

fn resolve_sender_member<'a>(
    org_context: &'a AgentOrgRunContext,
    row: &AgentInboxRecord,
) -> Option<&'a AgentOrgContextMember> {
    if let Some(sender_member_id) = row.sender_member_id.as_deref() {
        let member = org_context
            .members
            .iter()
            .find(|member| member.member_id == sender_member_id);
        if member.is_none() {
            warn!(
                run_id = %org_context.run_id,
                inbox_id = row.id,
                sender_member_id = %sender_member_id,
                "[inbox_drain] sender_member_id does not match a known org member"
            );
        }
        return member;
    }

    None
}

/// Drain unread inbox rows, render the attachment into `messages`, and
/// apply side effects — but **defer** marking the rows as read until
/// the caller invokes [`DrainGuard::commit`] after the turn succeeds.
///
/// This is the production entry point. The legacy [`drain_and_render`]
/// wrapper exists only for unit tests that don't want to thread a
/// guard through.
///
/// Returns a [`DrainGuard`] whose `drained_count()` equals the number
/// of inbox rows that were drained-and-rendered. A count of `0` means
/// either the inbox was empty for this recipient in this run, or the
/// lookup itself failed (failures are logged, never propagated, because
/// a stale-inbox surface is strictly better than a hard-failed turn).
///
/// `session` is `Some` in production and `None` in pure rendering tests.
/// When present, the drain also applies side effects keyed on specific
/// payload kinds — currently:
///
///   * `PlanApprovalResponse` stages the member's next execution mode.
///     Accepted responses clear plan-mode bookkeeping and broadcast
///     `agent:exit_plan_mode`; rejected responses keep the plan caches
///     intact and stage another Plan turn for revision.
///   * `ShutdownResponse { accepted: true }` from a member to the
///     coordinator triggers `shutdown_hook.cancel_member_session` on
///     the member's runtime AND inserts a system-emitted
///     `MemberTerminated` row into the coordinator's own inbox so the
///     coordinator's LLM has explicit signal on the next turn.
///
/// The shutdown hook is resolved from the process-wide installation
/// performed at app boot (`install_member_shutdown_hook`); tests can
/// install a stub via the same setter.
pub fn drain_and_render_deferred(
    org_context: &AgentOrgRunContext,
    recipient_agent_id: &str,
    runtime_member_id: Option<&str>,
    messages: &mut Vec<Value>,
    session: Option<&AgentSession>,
) -> DrainGuard {
    let shutdown_hook = current_member_shutdown_hook();

    let recipient_member_id = runtime_member_id
        .filter(|member_id| !member_id.trim().is_empty())
        .map(str::to_string)
        .or_else(|| resolve_recipient_member_id(org_context, recipient_agent_id, session));

    if let Some(member_id) = recipient_member_id.as_deref() {
        match AgentMemberInterventionStore::active_for_member(&org_context.run_id, member_id) {
            Ok(Some(intervention)) => {
                info!(
                    run_id = %org_context.run_id,
                    member_id = %member_id,
                    session_id = %intervention.session_id,
                    resume_after = %intervention.resume_after,
                    "[inbox_drain] skipping drain while member is in user_intervention"
                );
                return DrainGuard::empty(&org_context.run_id, member_id);
            }
            Ok(None) => {}
            Err(err) => {
                warn!(
                    run_id = %org_context.run_id,
                    member_id = %member_id,
                    error = %err,
                    "[inbox_drain] member intervention lookup failed; skipping drain to preserve direct user chat priority"
                );
                return DrainGuard::empty(&org_context.run_id, member_id);
            }
        }
    }

    release_stale_worker_tasks(org_context, recipient_member_id.as_deref());

    // Autonomous claim. Before reading the inbox, give a member that
    // has nothing in flight a chance to self-claim the next available
    // task. The claim posts a `TaskAssigned` row to *this* recipient's
    // inbox, which will then be picked up by the
    // `list_unread_for_member` call below and rendered into this
    // turn's attachment.
    //
    // No-op for the coordinator (only members poll).
    if let Some(member_id) = recipient_member_id.as_deref() {
        if member_id != COORDINATOR_MEMBER_ID {
            try_autonomous_claim(org_context, recipient_agent_id, member_id);
        }
    }

    let Some(recipient_member_id_value) = recipient_member_id.as_deref() else {
        return DrainGuard::empty(&org_context.run_id, "unknown");
    };

    let unread_result =
        AgentInboxStore::list_unread_for_member(recipient_member_id_value, &org_context.run_id);

    let unread = match unread_result {
        Ok(rows) => rows,
        Err(err) => {
            warn!(
                run_id = %org_context.run_id,
                member_id = %recipient_member_id_value,
                error = %err,
                "[inbox_drain] list_unread_for_member failed; skipping injection for this turn"
            );
            return DrainGuard::empty(&org_context.run_id, recipient_member_id_value);
        }
    };
    if unread.is_empty() {
        return DrainGuard::empty(&org_context.run_id, recipient_member_id_value);
    }

    let mut unread = unread;
    unread.sort_by_key(|row| {
        let is_user_group_message = row.sender_agent_id == USER_SENDER_ID;
        (!is_user_group_message, row.id)
    });

    let rendered = render_inbox_attachment(&unread, org_context);
    let transcript = render_inbox_transcript(&unread);
    messages.push(serde_json::json!({
        "role": "user",
        "content": rendered.clone(),
    }));

    if let Some(session) = session {
        apply_payload_side_effects(&unread, session, org_context, shutdown_hook.as_ref());
    }

    let pending_ids: Vec<i64> = unread.iter().map(|r| r.id).collect();
    info!(
        run_id = %org_context.run_id,
        member_id = %recipient_member_id_value,
        injected = unread.len(),
        "[inbox_drain] injected inbox attachments at turn boundary (mark-read deferred to commit)"
    );
    DrainGuard::drained(
        &org_context.run_id,
        recipient_member_id_value,
        pending_ids,
        transcript,
    )
}

fn release_stale_worker_tasks(org_context: &AgentOrgRunContext, recipient_member_id: Option<&str>) {
    // Pause gate: while the run is paused the TTL clock is effectively frozen —
    // workers are idle because dispatch is suppressed, not because they crashed.
    if matches!(
        AgentOrgRunStore::get_run_status(&org_context.run_id),
        Ok(Some(AgentOrgRunStatus::Paused))
    ) {
        return;
    }
    let stale_before = Utc::now() - Duration::seconds(STALE_WORKER_TASK_RELEASE_TIMEOUT_SECS);
    let result = if let Some(member_id) = recipient_member_id {
        AgentOrgRunStore::release_tasks_for_stale_workers_except_member(
            &org_context.run_id,
            stale_before,
            member_id,
        )
    } else {
        AgentOrgRunStore::release_tasks_for_stale_workers(&org_context.run_id, stale_before)
    };
    match result {
        Ok(releases) => {
            for release in releases {
                info!(
                    run_id = %org_context.run_id,
                    stale_member_id = ?release.worker.member_id,
                    stale_session_id = %release.worker.session_id,
                    released_count = release.released_tasks.len(),
                    "[inbox_drain] released open tasks from stale worker session back to pool"
                );
            }
        }
        Err(err) => {
            warn!(
                run_id = %org_context.run_id,
                error = %err,
                "[inbox_drain] failed to release stale worker tasks; tasks may remain stranded"
            );
        }
    }
}

/// Autonomous claim path. If `recipient_agent_id` is a member with
/// no open task, look for the next available task and
/// claim it. On success, persist a self-`TaskAssigned` row (system
/// sender, since the claim is system-driven, not LLM-driven) so the
/// surrounding `list_unread_for_member` call observes it and
/// surfaces the assignment in this turn's attachment.
///
/// All errors are logged and swallowed — losing one claim attempt is
/// strictly preferable to failing a turn that already has work to do.
fn try_autonomous_claim(
    org_context: &AgentOrgRunContext,
    recipient_agent_id: &str,
    recipient_member_id: &str,
) {
    use crate::coordination::agent_org_tasks::{self, AgentOrgTaskStore, ClaimError, ClaimOptions};

    // Pause gate: do not autonomously claim tasks while the run is paused.
    if matches!(
        AgentOrgRunStore::get_run_status(&org_context.run_id),
        Ok(Some(AgentOrgRunStatus::Paused))
    ) {
        return;
    }

    match AgentOrgTaskStore::has_open_task_for_owner(&org_context.run_id, recipient_member_id) {
        Ok(true) => return,
        Ok(false) => {}
        Err(err) => {
            warn!(
                run_id = %org_context.run_id,
                member_id = %recipient_member_id,
                error = %err,
                "[autonomous_claim] has_open_task_for_owner failed; skipping claim attempt",
            );
            return;
        }
    }

    let candidate = match AgentOrgTaskStore::find_available(&org_context.run_id) {
        Ok(Some(task)) => task,
        Ok(None) => return,
        Err(err) => {
            warn!(
                run_id = %org_context.run_id,
                error = %err,
                "[autonomous_claim] find_available failed; skipping claim attempt",
            );
            return;
        }
    };

    let claimed = match AgentOrgTaskStore::try_claim(
        &org_context.run_id,
        &candidate.id,
        recipient_member_id,
        ClaimOptions::default(),
    ) {
        Ok(task) => task,
        Err(ClaimError::AlreadyClaimed { .. }) | Err(ClaimError::AlreadyResolved { .. }) => {
            return;
        }
        Err(err) => {
            warn!(
                run_id = %org_context.run_id,
                member_id = %recipient_member_id,
                task_id = %candidate.id,
                error = %err,
                "[autonomous_claim] try_claim failed; skipping",
            );
            return;
        }
    };

    if let Err(err) = agent_org_tasks::enqueue_task_assigned_to(
        &claimed,
        recipient_agent_id,
        recipient_member_id,
        SYSTEM_SENDER_ID,
        None,
        "system",
    ) {
        warn!(
            run_id = %org_context.run_id,
            member_id = %recipient_member_id,
            task_id = %claimed.id,
            error = %err,
            "[autonomous_claim] enqueue_task_assigned failed after successful claim — \
             task is owned but the recipient won't see the assignment until next turn",
        );
        return;
    }

    info!(
        run_id = %org_context.run_id,
        member_id = %recipient_member_id,
        task_id = %claimed.id,
        "[autonomous_claim] member self-claimed available task",
    );
}

/// Test-only wrapper: drain + render + immediately commit. Production
/// code MUST use [`drain_and_render_deferred`] so that mark-read can be
/// gated on turn success.
#[cfg(test)]
pub fn drain_and_render(
    org_context: &AgentOrgRunContext,
    recipient_agent_id: &str,
    runtime_member_id: Option<&str>,
    messages: &mut Vec<Value>,
    session: Option<&AgentSession>,
) -> usize {
    let guard = drain_and_render_deferred(
        org_context,
        recipient_agent_id,
        runtime_member_id,
        messages,
        session,
    );
    let count = guard.drained_count();
    guard.commit();
    count
}

/// Apply payload-driven side effects to the recipient session.
///
/// Two payload kinds drive side effects today:
///
/// 1. `PlanApprovalResponse` from the coordinator on a member's drain
///    stages the member's next mode. Approval clears `plan_slot_cache` /
///    `pre_plan_mode_cache` and broadcasts `agent:exit_plan_mode`; rejection
///    preserves the caches and keeps the next turn in Plan mode. Defence-in-depth:
///    only honour rows whose `sender_agent_id` is the coordinator.
///
/// 2. `ShutdownResponse { accepted: true }` from a member on the
///    coordinator's drain — invokes `shutdown_hook.cancel_member_session`
///    on the member's runtime and inserts a system-emitted
///    `MemberTerminated` row into the coordinator's own inbox so the
///    coordinator's LLM is told on its next turn that the worker is
///    gone. Defence-in-depth: only honour rows where the recipient
///    is the coordinator AND the sender is a known org member (i.e.
///    exists in `org_context.members`); a self-issued or
///    stranger-sourced row is dropped.
///
/// Errors here are logged and swallowed — partial side effects are
/// strictly better than failing the turn over a bookkeeping miss.
fn apply_payload_side_effects(
    rows: &[AgentInboxRecord],
    session: &AgentSession,
    org_context: &AgentOrgRunContext,
    shutdown_hook: &dyn MemberShutdownHook,
) {
    for row in rows {
        let msg = match row.decode_payload() {
            Ok(msg) => msg,
            Err(err) => {
                // Render-side already shows a `<raw decode_error=…>` block
                // to the LLM so the row isn't lost from history; this side-
                // effect path is the one that triggers plan-approval exit
                // and shutdown_hook.cancel_member_session, so a silent skip
                // here means the user-visible action never fires.
                warn!(
                    session_id = %session.id,
                    inbox_id = row.id,
                    error = %err,
                    "[inbox_drain] decode_payload failed in side-effect pass; \
                     plan-approval / shutdown actions for this row will not run"
                );
                continue;
            }
        };
        match msg {
            AgentMessage::PlanApprovalResponse {
                accepted,
                next_mode,
                ..
            } => {
                if row.sender_member_id.as_deref() != Some(COORDINATOR_MEMBER_ID) {
                    warn!(
                        session_id = %session.id,
                        inbox_id = row.id,
                        sender_member_id = ?row.sender_member_id,
                        coordinator_member_id = COORDINATOR_MEMBER_ID,
                        "[inbox_drain] dropping plan_approval_response from non-coordinator sender — \
                         ignoring to prevent member-to-member approval forgery"
                    );
                    continue;
                }
                let target_mode = next_mode.unwrap_or(if accepted {
                    crate::session::AgentExecMode::Build
                } else {
                    crate::session::AgentExecMode::Plan
                });
                session
                    .requested_exec_mode_cache
                    .set(&session.id, target_mode);
                if accepted {
                    session.plan_slot_cache.clear(&session.id);
                    let _ = session.pre_plan_mode_cache.take(&session.id);
                    crate::bus::broadcast_event(
                        "agent:exit_plan_mode",
                        serde_json::json!({
                            "sessionId": session.id,
                            "source": "agent_org_plan_approval",
                            "nextMode": target_mode.as_str(),
                        }),
                    );
                }
                info!(
                    session_id = %session.id,
                    inbox_id = row.id,
                    accepted = accepted,
                    next_mode = %target_mode.as_str(),
                    "[inbox_drain] coordinator plan approval response staged next member mode"
                );
            }
            AgentMessage::ShutdownResponse { accepted: true, .. } => {
                if row.recipient_member_id.as_deref() != Some(COORDINATOR_MEMBER_ID) {
                    // Member-to-member shutdown_response is rejected at
                    // build time (`org_send_message`); guard the
                    // unlikely case it landed via another producer.
                    warn!(
                        session_id = %session.id,
                        inbox_id = row.id,
                        recipient_member_id = ?row.recipient_member_id,
                        coordinator_member_id = COORDINATOR_MEMBER_ID,
                        "[inbox_drain] dropping shutdown_response side effect — recipient is not the coordinator"
                    );
                    continue;
                }
                let Some(member) = resolve_sender_member(org_context, row) else {
                    warn!(
                        session_id = %session.id,
                        inbox_id = row.id,
                        sender = %row.sender_agent_id,
                        sender_member_id = ?row.sender_member_id,
                        "[inbox_drain] dropping shutdown_response side effect — sender is not a known org member"
                    );
                    continue;
                };

                shutdown_hook.cancel_member_session(&member.member_id, &org_context.run_id);

                // Release any open tasks the dying member still owns
                // so the next idle peer can auto-claim them. Errors
                // are logged and swallowed — bookkeeping rot is
                // strictly less bad than failing the whole drain over a
                // task table hiccup; the next coordinator turn will
                // observe whatever state the store is actually in.
                match AgentOrgTaskStore::unassign_for_owner(&org_context.run_id, &member.member_id)
                {
                    Ok(released) if !released.is_empty() => {
                        info!(
                            session_id = %session.id,
                            inbox_id = row.id,
                            terminated_member = %member.member_id,
                            released_count = released.len(),
                            "[inbox_drain] released open tasks from terminated member back to pool"
                        );
                    }
                    Ok(_) => {}
                    Err(err) => {
                        warn!(
                            session_id = %session.id,
                            inbox_id = row.id,
                            terminated_member = %member.member_id,
                            error = %err,
                            "[inbox_drain] failed to release tasks for terminated member; tasks may be stranded"
                        );
                    }
                }

                match AgentInboxStore::insert(InsertInboxParams {
                    recipient_agent_id: org_context.coordinator_agent_id.clone(),
                    recipient_member_id: Some(COORDINATOR_MEMBER_ID.to_string()),
                    sender_agent_id: SYSTEM_SENDER_ID.to_string(),
                    sender_member_id: None,
                    org_run_id: Some(org_context.run_id.clone()),
                    message: AgentMessage::MemberTerminated {
                        member_id: member.member_id.clone(),
                        member_name: member.name.clone(),
                        reason: MemberTerminationReason::Shutdown,
                    },
                }) {
                    Ok(record) => {
                        shutdown_hook.wake_coordinator(&org_context.run_id);
                        info!(
                            session_id = %session.id,
                            inbox_id = row.id,
                            terminated_member = %member.member_id,
                            terminated_name = %member.name,
                            new_inbox_id = record.id,
                            "[inbox_drain] member acknowledged shutdown; cancelled session and notified coordinator"
                        );
                    }
                    Err(err) => {
                        warn!(
                            session_id = %session.id,
                            inbox_id = row.id,
                            terminated_member = %member.member_id,
                            error = %err,
                            "[inbox_drain] failed to persist MemberTerminated row; coordinator will not be notified this turn"
                        );
                    }
                }
            }
            AgentMessage::ExecModeSetRequest { mode, .. } => {
                // Coordinator-driven mode override on a member.
                // Defence-in-depth: only honour the request if
                // the sender is actually the org coordinator (the
                // build-side guard in `org_send_message` already
                // enforces this; we re-check here so a row that
                // somehow lands from another producer is still safe).
                if row.sender_member_id.as_deref() != Some(COORDINATOR_MEMBER_ID) {
                    warn!(
                        session_id = %session.id,
                        inbox_id = row.id,
                        sender_member_id = ?row.sender_member_id,
                        coordinator_member_id = COORDINATOR_MEMBER_ID,
                        "[inbox_drain] dropping exec_mode_set_request from non-coordinator sender"
                    );
                    continue;
                }
                // The override is consumed at the start of the *next*
                // member turn via `requested_exec_mode_cache.take(...)`
                // in `send_message_impl`. We just stage it here.
                session.requested_exec_mode_cache.set(&session.id, mode);
                info!(
                    session_id = %session.id,
                    inbox_id = row.id,
                    new_mode = %mode.as_str(),
                    "[inbox_drain] coordinator requested exec mode override; staged for next turn"
                );
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordination::agent_inbox::{InsertInboxParams, MemberIdleReason, RequestId};
    use crate::coordination::agent_member_interventions::{
        AgentMemberInterventionStore, EnterMemberInterventionParams,
    };
    use crate::coordination::agent_org_runs::AgentOrgRunContext;
    use render::{render_payload, xml_escape};
    use std::sync::Arc;

    fn ensure_inbox_schema() {
        let conn = database::db::get_connection().expect("test sqlite connection");
        crate::foundation::persistence::session_snapshots::ensure_tables_with(&conn)
            .expect("agent sessions schema");
        crate::session::persistence::init(&conn).expect("session schema");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_token_usage (
                session_id TEXT NOT NULL,
                total_tokens INTEGER NOT NULL DEFAULT 0
            );",
        )
        .expect("session token usage schema");
        crate::coordination::agent_org_runs::init_schema(&conn).expect("agent org runs schema");
        crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
        crate::coordination::agent_member_interventions::init_schema(&conn)
            .expect("member intervention schema");
        crate::coordination::agent_org_tasks::init_schema(&conn).expect("agent team tasks schema");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS code_sessions (
                session_id TEXT PRIMARY KEY,
                cli_agent_type TEXT NOT NULL,
                status TEXT NOT NULL,
                parent_session_id TEXT,
                org_member_id TEXT,
                updated_at TEXT NOT NULL
            );",
        )
        .expect("cli session schema");
    }

    fn ctx_for(run_id: &str) -> AgentOrgRunContext {
        ensure_inbox_schema();
        AgentOrgRunContext {
            run_id: run_id.into(),
            org_id: "org-1".into(),
            org_name: "Org 1".into(),
            org_role: "team".into(),
            coordinator_agent_id: "coord".into(),
            coordinator_name: "Org 1".into(),
            coordinator_role: "team".into(),
            members: vec![],
            hierarchy_mode: Default::default(),
            root_session_id: Some("root-1".into()),
        }
    }

    fn ctx_for_with_member(
        run_id: &str,
        member_agent_id: &str,
        member_name: &str,
    ) -> AgentOrgRunContext {
        let mut ctx = ctx_for(run_id);
        ctx.members
            .push(crate::coordination::agent_org_runs::AgentOrgContextMember {
                member_id: format!("member-{member_agent_id}"),
                agent_id: member_agent_id.into(),
                name: member_name.into(),
                role: "engineer".into(),
                parent_member_id: None,
            });
        ctx
    }

    fn upsert_org_member_session(
        session_id: &str,
        root_session_id: &str,
        agent_definition_id: &str,
        member_id: &str,
    ) {
        use crate::session::persistence::{session_type, upsert_session, UnifiedSessionRecord};

        let now = chrono::Utc::now().to_rfc3339();
        upsert_session(&UnifiedSessionRecord {
            session_id: session_id.to_string(),
            name: format!("{member_id} session"),
            status: crate::core::session::SessionStatus::Idle
                .as_str()
                .to_string(),
            session_type: session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some(root_session_id.to_string()),
            agent_definition_id: Some(agent_definition_id.to_string()),
            org_member_id: Some(member_id.to_string()),
            created_at: now.clone(),
            updated_at: now,
            ..Default::default()
        })
        .expect("upsert org member session");
    }

    /// Recording stub for [`MemberShutdownHook`] used by C1 tests.
    /// Captures `(member_agent_id, run_id)` calls so the test can
    /// assert the exact arguments without round-tripping through
    /// `AgentState`.
    #[derive(Default)]
    struct RecordingShutdownHook {
        calls: std::sync::Mutex<Vec<(String, String)>>,
        coordinator_wakes: std::sync::Mutex<Vec<String>>,
    }

    impl RecordingShutdownHook {
        fn snapshot(&self) -> Vec<(String, String)> {
            self.calls.lock().expect("recording hook lock").clone()
        }

        fn coordinator_wakes(&self) -> Vec<String> {
            self.coordinator_wakes
                .lock()
                .expect("recording wake lock")
                .clone()
        }
    }

    impl MemberShutdownHook for RecordingShutdownHook {
        fn cancel_member_session(&self, member_id: &str, org_run_id: &str) {
            self.calls
                .lock()
                .expect("recording hook lock")
                .push((member_id.to_string(), org_run_id.to_string()));
        }

        fn wake_coordinator(&self, org_run_id: &str) {
            self.coordinator_wakes
                .lock()
                .expect("recording wake lock")
                .push(org_run_id.to_string());
        }
    }

    #[test]
    fn drain_returns_zero_when_inbox_is_empty() {
        let _sandbox = test_helpers::test_env::sandbox();
        let mut messages: Vec<Value> = Vec::new();
        let ctx = ctx_for(&format!("run-{}", uuid::Uuid::new_v4()));
        let drained = drain_and_render(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 0);
        assert!(messages.is_empty());
    }

    #[test]
    fn shared_agent_id_member_session_drains_only_its_member_inbox() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let root_session_id = format!("root-{}", uuid::Uuid::new_v4());
        let alice_session_id = format!("session-alice-{}", uuid::Uuid::new_v4());
        let shared_agent_id = "builtin:sde";
        let mut ctx = ctx_for(&run_id);
        ctx.coordinator_agent_id = shared_agent_id.to_string();
        ctx.members = vec![
            crate::coordination::agent_org_runs::AgentOrgContextMember {
                member_id: "alice".into(),
                agent_id: shared_agent_id.into(),
                name: "Alice".into(),
                role: "planner".into(),
                parent_member_id: None,
            },
            crate::coordination::agent_org_runs::AgentOrgContextMember {
                member_id: "bob".into(),
                agent_id: shared_agent_id.into(),
                name: "Bob".into(),
                role: "implementer".into(),
                parent_member_id: None,
            },
        ];
        upsert_org_member_session(
            &alice_session_id,
            &root_session_id,
            shared_agent_id,
            "alice",
        );
        let persisted = crate::session::persistence::get_session(&alice_session_id)
            .expect("read persisted alice session")
            .expect("persisted alice session exists");
        assert_eq!(persisted.org_member_id.as_deref(), Some("alice"));

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: shared_agent_id.into(),
            recipient_member_id: Some("alice".into()),
            sender_agent_id: shared_agent_id.into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "alice assignment".into(),
                text: "only Alice should see this".into(),
            },
        })
        .expect("insert alice inbox row");
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: shared_agent_id.into(),
            recipient_member_id: Some("bob".into()),
            sender_agent_id: shared_agent_id.into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "bob assignment".into(),
                text: "Alice must not drain this".into(),
            },
        })
        .expect("insert bob inbox row");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new(alice_session_id, definition);
        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            shared_agent_id,
            Some("alice"),
            &mut messages,
            Some(&session),
        );

        assert_eq!(drained, 1, "Alice must only drain rows addressed to alice");
        let body = messages[0]["content"].as_str().expect("content");
        assert!(body.contains("alice assignment"), "{body}");
        assert!(!body.contains("bob assignment"), "{body}");

        let bob_unread =
            AgentInboxStore::list_unread_for_member("bob", &run_id).expect("list bob unread rows");
        assert_eq!(bob_unread.len(), 1, "Bob row must remain unread");
        assert_eq!(bob_unread[0].recipient_member_id.as_deref(), Some("bob"));
    }

    #[test]
    fn user_intervention_pauses_member_inbox_drain_without_marking_read() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "worker-1", "Worker 1");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "coord ping".into(),
                text: "please continue the queued work".into(),
            },
        })
        .expect("insert inbox row");
        AgentMemberInterventionStore::enter(EnterMemberInterventionParams {
            org_run_id: run_id.clone(),
            member_id: "member-worker-1".into(),
            agent_id: "worker-1".into(),
            session_id: "session-worker-1".into(),
            reason: Some("direct_user_chat".into()),
            ttl_secs: 180,
        })
        .expect("enter intervention");

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 0);
        assert!(messages.is_empty());

        let unread = AgentInboxStore::list_unread_for_member("member-worker-1", &run_id)
            .expect("list unread after paused drain");
        assert_eq!(unread.len(), 1, "paused drain must not mark rows read");
    }

    #[test]
    fn return_to_work_restores_member_inbox_drain() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "worker-1", "Worker 1");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "coord ping".into(),
                text: "please continue the queued work".into(),
            },
        })
        .expect("insert inbox row");
        AgentMemberInterventionStore::enter(EnterMemberInterventionParams {
            org_run_id: run_id.clone(),
            member_id: "member-worker-1".into(),
            agent_id: "worker-1".into(),
            session_id: "session-worker-1".into(),
            reason: Some("direct_user_chat".into()),
            ttl_secs: 180,
        })
        .expect("enter intervention");
        AgentMemberInterventionStore::clear(&run_id, "member-worker-1").expect("return to work");

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 1);
        assert_eq!(messages.len(), 1);
        let body = messages[0]["content"].as_str().expect("content");
        assert!(body.contains("coord ping"), "{body}");
    }

    #[test]
    fn drain_appends_single_user_message_with_all_unread_rows() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "ping".into(),
                text: "hello".into(),
            },
        })
        .expect("insert plain");
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ShutdownRequest {
                request_id: RequestId("req-shut".into()),
                reason: Some("done".into()),
            },
        })
        .expect("insert shutdown");

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 2);
        assert_eq!(messages.len(), 1);
        let body = messages[0]["content"].as_str().expect("content");
        assert!(
            body.contains("<inbox-batch"),
            "expected inbox-batch root: {body}"
        );
        assert!(body.contains("kind=\"plain\""), "{body}");
        assert!(body.contains("kind=\"shutdown_request\""), "{body}");
        assert!(body.contains("ping"), "{body}");
        assert!(body.contains("reason=\"done\""), "{body}");
        assert!(body.contains("request_id=\"req-shut\""), "{body}");
    }

    #[test]
    fn drain_marks_rows_read_so_second_drain_is_empty() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "s".into(),
                text: "t".into(),
            },
        })
        .expect("insert");

        let mut first: Vec<Value> = Vec::new();
        let drained_first =
            drain_and_render(&ctx, "worker-1", Some("member-worker-1"), &mut first, None);
        assert_eq!(drained_first, 1);

        let mut second: Vec<Value> = Vec::new();
        let drained_second =
            drain_and_render(&ctx, "worker-1", Some("member-worker-1"), &mut second, None);
        assert_eq!(drained_second, 0);
        assert!(second.is_empty());
    }

    #[test]
    fn drain_filters_by_recipient_and_run_scope() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let other_run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "in scope".into(),
                text: "yes".into(),
            },
        })
        .expect("in-scope");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-2".into(),
            recipient_member_id: Some("member-worker-2".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id),
            message: AgentMessage::Plain {
                summary: "wrong recipient".into(),
                text: "no".into(),
            },
        })
        .expect("wrong-recipient");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(other_run_id),
            message: AgentMessage::Plain {
                summary: "wrong run".into(),
                text: "no".into(),
            },
        })
        .expect("wrong-run");

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 1);
        let body = messages[0]["content"].as_str().expect("content");
        assert!(body.contains("in scope"), "{body}");
        assert!(!body.contains("wrong recipient"), "{body}");
        assert!(!body.contains("wrong run"), "{body}");
    }

    #[test]
    fn xml_escape_handles_attribute_special_chars() {
        let escaped = xml_escape("a&b<c>d\"e'f");
        assert_eq!(escaped, "a&amp;b&lt;c&gt;d&quot;e&apos;f");
    }

    /// Render parity: `MemberIdle` must serialize as a self-closing
    /// `<member_idle .../>` element with `member_id`,
    /// `member_name`, and `reason` always present, and `summary` /
    /// `failure_reason` only included when non-empty. This is what
    /// the coordinator's LLM sees on the next turn-boundary drain.
    #[test]
    fn render_payload_member_idle_minimal_available() {
        let msg = AgentMessage::MemberIdle {
            member_id: "alice".into(),
            member_name: "Alice".into(),
            reason: MemberIdleReason::Available,
            current_mode: Some(crate::session::AgentExecMode::Plan),
            summary: None,
            failure_reason: None,
        };
        assert_eq!(
            render_payload(&msg),
            "<member_idle member_id=\"alice\" member_name=\"Alice\" reason=\"available\" current_mode=\"plan\"/>"
        );
    }

    #[test]
    fn render_payload_member_idle_interrupted_with_summary() {
        let msg = AgentMessage::MemberIdle {
            member_id: "alice".into(),
            member_name: "Alice".into(),
            reason: MemberIdleReason::Interrupted,
            current_mode: Some(crate::session::AgentExecMode::Build),
            summary: Some("aborted by coordinator".into()),
            failure_reason: None,
        };
        assert_eq!(
            render_payload(&msg),
            "<member_idle member_id=\"alice\" member_name=\"Alice\" \
             reason=\"interrupted\" current_mode=\"build\" summary=\"aborted by coordinator\"/>"
        );
    }

    #[test]
    fn render_payload_member_idle_failed_renders_failure_reason() {
        let msg = AgentMessage::MemberIdle {
            member_id: "alice".into(),
            member_name: "Alice".into(),
            reason: MemberIdleReason::Failed,
            current_mode: Some(crate::session::AgentExecMode::Ask),
            summary: None,
            failure_reason: Some("provider 5xx".into()),
        };
        assert_eq!(
            render_payload(&msg),
            "<member_idle member_id=\"alice\" member_name=\"Alice\" \
             reason=\"failed\" current_mode=\"ask\" failure_reason=\"provider 5xx\"/>"
        );
    }

    #[test]
    fn render_payload_member_idle_omits_empty_optional_attrs() {
        let msg = AgentMessage::MemberIdle {
            member_id: "alice".into(),
            member_name: "Alice".into(),
            reason: MemberIdleReason::Available,
            current_mode: None,
            summary: Some("   ".into()),
            failure_reason: Some("".into()),
        };
        assert_eq!(
            render_payload(&msg),
            "<member_idle member_id=\"alice\" member_name=\"Alice\" reason=\"available\"/>",
            "whitespace-only summary and empty failure_reason must be omitted, \
             not rendered as empty attributes"
        );
    }

    #[test]
    fn render_payload_member_idle_escapes_attribute_values() {
        let msg = AgentMessage::MemberIdle {
            member_id: "alice<1>".into(),
            member_name: "A&B".into(),
            reason: MemberIdleReason::Failed,
            current_mode: Some(crate::session::AgentExecMode::Plan),
            summary: Some("a\"b".into()),
            failure_reason: Some("x'y".into()),
        };
        let rendered = render_payload(&msg);
        assert!(rendered.contains("member_id=\"alice&lt;1&gt;\""));
        assert!(rendered.contains("member_name=\"A&amp;B\""));
        assert!(rendered.contains("summary=\"a&quot;b\""));
        assert!(rendered.contains("failure_reason=\"x&apos;y\""));
    }

    #[test]
    fn render_payload_task_assigned_basic() {
        let msg = AgentMessage::TaskAssigned {
            task_id: "task-7".into(),
            subject: "Wire memory pruning".into(),
            description: "Use the rolling-budget helper".into(),
            assigned_by: "Coordinator".into(),
        };
        assert_eq!(
            render_payload(&msg),
            "<task_assigned task_id=\"task-7\" subject=\"Wire memory pruning\" \
             assigned_by=\"Coordinator\">Use the rolling-budget helper</task_assigned>"
        );
    }

    #[test]
    fn render_payload_task_assigned_escapes_xml_metacharacters() {
        let msg = AgentMessage::TaskAssigned {
            task_id: "task<1>".into(),
            subject: "A & B".into(),
            description: "<plan>steal</plan>".into(),
            assigned_by: "Alice \"Lead\"".into(),
        };
        let rendered = render_payload(&msg);
        assert!(rendered.contains("task_id=\"task&lt;1&gt;\""));
        assert!(rendered.contains("subject=\"A &amp; B\""));
        assert!(rendered.contains("assigned_by=\"Alice &quot;Lead&quot;\""));
        assert!(rendered.contains(">&lt;plan&gt;steal&lt;/plan&gt;<"));
        // Sanity: no raw '<' or '>' inside attribute values or body
        // (everything except the framing tags must be escaped).
        let inner = rendered
            .strip_prefix("<task_assigned ")
            .unwrap()
            .strip_suffix("</task_assigned>")
            .unwrap();
        assert!(
            !inner.contains("<plan>"),
            "raw <plan> must not appear inside the rendered tag body"
        );
    }

    /// Pin the side-effect: when the inbox drain encounters a
    /// `PlanApprovalResponse { accepted: true }`,
    /// the recipient session must drop both plan-mode caches. This is
    /// the half that the pure rendering tests above can't observe
    /// because they pass `None` for the session.
    #[test]
    fn drain_clears_plan_mode_caches_on_accepted_response() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        // Seed an accepted plan-approval response in the member's inbox.
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "member-1".into(),
            recipient_member_id: Some("member-member-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::PlanApprovalResponse {
                request_id: RequestId("plan-req-42".into()),
                accepted: true,
                feedback: Some("ship it".into()),
                next_mode: Some(crate::session::AgentExecMode::Build),
            },
        })
        .expect("insert plan approval");

        // Build a plausible member session and pre-populate both
        // plan-mode caches as if the member had previously called
        // `create_plan` and therefore entered Plan mode.
        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-member-1".into(), definition);
        session.plan_slot_cache.set(
            &session.id,
            crate::core::session::plan_mode::state::PlanSlot {
                title: "demo".into(),
                slug: "demo".into(),
                hash: "abc".into(),
                resolved_path: std::path::PathBuf::from("/tmp/demo.md"),
            },
        );
        session
            .pre_plan_mode_cache
            .set(&session.id, crate::session::AgentExecMode::Build);
        assert!(session.plan_slot_cache.get(&session.id).is_some());
        assert!(session.pre_plan_mode_cache.get(&session.id).is_some());

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "member-1",
            Some("member-member-1"),
            &mut messages,
            Some(&session),
        );

        assert_eq!(drained, 1, "expected the seeded approval row to drain");
        assert_eq!(messages.len(), 1);
        assert!(
            messages[0]["content"]
                .as_str()
                .unwrap_or_default()
                .contains("plan_approval_response"),
            "rendered batch should reference the response kind: {:?}",
            messages[0]
        );

        // The side effect — both caches gone after drain.
        assert!(
            session.plan_slot_cache.get(&session.id).is_none(),
            "plan_slot_cache should be cleared on accepted approval"
        );
        assert!(
            session.pre_plan_mode_cache.get(&session.id).is_none(),
            "pre_plan_mode_cache should be consumed on accepted approval"
        );
        assert_eq!(
            session.requested_exec_mode_cache.peek(&session.id),
            Some(crate::session::AgentExecMode::Build),
            "accepted approval should stage the next member turn in build mode"
        );
    }

    /// Negative pin for the same side effect: a rejected response must
    /// NOT clear the plan-mode caches, and it must stage the next turn
    /// back in Plan mode so the member can revise and resubmit.
    #[test]
    fn drain_preserves_plan_mode_caches_on_rejected_response() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "member-1".into(),
            recipient_member_id: Some("member-member-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::PlanApprovalResponse {
                request_id: RequestId("plan-req-43".into()),
                accepted: false,
                feedback: Some("scope is too wide, narrow to phase 1 only".into()),
                next_mode: Some(crate::session::AgentExecMode::Plan),
            },
        })
        .expect("insert plan rejection");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-member-2".into(), definition);
        session.plan_slot_cache.set(
            &session.id,
            crate::core::session::plan_mode::state::PlanSlot {
                title: "demo".into(),
                slug: "demo".into(),
                hash: "abc".into(),
                resolved_path: std::path::PathBuf::from("/tmp/demo.md"),
            },
        );
        session
            .pre_plan_mode_cache
            .set(&session.id, crate::session::AgentExecMode::Build);

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "member-1",
            Some("member-member-1"),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1);

        assert!(
            session.plan_slot_cache.get(&session.id).is_some(),
            "rejected response must NOT clear plan_slot_cache (member needs it to revise)"
        );
        assert!(
            session.pre_plan_mode_cache.get(&session.id).is_some(),
            "rejected response must NOT consume pre_plan_mode_cache"
        );
        assert_eq!(
            session.requested_exec_mode_cache.peek(&session.id),
            Some(crate::session::AgentExecMode::Plan),
            "rejected response should stage the next member turn back in plan mode"
        );
    }

    #[test]
    fn drain_prioritizes_user_group_chat_before_regular_inbox() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "background".into(),
                text: "lower priority coordinator backlog".into(),
            },
        })
        .expect("insert regular inbox row");
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: USER_SENDER_ID.into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "User group chat message".into(),
                text: "high priority user group chat".into(),
            },
        })
        .expect("insert user group chat row");

        let mut messages: Vec<Value> = Vec::new();
        let guard = drain_and_render_deferred(
            &ctx,
            "worker-1",
            Some("member-worker-1"),
            &mut messages,
            None,
        );

        assert_eq!(guard.drained_count(), 2);
        assert_eq!(messages.len(), 1);
        let rendered = messages[0]["content"].as_str().unwrap_or_default();
        let user_index = rendered
            .find("high priority user group chat")
            .expect("user group chat row should render");
        let backlog_index = rendered
            .find("lower priority coordinator backlog")
            .expect("regular backlog row should render");
        assert!(
            rendered.contains("high-priority group chat input"),
            "rendered inbox should instruct member to answer user first: {rendered}"
        );
        assert!(
            rendered.contains("from_member_id=\"user\""),
            "user sender should render as user, not system: {rendered}"
        );
        assert!(
            user_index < backlog_index,
            "user group chat row must render before regular inbox row: {rendered}"
        );
        guard.commit();
    }

    /// Turn-failure inbox preservation.
    ///
    /// `drain_and_render_deferred` returns a `DrainGuard` that holds
    /// the mark-read commit until the caller invokes `commit()`. If
    /// the turn fails (or the guard is otherwise dropped), the rows
    /// must remain unread so the next turn re-drains them. Without this
    /// invariant, a stream-error / cancel during the turn that opened
    /// with an inbox attachment would silently lose the message.
    #[test]
    fn deferred_drain_without_commit_leaves_rows_unread() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "worker-1".into(),
            recipient_member_id: Some("member-worker-1".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::Plain {
                summary: "ping".into(),
                text: "hello".into(),
            },
        })
        .expect("insert");

        // First drain: render into messages but DROP the guard without
        // committing — simulates a turn that failed before completion.
        let mut first: Vec<Value> = Vec::new();
        {
            let guard = drain_and_render_deferred(
                &ctx,
                "worker-1",
                Some("member-worker-1"),
                &mut first,
                None,
            );
            assert_eq!(guard.drained_count(), 1);
            // Guard goes out of scope here without `.commit()` — rows
            // stay unread.
        }
        assert_eq!(first.len(), 1, "first drain still rendered the row");

        // Second drain: rows must still be unread because the previous
        // guard never committed. This is the exact "next turn picks
        // them up" recovery path.
        let mut second: Vec<Value> = Vec::new();
        let guard2 =
            drain_and_render_deferred(&ctx, "worker-1", Some("member-worker-1"), &mut second, None);
        assert_eq!(
            guard2.drained_count(),
            1,
            "row must be re-drainable when the previous guard was dropped without commit"
        );
        assert_eq!(second.len(), 1);
        guard2.commit();

        // Third drain: now the row is acked; the inbox is empty.
        let mut third: Vec<Value> = Vec::new();
        let guard3 =
            drain_and_render_deferred(&ctx, "worker-1", Some("member-worker-1"), &mut third, None);
        assert_eq!(guard3.drained_count(), 0);
        assert!(third.is_empty());
        guard3.commit();
    }

    /// Defence-in-depth — a `PlanApprovalResponse`
    /// row whose sender is NOT the coordinator must be dropped on
    /// the read side, even if it somehow landed in the inbox. The
    /// primary check is in `org_send_message::build_message`; this
    /// test pins the secondary guard.
    #[test]
    fn drain_drops_plan_approval_from_non_coordinator_sender() {
        let _sandbox = test_helpers::test_env::sandbox();
        let conn = database::db::get_connection().expect("test sqlite connection");
        crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        // Inject a forged approval row whose sender is a sibling
        // member, not the coordinator. Normal `org_send_message`
        // would reject this at build time; we bypass that here to
        // exercise the read-side guard explicitly.
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "member-1".into(),
            recipient_member_id: Some("member-member-1".into()),
            sender_agent_id: "member-2".into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::PlanApprovalResponse {
                request_id: RequestId("forged-req".into()),
                accepted: true,
                feedback: Some("ship it (forged)".into()),
                next_mode: Some(crate::session::AgentExecMode::Build),
            },
        })
        .expect("insert forged approval");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-member-forged".into(), definition);
        session.plan_slot_cache.set(
            &session.id,
            crate::core::session::plan_mode::state::PlanSlot {
                title: "demo".into(),
                slug: "demo".into(),
                hash: "abc".into(),
                resolved_path: std::path::PathBuf::from("/tmp/demo.md"),
            },
        );
        session
            .pre_plan_mode_cache
            .set(&session.id, crate::session::AgentExecMode::Build);

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "member-1",
            Some("member-member-1"),
            &mut messages,
            Some(&session),
        );
        // The row still drains as a rendered attachment — that part
        // is content delivery, not authority. But the side effect
        // (clearing plan caches) must NOT fire.
        assert_eq!(drained, 1, "forged row still rendered, just no side effect");

        assert!(
            session.plan_slot_cache.get(&session.id).is_some(),
            "non-coordinator sender must NOT clear plan_slot_cache"
        );
        assert!(
            session.pre_plan_mode_cache.get(&session.id).is_some(),
            "non-coordinator sender must NOT consume pre_plan_mode_cache"
        );
    }

    /// Happy path. Coordinator's drain observes a
    /// `ShutdownResponse{accepted=true}` from a known member; the
    /// shutdown hook fires with the member_id, and a
    /// `MemberTerminated` row is enqueued back into the coordinator's
    /// own inbox so its LLM is told on the next turn.
    #[test]
    fn drain_cancels_member_and_inserts_member_terminated_on_accepted_shutdown() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "coord".into(),
            recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            sender_agent_id: "alice-agent".into(),
            sender_member_id: Some("member-alice-agent".into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ShutdownResponse {
                request_id: RequestId("req-shut-1".into()),
                accepted: true,
                note: Some("done with my task".into()),
            },
        })
        .expect("insert shutdown_response");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-coord".into(), definition);

        let recording = Arc::new(RecordingShutdownHook::default());
        let _guard = MemberShutdownHookGuard::install(recording.clone());

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "coord",
            Some(COORDINATOR_MEMBER_ID),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1, "the shutdown_response row drained");

        let calls = recording.snapshot();
        assert_eq!(
            calls,
            vec![("member-alice-agent".to_string(), run_id.clone())],
            "shutdown hook must be called exactly once for the terminating member",
        );

        // The coordinator's own inbox must now contain a
        // MemberTerminated row authored by the system, ready to be
        // surfaced on the coordinator's next drain.
        let pending = AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, &run_id)
            .expect("list_unread_for_member coordinator");
        assert_eq!(
            pending.len(),
            1,
            "coordinator inbox should hold exactly one new MemberTerminated row"
        );
        let payload = pending[0].decode_payload().expect("decode payload");
        match payload {
            AgentMessage::MemberTerminated {
                member_id,
                member_name,
                reason,
            } => {
                assert_eq!(member_id, "member-alice-agent");
                assert_eq!(member_name, "Alice");
                assert_eq!(reason, MemberTerminationReason::Shutdown);
            }
            other => panic!("expected MemberTerminated, got {other:?}"),
        }
        assert_eq!(
            pending[0].sender_agent_id, SYSTEM_SENDER_ID,
            "MemberTerminated row must be authored by the system sender"
        );
        assert_eq!(
            recording.coordinator_wakes(),
            vec![run_id],
            "coordinator must be woken immediately after MemberTerminated is persisted"
        );
    }

    /// When a member acknowledges shutdown, every task it still owns
    /// is released back to the pool (status → pending, owner → null)
    /// so the next idle peer can auto-claim it. Tasks that were
    /// already completed are left alone.
    #[test]
    fn drain_releases_member_tasks_on_accepted_shutdown() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, ClaimOptions, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");

        AgentOrgTaskStore::create(CreateTaskParams {
            id: "open-1".into(),
            org_run_id: run_id.clone(),
            subject: "Half-finished work".into(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .unwrap();
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "done-1".into(),
            org_run_id: run_id.clone(),
            subject: "Already done".into(),
            description: String::new(),
            active_form: None,
            owner: Some("member-alice-agent".into()),
            status: TaskStatus::Completed,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .unwrap();
        AgentOrgTaskStore::try_claim(
            &run_id,
            "open-1",
            "member-alice-agent",
            ClaimOptions::default(),
        )
        .unwrap();

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "coord".into(),
            recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            sender_agent_id: "alice-agent".into(),
            sender_member_id: Some("member-alice-agent".into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ShutdownResponse {
                request_id: RequestId("req-shut-release".into()),
                accepted: true,
                note: None,
            },
        })
        .unwrap();

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-coord".into(), definition);

        let recording = Arc::new(RecordingShutdownHook::default());
        let _guard = MemberShutdownHookGuard::install(recording.clone());

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "coord",
            Some(COORDINATOR_MEMBER_ID),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1);

        // Open task is now unowned and pending again.
        let open = AgentOrgTaskStore::get(&run_id, "open-1").unwrap().unwrap();
        assert!(open.owner.is_none(), "open task must be released: {open:?}");
        assert_eq!(open.status, TaskStatus::Pending);

        // Completed task is untouched — historical record stays attributed.
        let done = AgentOrgTaskStore::get(&run_id, "done-1").unwrap().unwrap();
        assert_eq!(done.owner.as_deref(), Some("member-alice-agent"));
        assert_eq!(done.status, TaskStatus::Completed);
    }

    /// Negative path — `ShutdownResponse{accepted=false}` is
    /// the worker pushing back. No cancel, no MemberTerminated row;
    /// the rendered attachment alone is what the coordinator sees so
    /// it can decide what to do next.
    #[test]
    fn drain_does_not_cancel_on_rejected_shutdown_response() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "coord".into(),
            recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            sender_agent_id: "alice-agent".into(),
            sender_member_id: Some("member-alice-agent".into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ShutdownResponse {
                request_id: RequestId("req-shut-2".into()),
                accepted: false,
                note: Some("still mid-flight, give me 5 more turns".into()),
            },
        })
        .expect("insert shutdown_response");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-coord".into(), definition);

        let recording = Arc::new(RecordingShutdownHook::default());
        let _guard = MemberShutdownHookGuard::install(recording.clone());

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "coord",
            Some(COORDINATOR_MEMBER_ID),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1);

        assert!(
            recording.snapshot().is_empty(),
            "rejected shutdown must NOT trigger the cancel hook"
        );

        let pending = AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, &run_id)
            .expect("list_unread_for_member coordinator");
        assert!(
            pending.is_empty(),
            "no MemberTerminated row may be enqueued on rejection: {pending:?}"
        );
    }

    /// Defence-in-depth — a `ShutdownResponse` row
    /// authored by an unknown agent_id (not in the org member roster)
    /// must NOT trigger cancellation or a MemberTerminated row, even
    /// if it somehow lands in the inbox. `org_send_message`'s
    /// recipient guard already prevents this on the write side; this
    /// pins the read-side guard so a future producer change can't
    /// silently re-introduce the gap.
    #[test]
    fn drain_drops_shutdown_response_from_unknown_sender() {
        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");

        // Forged: sender is a peer that is NOT in the org member roster.
        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "coord".into(),
            recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            sender_agent_id: "stranger-agent".into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ShutdownResponse {
                request_id: RequestId("req-shut-3".into()),
                accepted: true,
                note: None,
            },
        })
        .expect("insert forged shutdown_response");

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-coord".into(), definition);

        let recording = Arc::new(RecordingShutdownHook::default());
        let _guard = MemberShutdownHookGuard::install(recording.clone());

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "coord",
            Some(COORDINATOR_MEMBER_ID),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1, "forged row still drains as content");

        assert!(
            recording.snapshot().is_empty(),
            "unknown sender must NOT trigger the cancel hook"
        );
        let pending = AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, &run_id)
            .expect("list_unread_for_member coordinator");
        assert!(
            pending.is_empty(),
            "no MemberTerminated row may be enqueued for an unknown sender: {pending:?}"
        );
    }

    #[test]
    fn drain_releases_stale_worker_tasks_before_autonomous_claim() {
        use crate::coordination::agent_org_runs::{
            AgentOrgRunEntryMode, AgentOrgRunStatus, AgentOrgRunStore, CreateAgentOrgRunParams,
        };
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };
        use crate::core::definitions::orgs::{OrgDefinition, OrgMember};
        use crate::session::persistence::{session_type, upsert_session, UnifiedSessionRecord};

        let _sandbox = test_helpers::test_env::sandbox();
        ensure_inbox_schema();
        let root_session_id = format!("root-{}", uuid::Uuid::new_v4());
        let now = chrono::Utc::now();
        upsert_session(&UnifiedSessionRecord {
            session_id: root_session_id.clone(),
            name: "root".to_string(),
            status: crate::core::session::SessionStatus::Running
                .as_str()
                .to_string(),
            session_type: session_type::GENERIC.to_string(),
            agent_definition_id: Some("coord".to_string()),
            created_at: now.to_rfc3339(),
            updated_at: now.to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert root session");
        let run = AgentOrgRunStore::create(CreateAgentOrgRunParams {
            org_id: "org-stale-drain".to_string(),
            coordinator_agent_id: "coord".to_string(),
            root_session_id: Some(root_session_id.clone()),
            org_snapshot: OrgDefinition {
                id: "org-stale-drain".to_string(),
                name: "Stale Drain Org".to_string(),
                role: "coordinator".to_string(),
                agent_id: "coord".to_string(),
                description: None,
                hierarchy_mode: Default::default(),
                children: vec![
                    OrgMember {
                        id: "member-stale".to_string(),
                        name: "Stale Worker".to_string(),
                        role: "worker".to_string(),
                        agent_id: "stale-worker".to_string(),
                        runtime_config: None,
                        children: Vec::new(),
                    },
                    OrgMember {
                        id: "member-fresh".to_string(),
                        name: "Fresh Worker".to_string(),
                        role: "worker".to_string(),
                        agent_id: "fresh-worker".to_string(),
                        runtime_config: None,
                        children: Vec::new(),
                    },
                ],
            },
            entry_mode: AgentOrgRunEntryMode::StandaloneSession,
            status: AgentOrgRunStatus::Running,
            work_item_id: None,
            project_slug: None,
            routine_fire_id: None,
        })
        .expect("create org run");
        let stale_time =
            now - chrono::Duration::seconds(STALE_WORKER_TASK_RELEASE_TIMEOUT_SECS + 60);
        upsert_session(&UnifiedSessionRecord {
            session_id: "stale-worker-session".to_string(),
            name: "stale worker".to_string(),
            status: crate::core::session::SessionStatus::Running
                .as_str()
                .to_string(),
            session_type: session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some(root_session_id.clone()),
            agent_definition_id: Some("stale-worker".to_string()),
            org_member_id: Some("member-stale".to_string()),
            created_at: stale_time.to_rfc3339(),
            updated_at: stale_time.to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert stale worker");
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "stale-drain-task".to_string(),
            org_run_id: run.id.clone(),
            subject: "stale drain task".to_string(),
            description: String::new(),
            active_form: None,
            owner: Some("member-stale".to_string()),
            status: TaskStatus::InProgress,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create stale-owned task");

        let workers = AgentOrgRunStore::list_descendant_worker_sessions(&run.id)
            .expect("list descendant workers before stale release");
        assert!(
            workers
                .iter()
                .any(|worker| worker.member_id.as_deref() == Some("member-stale")),
            "stale worker session must be discoverable before release: {workers:?}"
        );

        let mut ctx = ctx_for_with_member(&run.id, "stale-worker", "Stale Worker");
        ctx.members
            .push(crate::coordination::agent_org_runs::AgentOrgContextMember {
                member_id: "member-fresh".to_string(),
                agent_id: "fresh-worker".to_string(),
                name: "Fresh Worker".to_string(),
                role: "worker".to_string(),
                parent_member_id: None,
            });
        ctx.root_session_id = Some(root_session_id.clone());
        let mut messages = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "fresh-worker",
            Some("member-fresh"),
            &mut messages,
            None,
        );
        assert_eq!(drained, 1, "fresh worker should auto-claim released task");
        let stored = AgentOrgTaskStore::get(&run.id, "stale-drain-task")
            .expect("get task")
            .expect("task exists");
        assert_eq!(stored.owner.as_deref(), Some("member-fresh"));
        assert_eq!(stored.status, TaskStatus::InProgress);
        let body = messages[0]["content"].as_str().expect("content");
        assert!(body.contains("task_id=\"stale-drain-task\""), "{body}");
    }

    /// A member with an empty inbox auto-claims the next available
    /// task. The claim posts a self-`TaskAssigned` row that the
    /// immediately-following `list_unread_for_member` call drains
    /// and renders into the turn attachment.
    #[test]
    fn autonomous_claim_picks_up_unowned_task_for_idle_member() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice", "Alice");

        AgentOrgTaskStore::create(CreateTaskParams {
            id: "claim-1".into(),
            org_run_id: run_id.clone(),
            subject: "Refactor the auth layer".into(),
            description: "details".into(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .expect("create task");

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(&ctx, "alice", Some("member-alice"), &mut messages, None);
        assert_eq!(drained, 1, "self-claim row should be the only injected row");
        let body = messages[0]["content"].as_str().expect("content");
        assert!(body.contains("kind=\"task_assigned\""), "{body}");
        assert!(body.contains("Refactor the auth layer"), "{body}");

        // The store row is now owned by alice and in_progress.
        let stored = AgentOrgTaskStore::get(&run_id, "claim-1").unwrap().unwrap();
        assert_eq!(stored.owner.as_deref(), Some("member-alice"));
        assert_eq!(stored.status, TaskStatus::InProgress);
    }

    /// A member that already has work in flight does not steal another
    /// task on the next drain (skip-if-busy branch in the polling loop).
    #[test]
    fn autonomous_claim_skips_when_member_already_busy() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, ClaimOptions, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice", "Alice");

        AgentOrgTaskStore::create(CreateTaskParams {
            id: "busy-1".into(),
            org_run_id: run_id.clone(),
            subject: "First".into(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .unwrap();
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "busy-2".into(),
            org_run_id: run_id.clone(),
            subject: "Second".into(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "busy-1", "member-alice", ClaimOptions::default())
            .unwrap();

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(&ctx, "alice", Some("member-alice"), &mut messages, None);
        assert_eq!(drained, 0, "busy member should not auto-claim again");
        let busy2 = AgentOrgTaskStore::get(&run_id, "busy-2").unwrap().unwrap();
        assert!(
            busy2.owner.is_none(),
            "second task must remain unclaimed: {busy2:?}"
        );
    }

    /// `ExecModeSetRequest` from the coordinator stages the new mode
    /// on the member's session cache so the next `send_message_impl`
    /// consumes it via `requested_exec_mode_cache.take()`. Mirrors the
    /// way `PlanApprovalResponse{accepted=true}` clears plan caches as
    /// a side effect of the same drain.
    #[test]
    fn drain_stages_exec_mode_override_for_coordinator_request() {
        use crate::session::AgentExecMode;

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "alice-agent".into(),
            recipient_member_id: Some("member-alice-agent".into()),
            sender_agent_id: "coord".into(),
            sender_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ExecModeSetRequest {
                request_id: RequestId("req-mode-drain".into()),
                mode: AgentExecMode::Plan,
                reason: Some("draft a plan".into()),
            },
        })
        .unwrap();

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-alice".into(), definition);

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "alice-agent",
            Some("member-alice-agent"),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1, "row drained as user attachment");
        let body = messages[0]["content"].as_str().unwrap();
        assert!(
            body.contains("exec_mode_set_request") && body.contains("mode=\"plan\""),
            "row must render with the requested mode: {body}"
        );

        let staged = session
            .requested_exec_mode_cache
            .peek(&session.id)
            .expect("cache must hold the override after drain");
        assert_eq!(staged, AgentExecMode::Plan);
    }

    /// Defence-in-depth: an `ExecModeSetRequest` row from a
    /// non-coordinator sender (a peer or stranger) must NOT mutate the
    /// member's mode cache. The build-side guard in
    /// `org_send_message` already prevents this; this pins the
    /// read-side guard so a future producer change can't silently
    /// re-introduce the gap.
    #[test]
    fn drain_drops_exec_mode_request_from_non_coordinator_sender() {
        use crate::session::AgentExecMode;

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut ctx = ctx_for_with_member(&run_id, "alice-agent", "Alice");
        // Add a peer member so the forged sender resolves to a
        // legitimate-looking agent_id, not a stranger.
        ctx.members
            .push(crate::coordination::agent_org_runs::AgentOrgContextMember {
                member_id: "bob".into(),
                name: "Bob".into(),
                role: "engineer".into(),
                agent_id: "bob-agent".into(),
                parent_member_id: None,
            });

        AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "alice-agent".into(),
            recipient_member_id: Some("member-alice-agent".into()),
            sender_agent_id: "bob-agent".into(),
            sender_member_id: None,
            org_run_id: Some(run_id.clone()),
            message: AgentMessage::ExecModeSetRequest {
                request_id: RequestId("req-forged".into()),
                mode: AgentExecMode::Plan,
                reason: None,
            },
        })
        .unwrap();

        let definition = crate::core::definitions::builtin::sde_agent();
        let session = crate::state::AgentSession::new("session-alice".into(), definition);

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "alice-agent",
            Some("member-alice-agent"),
            &mut messages,
            Some(&session),
        );
        assert_eq!(drained, 1, "forged row still drains as content");
        assert!(
            session
                .requested_exec_mode_cache
                .peek(&session.id)
                .is_none(),
            "non-coordinator sender must NOT stage a mode override"
        );
    }

    /// The coordinator never auto-claims (only members poll; the
    /// coordinator dispatches work).
    #[test]
    fn autonomous_claim_skips_for_coordinator() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let ctx = ctx_for(&run_id);

        AgentOrgTaskStore::create(CreateTaskParams {
            id: "coord-1".into(),
            org_run_id: run_id.clone(),
            subject: "Plan".into(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        })
        .unwrap();

        let mut messages: Vec<Value> = Vec::new();
        let drained = drain_and_render(
            &ctx,
            "coord",
            Some(COORDINATOR_MEMBER_ID),
            &mut messages,
            None,
        );
        assert_eq!(drained, 0);
        let stored = AgentOrgTaskStore::get(&run_id, "coord-1").unwrap().unwrap();
        assert!(stored.owner.is_none());
    }
}
