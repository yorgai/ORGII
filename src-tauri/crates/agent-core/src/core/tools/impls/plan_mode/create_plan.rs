//! `create_plan` tool — writes the session plan file and submits it through
//! the approval channel appropriate for the current runtime.
//!
//! Behavior:
//! - Only valid in Plan mode (enforced by the policy allow-list).
//! - Writes the plan markdown to disk via `plan_file_path` + `PlanSlotCache`.
//! - For top-level sessions and coordinators, calls
//!   `PlanApprovalManager::mark_ready`, which broadcasts
//!   `agent:plan_ready_for_approval` so the frontend can enable the user-facing
//!   Build button.
//! - For non-coordinator Agent Org members, delivers a typed
//!   `PlanApprovalRequest` to the coordinator inbox instead of involving the
//!   user-facing Build approval surface.
//! - Returns a tool-result string prefixed with `PLAN_SUBMITTED_END_TURN_PREFIX`
//!   so `turn_executor::tool_execution::single` early-exits the current turn.
//!   The LLM is instructed to stop after calling this tool; the prefix is the
//!   enforcement mechanism in case it tries to continue.
//!
//! Subagents cannot reach this tool: `create_plan` is in
//! `SUBAGENT_FORBIDDEN_TOOLS` (subagents cannot enter plan mode), so
//! the policy hard-deny layer rejects any subagent-originated call
//! before execute() is entered. See the
//! `subagent_reaching_execute_is_a_wiring_bug` assertion below.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex as TokioMutex;

use crate::coordination::agent_inbox::{
    AgentInboxStore, AgentMessage, InsertInboxParams, RequestId,
};
use crate::coordination::agent_org_runs::{AgentOrgRunContext, COORDINATOR_MEMBER_ID};
use crate::interaction::plan_approval::PlanApprovalManager;
use crate::session::plan_mode::{
    plan_file_path, random_hash, slugify_plan_title, PlanPathCtx, PlanSlot, PlanSlotCache,
};
use crate::tools::names as tool_names;
use crate::tools::traits::{Tool, ToolError};

/// Sentinel prefix on the tool-result text that tells
/// `turn_executor::tool_execution::single` to early-exit the current turn
/// after `create_plan` has marked a pending plan ready for approval. Mirrors
/// `SWITCH_ACCEPTED_PREFIX` used by `suggest_mode_switch` — without this the
/// LLM tends to narrate more text in the same turn even though the prompt
/// says to stop, which keeps `sessionRuntimeStatus` stuck at `running` after
/// the FE "Build" card has already rendered.
pub const PLAN_SUBMITTED_END_TURN_PREFIX: &str = "PLAN_SUBMITTED_END_TURN:";

/// Shared context for the `create_plan` tool.
///
/// `session_id` is stamped via `set_session_key()`. The plan-file slot cache
/// is injected at session init. `plan_approval_manager` is the
/// Build-button approval channel. It is kept as `Option` because
/// non-coding agents (e.g. a pure Q&A custom definition) may register the
/// tool without a manager; the tool errors out in that case rather than
/// silently writing a plan file that can never be submitted.
///
/// `agent_org_context` is set when the session participates in an
/// `AgentOrgRun`. When the calling session is an org *member* (not the
/// coordinator), `execute_text` routes the plan to the coordinator's
/// inbox as a typed `PlanApprovalRequest` instead of lighting up the
/// user's Build button — there is no human in the loop to click Build
/// inside an LLM-driven org run, so the coordinator is the only entity
/// that can actually approve. Coordinator and non-org sessions keep the
/// existing user-facing flow unchanged.
pub struct CreatePlanToolContext {
    pub session_id: TokioMutex<Option<String>>,
    pub plan_slot_cache: PlanSlotCache,
    pub plan_approval_manager: Option<Arc<PlanApprovalManager>>,
    pub agent_org_context: Option<AgentOrgRunContext>,
    pub agent_org_current_member_id: Option<String>,
}

impl CreatePlanToolContext {
    pub fn new(
        plan_slot_cache: PlanSlotCache,
        plan_approval_manager: Option<Arc<PlanApprovalManager>>,
        agent_org_context: Option<AgentOrgRunContext>,
        agent_org_current_member_id: Option<String>,
    ) -> Self {
        Self {
            session_id: TokioMutex::new(None),
            plan_slot_cache,
            plan_approval_manager,
            agent_org_context,
            agent_org_current_member_id,
        }
    }
}

pub struct CreatePlanTool {
    context: Arc<CreatePlanToolContext>,
}

impl CreatePlanTool {
    pub fn new(context: Arc<CreatePlanToolContext>) -> Self {
        Self { context }
    }
}

/// Record stored on success — serialized as the body of the tool-result
/// string (after the end-turn sentinel prefix, when applicable).
#[derive(serde::Serialize)]
struct CreatePlanResult {
    path: String,
    slug: String,
    hash: String,
    bytes_written: usize,
    new_plan: bool,
    /// `true` when this call also fired `PlanApprovalManager::mark_ready`.
    /// Subagent calls report `false` here.
    submitted_for_review: bool,
}

#[async_trait]
impl Tool for CreatePlanTool {
    fn name(&self) -> &str {
        tool_names::CREATE_PLAN
    }

    fn description(&self) -> &str {
        concat!(
            "Write the current session's plan document and submit it to the user for review. ",
            "Only available in Plan mode. Supply a short descriptive `title` and the full ",
            "markdown `content`. Calling this tool IS the submission: the plan card becomes ",
            "clickable in the UI (Build button lights up) and the agent turn ends immediately ",
            "after the tool returns. Do NOT narrate \"ready for your review\" text — just call ",
            "the tool. If the user replies in chat with feedback for an existing pending ",
            "plan, treat that reply as feedback on the previous `create_plan` tool call in ",
            "the conversation history. Use the previous tool-call arguments/result as the ",
            "source for the current plan body; do not ask the user to resend the plan and ",
            "do not search the codebase just to recover it. Call `create_plan` again with ",
            "the revised full plan and keep `new_plan` false. That updates the same pending ",
            "approval slot and emits a new revision card. Only pass `new_plan: true` when the user explicitly asks ",
            "for a distinct new plan. ",
            "Do not use file tools to read or write plan files; this tool is the only submission/update path. ",
            "IMPORTANT: After calling this tool, STOP immediately — any text or tool calls ",
            "produced in the same turn will be discarded."
        )
    }

    fn llm_description(&self) -> Option<String> {
        let mut description = concat!(
            "Write the current session's plan document and submit it to the user for review. ",
            "Only available in Plan mode. Supply a short descriptive `title` and the full ",
            "markdown `content`. Calling this tool IS the submission: the plan card becomes ",
            "clickable in the UI (Build button lights up) and the agent turn ends immediately ",
            "after the tool returns. Do NOT narrate \"ready for your review\" text — just call ",
            "the tool. If the user replies in chat with feedback for an existing pending plan, ",
            "treat that reply as feedback on the previous `create_plan` tool call in the conversation history. ",
            "Use the previous tool-call arguments/result as the source for the current plan body; ",
            "do not ask the user to resend the plan and do not search the codebase just to recover it. ",
            "Call `create_plan` again with the revised full plan and keep `new_plan` false. ",
            "That updates the same pending approval slot and emits a new revision card. Only pass ",
            "`new_plan: true` when the user explicitly asks for a distinct new plan. ",
            "Do not use file tools to read or write plan files; this tool is the only submission/update path. ",
        )
        .to_string();

        if let Some(pending) = self
            .context
            .plan_approval_manager
            .as_ref()
            .and_then(|manager| manager.pending_snapshot_now())
        {
            description.push_str(&format!(
                "CURRENT PENDING PLAN: title=`{}`, revision_id=`{}`. The user's next Plan-mode feedback is about this pending approval unless they explicitly ask for a distinct new plan. Update this pending approval by calling `create_plan` with the revised full markdown body and `new_plan=false`; do not create an unrelated plan, do not use file tools to edit plan files, and do not answer with prose. ",
                pending.plan_title, pending.plan_revision_id
            ));
        }

        description.push_str(
            "IMPORTANT: After calling this tool, STOP immediately — any text or tool calls produced in the same turn will be discarded."
        );

        Some(description)
    }

    fn category(&self) -> &str {
        crate::tools::categories::PLAN_MODE
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "required": ["title", "content"],
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Short descriptive plan title, e.g. \"Refactor auth layer\". Used for the plan card identity."
                },
                "content": {
                    "type": "string",
                    "description": "Full markdown body of the plan. Must include the required sections described in the Plan mode system prompt."
                },
                "new_plan": {
                    "type": "boolean",
                    "description": "Start a distinct new plan approval instead of updating the current pending approval. Defaults to false.",
                    "default": false
                }
            }
        })
    }

    async fn execute_text(
        &self,
        params: Value,
        ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        // Per-call tool_call_id flows through `CallContext` (constructed
        // by `tool_execution` dispatch sites). Empty when a direct
        // in-process caller forgot to populate ctx.
        let tool_call_id = if ctx.call_id.is_empty() {
            None
        } else {
            Some(ctx.call_id.clone())
        };

        let title = params
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                ToolError::InvalidParams("create_plan requires a non-empty `title`".into())
            })?
            .to_string();

        let content = params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidParams("create_plan requires `content`".into()))?
            .to_string();

        let new_plan = params
            .get("new_plan")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Per-call session attribution comes from `CallContext` —
        // race-free even when concurrent background subagents share the
        // parent's ToolRegistry. (The legacy stored `set_session_key`
        // value was shared mutable state: a concurrent subagent could
        // re-stamp it at turn start, last-writer-wins, causing the
        // parent's create_plan to load the subagent's session row and
        // trip the wiring-bug assertion.) Fall back to the stored value
        // only for direct in-process callers / tests that didn't
        // populate ctx.
        let session_id = if !ctx.session_id.is_empty() {
            ctx.session_id.clone()
        } else {
            self.context
                .session_id
                .lock()
                .await
                .clone()
                .ok_or_else(|| {
                    ToolError::ExecutionFailed(
                        "create_plan invoked before session_id was set — this is a wiring bug"
                            .into(),
                    )
                })?
        };

        let pending_plan = if new_plan {
            None
        } else {
            match self.context.plan_approval_manager.as_ref() {
                Some(manager) => manager.pending_snapshot().await,
                None => None,
            }
        };

        // Resolve session-derived fields via the DB record. Any failure here is
        // an execution error (not an "invalid params" — the LLM can't fix it).
        let record = crate::session::persistence::get_session(&session_id)
            .map_err(|err| {
                ToolError::ExecutionFailed(format!(
                    "create_plan: failed to load session {session_id}: {err}"
                ))
            })?
            .ok_or_else(|| {
                ToolError::ExecutionFailed(format!("create_plan: session {session_id} not found"))
            })?;

        let workspace_path = record.workspace_path.clone();
        // Hard invariant: subagents cannot reach `create_plan` because it
        // is in `SUBAGENT_FORBIDDEN_TOOLS`. If the policy layer ever lets
        // one through, that is a wiring bug and we must fail loudly —
        // silently writing a sibling plan file is what produced the
        // "Build button permanently disabled after regenerate in a
        // subagent-delegated plan turn" regression (2026-04-21).
        if record.parent_session_id.is_some() && record.org_member_id.is_none() {
            return Err(ToolError::ExecutionFailed(format!(
                "create_plan invoked from subagent session {session_id} \
                 (parent={}) — subagent policy layer must hard-deny this \
                 tool (SUBAGENT_FORBIDDEN_TOOLS); this is a wiring bug",
                record.parent_session_id.as_deref().unwrap_or("?"),
            )));
        }
        let agent_id = record.agent_definition_id.as_deref().unwrap_or("default");

        // Decide whether to update the current pending approval slot or rotate it.
        let slot = if let Some(pending) = pending_plan.as_ref() {
            let slot = PlanSlot {
                title: title.clone(),
                slug: slugify_plan_title(&title),
                hash: "pending".to_string(),
                resolved_path: PathBuf::from(&pending.plan_path),
            };
            self.context.plan_slot_cache.set(&session_id, slot.clone());
            slot
        } else {
            match (new_plan, self.context.plan_slot_cache.get(&session_id)) {
                (false, Some(existing)) if existing.title == title => existing,
                _ => {
                    let hash = random_hash();
                    let slug = slugify_plan_title(&title);
                    let ctx = PlanPathCtx {
                        workspace_path: workspace_path.as_deref(),
                        agent_id,
                        // `sub_agent_id` was used to namespace subagent plan
                        // files; subagents can no longer reach this tool, so
                        // every call is top-level and the slot is always the
                        // parent's.
                        sub_agent_id: None,
                        title: &title,
                        hash: &hash,
                    };
                    let resolved_path: PathBuf = plan_file_path(&ctx).ok_or_else(|| {
                        ToolError::ExecutionFailed(
                            "create_plan: could not resolve plan directory — no workspace_path and $HOME missing".into(),
                        )
                    })?;
                    let new_slot = PlanSlot {
                        title: title.clone(),
                        slug,
                        hash,
                        resolved_path,
                    };
                    self.context
                        .plan_slot_cache
                        .set(&session_id, new_slot.clone());
                    new_slot
                }
            }
        };

        if let Some(parent) = slot.resolved_path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| {
                ToolError::ExecutionFailed(format!(
                    "create_plan: failed to create {}: {err}",
                    parent.display()
                ))
            })?;
        }

        std::fs::write(&slot.resolved_path, content.as_bytes()).map_err(|err| {
            ToolError::ExecutionFailed(format!(
                "create_plan: failed to write {}: {err}",
                slot.resolved_path.display()
            ))
        })?;

        // Two submission paths:
        //   * Org member (not coordinator) → route the plan to the
        //     coordinator's inbox as a typed `PlanApprovalRequest`. There
        //     is no human in the loop to click Build inside an LLM-driven
        //     org run; the coordinator is the only entity that can
        //     actually approve.
        //   * Top-level session, coordinator, or solo plan-mode session →
        //     keep the existing user-facing flow (broadcast via
        //     `PlanApprovalManager::mark_ready` so the FE Build button
        //     lights up).
        if let Some(org_ctx) = self.context.agent_org_context.as_ref() {
            let sender_member_id = self.context.agent_org_current_member_id.as_deref();
            if sender_member_id.is_some() && sender_member_id != Some(COORDINATOR_MEMBER_ID) {
                let sender_member_id = sender_member_id.expect("checked Some above");
                let sender_agent_id = org_ctx
                    .members
                    .iter()
                    .find(|member| member.member_id == sender_member_id)
                    .map(|member| member.agent_id.clone())
                    .ok_or_else(|| {
                        ToolError::ExecutionFailed(format!(
                            "create_plan: runtime member_id '{sender_member_id}' is not in Agent Org roster"
                        ))
                    })?;
                let request_id = RequestId::new();
                let message = AgentMessage::PlanApprovalRequest {
                    request_id: request_id.clone(),
                    plan_title: slot.title.clone(),
                    plan_path: slot.resolved_path.to_string_lossy().into_owned(),
                    plan_content: content.clone(),
                };
                AgentInboxStore::insert(InsertInboxParams {
                    recipient_agent_id: org_ctx.coordinator_agent_id.clone(),
                    recipient_member_id: Some(COORDINATOR_MEMBER_ID.to_string()),
                    sender_agent_id,
                    sender_member_id: Some(sender_member_id.to_string()),
                    org_run_id: Some(org_ctx.run_id.clone()),
                    message,
                })
                .map_err(|err| {
                    ToolError::ExecutionFailed(format!(
                        "create_plan: failed to deliver plan to coordinator inbox: {err}"
                    ))
                })?;

                let result = CreatePlanResult {
                    path: slot.resolved_path.to_string_lossy().into_owned(),
                    slug: slot.slug.clone(),
                    hash: slot.hash.clone(),
                    bytes_written: content.len(),
                    new_plan,
                    submitted_for_review: true,
                };
                let body = serde_json::to_string(&result).map_err(|err| {
                    ToolError::ExecutionFailed(format!(
                        "create_plan: failed to serialize success payload: {err}"
                    ))
                })?;
                return Ok(format!("{PLAN_SUBMITTED_END_TURN_PREFIX}{body}"));
            }
        }

        // User-facing approval path. We already asserted this is a
        // top-level session above; the only remaining contingency is a
        // non-coding agent that registered the tool without a manager,
        // which is a wiring bug (there is no way to submit a plan without
        // the manager — silently writing the file is strictly worse than
        // failing loudly).
        let manager = self.context.plan_approval_manager.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed(
                "create_plan registered without a PlanApprovalManager — \
                 the Build button approval channel is missing; this is a \
                 wiring bug (only coding-capable top-level sessions \
                 should register this tool)"
                    .into(),
            )
        })?;
        manager
            .mark_ready(
                &session_id,
                &slot.resolved_path.to_string_lossy(),
                &slot.title,
                &content,
                tool_call_id.as_deref(),
            )
            .await;

        let result = CreatePlanResult {
            path: slot.resolved_path.to_string_lossy().into_owned(),
            slug: slot.slug.clone(),
            hash: slot.hash.clone(),
            bytes_written: content.len(),
            new_plan,
            submitted_for_review: true,
        };
        let body = serde_json::to_string(&result).map_err(|err| {
            ToolError::ExecutionFailed(format!(
                "create_plan: failed to serialize success payload: {err}"
            ))
        })?;

        Ok(format!("{PLAN_SUBMITTED_END_TURN_PREFIX}{body}"))
    }

    async fn set_session_key(&self, session_key: &str) {
        *self.context.session_id.lock().await = Some(session_key.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_without_manager() -> CreatePlanTool {
        CreatePlanTool::new(Arc::new(CreatePlanToolContext::new(
            PlanSlotCache::new(),
            None,
            None,
            None,
        )))
    }

    #[tokio::test]
    async fn rejects_missing_title() {
        let tool = tool_without_manager();
        tool.set_session_key("s1").await;
        let err = tool
            .execute(
                serde_json::json!({ "content": "body" }),
                &crate::tools::call_context::CallContext::default(),
            )
            .await
            .expect_err("missing title must fail");
        assert!(matches!(err, ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn rejects_blank_title() {
        let tool = tool_without_manager();
        tool.set_session_key("s1").await;
        let err = tool
            .execute(
                serde_json::json!({ "title": "   ", "content": "body" }),
                &crate::tools::call_context::CallContext::default(),
            )
            .await
            .expect_err("blank title must fail");
        assert!(matches!(err, ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn rejects_missing_content() {
        let tool = tool_without_manager();
        tool.set_session_key("s1").await;
        let err = tool
            .execute(
                serde_json::json!({ "title": "Plan A" }),
                &crate::tools::call_context::CallContext::default(),
            )
            .await
            .expect_err("missing content must fail");
        assert!(matches!(err, ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn rejects_when_session_key_unset() {
        let tool = tool_without_manager();
        let err = tool
            .execute(
                serde_json::json!({ "title": "Plan A", "content": "x" }),
                &crate::tools::call_context::CallContext::default(),
            )
            .await
            .expect_err("unset session key must fail");
        assert!(matches!(err, ToolError::ExecutionFailed(_)));
    }

    /// The tool-result sentinel prefix is always emitted on a successful
    /// execute — every call is now top-level and hits `mark_ready`. The
    /// end-to-end stamp + mark flow needs a live DB record for
    /// `get_session`, so it lives in the integration test suite
    /// (`crates/e2e-test/src/sde/exec_modes.rs`), not here.
    #[tokio::test]
    async fn llm_description_includes_live_pending_plan_snapshot() {
        let manager = Arc::new(PlanApprovalManager::new());
        manager
            .mark_ready(
                "session-1",
                "/tmp/current.plan.md",
                "Current approval plan",
                "# Current approval plan\n\nBuild steps.",
                Some("call-current"),
            )
            .await;
        let tool = CreatePlanTool::new(Arc::new(CreatePlanToolContext::new(
            PlanSlotCache::new(),
            Some(manager),
            None,
            None,
        )));

        let description = tool.llm_description().expect("description");
        assert!(description.contains("CURRENT PENDING PLAN"));
        assert!(description.contains("Current approval plan"));
        assert!(description.contains("call-current"));
        assert!(description.contains("new_plan=false"));
        assert!(description.contains("do not use file tools to edit plan files"));
        assert!(description.contains("do not answer with prose"));
        assert!(!description.contains("/tmp/current.plan.md"));
    }

    #[test]
    fn sentinel_prefix_is_stable() {
        assert_eq!(PLAN_SUBMITTED_END_TURN_PREFIX, "PLAN_SUBMITTED_END_TURN:");
    }
}
