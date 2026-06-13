//! Task-board LLM tools — `task_create`, `task_update`, `task_list`,
//! `task_get` over `AgentOrgTaskStore`.
//!
//! Registration policy (see `init/tool_assembly.rs`):
//! - Available **only** when the session has an `AgentOrgRunContext`
//!   (i.e. it is the coordinator or one of the org members).
//! - Coordinator and members both get the full set; the task tools are
//!   registered for every teammate, not just the leader. The store
//!   enforces atomicity, so concurrent writes from multiple agents are
//!   safe.
//! - Outside an org run the tools are not registered (so plain
//!   single-agent sessions can't accidentally create dangling task
//!   rows).
//!
//! Side effects:
//! - `task_create` and `task_update` (when they set/change `owner`) emit
//!   a `TaskAssigned` row to the new owner's inbox via
//!   `agent_org_tasks::enqueue_task_assigned`. The wake hook fires so
//!   the recipient's session is brought up to drain its inbox.
//! - `task_update` with `status="deleted"` deletes the row instead of
//!   updating it. `deleted` is not a stored status — it is a sentinel
//!   value that means "remove this row from the board" so the LLM
//!   does not need a separate `task_delete` tool.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::coordination::agent_inbox::SYSTEM_SENDER_ID;
use crate::coordination::agent_org_runs::{AgentOrgRunContext, COORDINATOR_MEMBER_ID};
use crate::coordination::agent_org_tasks::{
    self, AgentOrgTaskStore, Task, TaskStatus, TASK_DEPENDENCY_CYCLE_ERROR,
};
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;
use crate::tools::traits::ToolError;

#[path = "task_create.rs"]
pub mod task_create;
#[path = "task_list_get.rs"]
pub mod task_list_get;
#[cfg(test)]
#[path = "task_tests.rs"]
mod task_tests;
#[path = "task_update.rs"]
pub mod task_update;

pub use task_create::{TaskCreateParams, TaskCreateTool};
pub use task_list_get::{
    claim_error_message, TaskGetParams, TaskGetTool, TaskListParams, TaskListTool,
};
pub use task_update::{TaskUpdateParams, TaskUpdateTool};

/// Shared context for the four task tools. Cloned cheaply via `Arc` —
/// every tool stores its own clone so registry slots stay independent.
pub struct TaskToolsContext {
    pub org_context: Arc<AgentOrgRunContext>,
    /// Backing agent definition id of the calling session. This is transport
    /// metadata for legacy inbox columns only; task ownership never resolves
    /// through this value.
    pub caller_agent_id: String,
    /// Stable org roster member id for the calling participant.
    /// This is the task owner identity; agent_id is only the backing
    /// agent definition/template and may be shared by multiple members.
    pub caller_member_id: String,
    /// Best-effort wake hook so the new owner's session is brought up
    /// after a `TaskAssigned` row is persisted. Same hook
    /// `org_send_message` uses; passed in here so tests can inject
    /// the no-op variant.
    pub wake_hook: Arc<dyn InboxWakeHook>,
}

impl TaskToolsContext {
    pub(crate) fn owner_member_id_catalog(&self) -> String {
        let mut entries = vec![format!(
            "{} — {} ({})",
            COORDINATOR_MEMBER_ID,
            self.org_context.coordinator_name,
            self.org_context.coordinator_role
        )];
        entries.extend(
            self.org_context
                .members
                .iter()
                .map(|member| format!("{} — {} ({})", member.member_id, member.name, member.role)),
        );
        entries.join("; ")
    }

    pub(crate) fn caller_display_name(&self) -> String {
        self.org_context
            .participant_display_name(&self.caller_member_id)
            .unwrap_or_else(|| self.caller_member_id.clone())
    }

    pub(crate) fn caller_owner_member_id(&self) -> String {
        self.caller_member_id.clone()
    }

    pub(crate) fn resolve_owner_member_id(
        &self,
        raw_owner_member_id: &str,
    ) -> Result<String, String> {
        let owner_member_id = raw_owner_member_id.trim();
        if owner_member_id.is_empty() {
            return Err("owner_member_id must not be empty".to_string());
        }
        if owner_member_id == COORDINATOR_MEMBER_ID {
            return Ok(COORDINATOR_MEMBER_ID.to_string());
        }
        if self
            .org_context
            .members
            .iter()
            .any(|member| member.member_id == owner_member_id)
        {
            return Ok(owner_member_id.to_string());
        }

        let known = self
            .org_context
            .members
            .iter()
            .map(|member| member.member_id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!(
            "owner_member_id '{owner_member_id}' is not valid for this Agent Org run; use one of: [{}, {}]",
            COORDINATOR_MEMBER_ID, known
        ))
    }

    fn recipient_agent_id_for_owner_member_id(
        &self,
        owner_member_id: &str,
    ) -> Result<String, String> {
        self.org_context
            .require_participant_agent_id(owner_member_id)
    }

    pub(crate) fn dispatch_task_assigned(&self, task: &Task) -> bool {
        let display = self.caller_display_name();
        let caller_owner_member_id = self.caller_owner_member_id();
        let sender_agent_id = if task.owner.as_deref() == Some(caller_owner_member_id.as_str()) {
            SYSTEM_SENDER_ID.to_string()
        } else {
            self.caller_agent_id.clone()
        };
        let sender_member_id = if sender_agent_id == SYSTEM_SENDER_ID {
            None
        } else {
            Some(caller_owner_member_id.as_str())
        };
        if let Some(owner_member_id) = task.owner.as_deref() {
            let recipient_agent_id =
                match self.recipient_agent_id_for_owner_member_id(owner_member_id) {
                    Ok(agent_id) => agent_id,
                    Err(err) => {
                        tracing::warn!(
                            target = "agent_org_tasks",
                            owner_member_id = %owner_member_id,
                            task_id = %task.id,
                            error = %err,
                            "failed to resolve TaskAssigned recipient",
                        );
                        return false;
                    }
                };
            match agent_org_tasks::enqueue_task_assigned_to(
                task,
                &recipient_agent_id,
                owner_member_id,
                &sender_agent_id,
                sender_member_id,
                &display,
            ) {
                Ok(_) => {
                    self.wake_hook
                        .wake_member(owner_member_id, &self.org_context.run_id);
                    true
                }
                Err(err) => {
                    tracing::warn!(
                        target = "agent_org_tasks",
                        owner_member_id = %owner_member_id,
                        task_id = %task.id,
                        error = %err,
                        "failed to enqueue TaskAssigned inbox row",
                    );
                    false
                }
            }
        } else {
            false
        }
    }

    pub(crate) fn dispatch_ready_assigned_tasks_unblocked_by(
        &self,
        blocker_task_id: &str,
    ) -> Vec<String> {
        let tasks = match AgentOrgTaskStore::list(&self.org_context.run_id) {
            Ok(tasks) => tasks,
            Err(err) => {
                tracing::warn!(
                    target = "agent_org_tasks",
                    run_id = %self.org_context.run_id,
                    error = %err,
                    "failed to list tasks after dependency completion",
                );
                return Vec::new();
            }
        };
        let mut dispatched = Vec::new();
        for task in &tasks {
            if task.status != TaskStatus::Pending || task.owner.is_none() {
                continue;
            }
            if !task.blocked_by.iter().any(|id| id == blocker_task_id) {
                continue;
            }
            if !task_dependencies_resolved(&tasks, task) {
                continue;
            }
            if self.dispatch_task_assigned(task) {
                dispatched.push(task.id.clone());
            }
        }
        dispatched
    }
}

pub(crate) fn task_dependencies_resolved(all_tasks: &[Task], task: &Task) -> bool {
    task.blocked_by.iter().all(|blocker_id| {
        all_tasks
            .iter()
            .find(|candidate| &candidate.id == blocker_id)
            .is_some_and(|candidate| candidate.status.is_resolved())
    })
}

pub(crate) fn parse_status(value: &str) -> Result<TaskStatus, String> {
    TaskStatus::from_wire(value).map_err(|err| {
        format!("invalid status: {err} (expected: pending | in_progress | completed)")
    })
}

pub(crate) fn map_task_write_error(err: String) -> ToolError {
    if err.starts_with(TASK_DEPENDENCY_CYCLE_ERROR) {
        ToolError::InvalidParams(err)
    } else {
        ToolError::ExecutionFailed(err)
    }
}

pub(crate) fn task_to_json(task: &Task) -> Value {
    json!({
        "id": task.id,
        "subject": task.subject,
        "description": task.description,
        "active_form": task.active_form,
        "owner": task.owner,
        "owner_member_id": task.owner,
        "status": task.status.as_wire(),
        "blocks": task.blocks,
        "blocked_by": task.blocked_by,
        "metadata": task.metadata,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    })
}
