use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::coordination::agent_org_tasks::{AgentOrgTaskStore, TaskStatus, UpdateTaskPatch};
use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, CallContext, Tool, ToolError};

use super::{
    map_task_write_error, parse_status, task_dependencies_resolved, task_to_json, TaskToolsContext,
};

/// Params for `task_update`. Every mutable field is optional; only
/// fields explicitly set on the request are written. To clear ownership,
/// pass `owner_member_id: null`. Setting `status: "deleted"` deletes the row.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskUpdateParams {
    /// Task UUID to update. Required.
    pub id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub active_form: Option<String>,
    /// New owner member_id. Use `coordinator`, an exact roster member_id,
    /// or explicit null to unassign. Agent IDs and display names are not accepted.
    #[serde(default)]
    pub owner_member_id: Option<Value>,
    /// New status. One of: `pending`, `in_progress`, `completed`, or the
    /// special sentinel `deleted` (which removes the row).
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub blocks: Option<Vec<String>>,
    #[serde(default)]
    pub blocked_by: Option<Vec<String>>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

pub struct TaskUpdateTool {
    ctx: Arc<TaskToolsContext>,
}

impl TaskUpdateTool {
    pub fn new(ctx: Arc<TaskToolsContext>) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Tool for TaskUpdateTool {
    fn name(&self) -> &str {
        tool_names::TASK_UPDATE
    }

    fn description(&self) -> &str {
        concat!(
            "Update a task on the org run's task board. Only the fields you set are ",
            "written; missing fields keep their current value. ",
            "Special semantics:\n",
            "  - `owner_member_id=null` unassigns the task (puts it back into the ",
            "    unclaimed pool).\n",
            "  - `owner_member_id=\"coordinator\"` or `owner_member_id=\"<member_id>\"` ",
            "    reassigns the task and posts a `task_assigned` inbox row to a pending ",
            "    member owner. Agent IDs and display names are not accepted.\n",
            "  - `status=\"deleted\"` removes the row from the board (sentinel value — \n",
            "    `deleted` is not stored; the row is deleted instead).\n",
            "Use this tool to reassign work mid-run, mark progress, or retire a task. ",
            "Status `in_progress` is automatically set by the autonomous-claim path; ",
            "the LLM normally only flips between `pending`, `completed`, and `deleted`."
        )
    }

    fn category(&self) -> &str {
        crate::tools::categories::ORCHESTRATION
    }

    fn llm_description(&self) -> Option<String> {
        Some(format!(
            "{}\n\nAllowed owner_member_id values for this Agent Org run: {}\nUse only `owner_member_id`; do not pass agent_id or display name as ownership.",
            self.description(),
            self.ctx.owner_member_id_catalog()
        ))
    }

    fn parameters(&self) -> Value {
        params_schema::<TaskUpdateParams>()
    }

    async fn execute_text(
        &self,
        params_value: Value,
        _ctx: &CallContext,
    ) -> Result<String, ToolError> {
        let owner_member_id_value = params_value.get("owner_member_id").cloned();
        let params: TaskUpdateParams = parse_params(params_value)?;
        let task_id = params.id.trim().to_string();
        if task_id.is_empty() {
            return Err(ToolError::InvalidParams(
                "task_update requires a non-empty `id`".into(),
            ));
        }
        let org_run_id = self.ctx.org_context.run_id.clone();

        // Sentinel: status = "deleted" deletes the row.
        if matches!(params.status.as_deref(), Some("deleted")) {
            let removed = AgentOrgTaskStore::delete(&org_run_id, &task_id)
                .map_err(ToolError::ExecutionFailed)?;
            let body = json!({
                "deleted": removed,
                "id": task_id,
            });
            return serde_json::to_string(&body).map_err(|err| {
                ToolError::ExecutionFailed(format!(
                    "task_update: failed to serialize delete result: {err}"
                ))
            });
        }

        let mut patch = UpdateTaskPatch::default();
        if let Some(subject) = params.subject {
            if subject.trim().is_empty() {
                return Err(ToolError::InvalidParams(
                    "task_update: `subject` cannot be empty".into(),
                ));
            }
            patch.subject = Some(subject);
        }
        if let Some(description) = params.description {
            patch.description = Some(description);
        }
        if let Some(active_form) = params.active_form {
            patch.active_form = Some(if active_form.trim().is_empty() {
                None
            } else {
                Some(active_form)
            });
        }
        if let Some(owner_member_id_value) = owner_member_id_value {
            if owner_member_id_value.is_null() {
                patch.owner = Some(None);
            } else if let Some(owner_member_id) = owner_member_id_value.as_str() {
                let resolved_owner = self
                    .ctx
                    .resolve_owner_member_id(owner_member_id)
                    .map_err(ToolError::InvalidParams)?;
                patch.owner = Some(Some(resolved_owner));
            } else {
                return Err(ToolError::InvalidParams(
                    "task_update: `owner_member_id` must be a string member_id or null".into(),
                ));
            }
        }
        if let Some(status) = params.status.as_deref() {
            patch.status = Some(parse_status(status).map_err(ToolError::InvalidParams)?);
        }
        if let Some(blocks) = params.blocks {
            patch.blocks = Some(blocks);
        }
        if let Some(blocked_by) = params.blocked_by {
            patch.blocked_by = Some(blocked_by);
        }
        if let Some(metadata) = params.metadata {
            patch.metadata = Some(Some(metadata));
        }

        // Capture the prior owner so we know whether to dispatch a
        // TaskAssigned row when the patch resolves to a new owner. We
        // do this before applying so we don't have to re-query after.
        let prior = AgentOrgTaskStore::get(&org_run_id, &task_id)
            .map_err(ToolError::ExecutionFailed)?
            .ok_or_else(|| {
                ToolError::ExecutionFailed(format!(
                    "task_update: task '{task_id}' not found in run '{org_run_id}'"
                ))
            })?;
        let prior_owner = prior.owner.clone();
        let prior_status = prior.status;
        let prior_tasks =
            AgentOrgTaskStore::list(&org_run_id).map_err(ToolError::ExecutionFailed)?;
        let prior_ready = prior.owner.is_some()
            && prior.status == TaskStatus::Pending
            && task_dependencies_resolved(&prior_tasks, &prior);
        if patch.status == Some(TaskStatus::InProgress) {
            let caller_member_id = self.ctx.caller_owner_member_id();
            let target_owner = patch
                .owner
                .as_ref()
                .and_then(|owner| owner.as_ref())
                .or(prior_owner.as_ref());
            match target_owner {
                Some(owner_member_id) if owner_member_id == &caller_member_id => {}
                Some(owner_member_id) => {
                    return Err(ToolError::InvalidParams(format!(
                        "task_update status=in_progress can only be set by the owning member; caller_member_id={caller_member_id}, owner_member_id={owner_member_id}"
                    )));
                }
                None => {
                    return Err(ToolError::InvalidParams(
                        "task_update status=in_progress requires owner_member_id to equal the calling session's member_id".to_string(),
                    ));
                }
            }
        }

        let completed_now =
            patch.status == Some(TaskStatus::Completed) && prior.status != TaskStatus::Completed;
        let updated = AgentOrgTaskStore::update(&org_run_id, &task_id, patch)
            .map_err(map_task_write_error)?;

        let owner_changed = updated.owner != prior_owner;
        let status_changed = updated.status != prior_status;
        let updated_tasks = AgentOrgTaskStore::list(&self.ctx.org_context.run_id)
            .map_err(ToolError::ExecutionFailed)?;
        let updated_ready = updated.owner.is_some()
            && updated.status == TaskStatus::Pending
            && task_dependencies_resolved(&updated_tasks, &updated);
        let task_assigned_dispatched = updated_ready
            && (owner_changed || !prior_ready)
            && self.ctx.dispatch_task_assigned(&updated);
        let unblocked_task_assigned_ids = if completed_now {
            self.ctx
                .dispatch_ready_assigned_tasks_unblocked_by(&updated.id)
        } else {
            Vec::new()
        };

        let body = json!({
            "task": task_to_json(&updated),
            "owner_changed": owner_changed,
            "status_changed": status_changed,
            "task_assigned_dispatched": task_assigned_dispatched,
            "unblocked_task_assigned_ids": unblocked_task_assigned_ids,
        });
        serde_json::to_string(&body).map_err(|err| {
            ToolError::ExecutionFailed(format!("task_update: failed to serialize result: {err}"))
        })
    }

    fn is_read_only(&self) -> bool {
        false
    }
}
