//! Core drain logic: [`drain_and_render_deferred`], side effects, and
//! autonomous task claiming.

use serde_json::Value;
use tracing::{info, warn};

use crate::coordination::agent_inbox::{
    AgentInboxRecord, AgentInboxStore, AgentMessage, InsertInboxParams, MemberTerminationReason,
    SYSTEM_SENDER_ID, USER_SENDER_ID,
};
use chrono::{Duration, Utc};

use crate::coordination::agent_member_interventions::AgentMemberInterventionStore;
use crate::coordination::agent_org_runs::{
    AgentOrgRunContext, AgentOrgRunStatus, AgentOrgRunStore, COORDINATOR_MEMBER_ID,
};
use crate::coordination::agent_org_tasks::AgentOrgTaskStore;
use crate::state::AgentSession;

use super::guard::DrainGuard;
use super::hooks::{current_member_shutdown_hook, MemberShutdownHook};
use super::render::{render_inbox_attachment, render_inbox_transcript};
use super::routing::{resolve_recipient_member_id, resolve_sender_member};

pub const STALE_WORKER_TASK_RELEASE_TIMEOUT_SECS: i64 = 15 * 60;

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

    let pending_ids: Vec<i64> = unread.iter().map(|row| row.id).collect();
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

pub(super) fn release_stale_worker_tasks(
    org_context: &AgentOrgRunContext,
    recipient_member_id: Option<&str>,
) {
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
