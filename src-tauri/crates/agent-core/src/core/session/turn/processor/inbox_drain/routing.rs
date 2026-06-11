//! Recipient / sender resolution helpers for the inbox drain.

use crate::coordination::agent_org_runs::{
    AgentOrgContextMember, AgentOrgRunContext, AgentOrgRunStore, COORDINATOR_MEMBER_ID,
};
use crate::state::AgentSession;
use tracing::warn;

pub(super) fn resolve_recipient_member_id(
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

pub(super) fn resolve_sender_member<'a>(
    org_context: &'a AgentOrgRunContext,
    row: &crate::coordination::agent_inbox::AgentInboxRecord,
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
