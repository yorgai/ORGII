use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::coordination::agent_org_tasks::{
    self, AgentOrgTaskStore, CreateTaskParams, TaskStatus,
};
use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, CallContext, Tool, ToolError};

use super::{
    map_task_write_error, parse_status, task_dependencies_resolved, task_to_json, TaskToolsContext,
};

/// Params for `task_create`. `id` is optional — the store mints a
/// UUID if absent so the LLM does not have to.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskCreateParams {
    /// Optional caller-supplied UUID. Defaults to a freshly minted v4
    /// UUID. Use only when porting an external task or stamping a
    /// deterministic id in tests.
    #[serde(default)]
    pub id: Option<String>,
    /// One-line task title. Required, non-empty.
    pub subject: String,
    /// Optional long-form description. Defaults to empty string.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional present-progressive form ("Refactoring auth layer")
    /// shown by the UI while the task is in_progress.
    #[serde(default)]
    pub active_form: Option<String>,
    /// Optional initial owner member_id. Use `coordinator` for the coordinator
    /// or an exact roster member_id. When set, `task_create` posts a
    /// `TaskAssigned` row to the new owner's inbox if the task is pending.
    #[serde(default)]
    pub owner_member_id: Option<String>,
    /// Optional initial status. Defaults to `pending`. Setting `in_progress`
    /// requires `owner_member_id`; task ownership is never inferred.
    #[serde(default)]
    pub status: Option<String>,
    /// Tasks this one blocks (downstream).
    #[serde(default)]
    pub blocks: Vec<String>,
    /// Tasks this one is blocked by (upstream prerequisites).
    #[serde(default)]
    pub blocked_by: Vec<String>,
    /// Free-form metadata bag. Stored verbatim.
    #[serde(default)]
    pub metadata: Option<Value>,
}

pub struct TaskCreateTool {
    ctx: Arc<TaskToolsContext>,
}

impl TaskCreateTool {
    pub fn new(ctx: Arc<TaskToolsContext>) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Tool for TaskCreateTool {
    fn name(&self) -> &str {
        tool_names::TASK_CREATE
    }

    fn description(&self) -> &str {
        concat!(
            "Create a task on the org run's task board. The board is shared by every ",
            "agent in this Agent Org run (coordinator + members), so any agent can ",
            "post tasks for any other member or for themselves. ",
            "Set `owner_member_id` to `coordinator` or an exact roster member_id to assign ",
            "the task on creation — a pending assignee will receive a `task_assigned` inbox ",
            "row on their next turn. Leave `owner_member_id` unset to put the task into ",
            "the unclaimed pool. `status` defaults to `pending`; `in_progress` requires ",
            "`owner_member_id` to equal the calling session's member_id."
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
        params_schema::<TaskCreateParams>()
    }

    async fn execute_text(&self, params_value: Value, _ctx: &CallContext) -> Result<String, ToolError> {
        let params: TaskCreateParams = parse_params(params_value)?;
        if params.subject.trim().is_empty() {
            return Err(ToolError::InvalidParams(
                "task_create requires a non-empty `subject`".into(),
            ));
        }
        let resolved_owner = match params.owner_member_id.as_deref() {
            Some(owner_member_id) => Some(
                self.ctx
                    .resolve_owner_member_id(owner_member_id)
                    .map_err(ToolError::InvalidParams)?,
            ),
            None => None,
        };
        let status = match params.status.as_deref() {
            None => TaskStatus::Pending,
            Some(value) => parse_status(value).map_err(ToolError::InvalidParams)?,
        };
        if status == TaskStatus::InProgress {
            let caller_member_id = self.ctx.caller_owner_member_id();
            match resolved_owner.as_deref() {
                Some(owner_member_id) if owner_member_id == caller_member_id => {}
                Some(owner_member_id) => {
                    return Err(ToolError::InvalidParams(format!(
                        "task_create status=in_progress can only be set by the owning member; caller_member_id={caller_member_id}, owner_member_id={owner_member_id}"
                    )));
                }
                None => {
                    return Err(ToolError::InvalidParams(
                        "task_create status=in_progress requires owner_member_id to equal the calling session's member_id".to_string(),
                    ));
                }
            }
        }
        let explicit_id = params
            .id
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty());
        let id = params
            .id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(agent_org_tasks::new_task_id);
        if explicit_id {
            if let Some(existing) = AgentOrgTaskStore::get(&self.ctx.org_context.run_id, &id)
                .map_err(map_task_write_error)?
            {
                let body = json!({
                    "task": task_to_json(&existing),
                    "already_exists": true,
                    "guidance": "Task id already exists in this run; use task_update for changes instead of creating a duplicate.",
                    "task_assigned_dispatched": false,
                });
                return serde_json::to_string(&body).map_err(|err| {
                    ToolError::ExecutionFailed(format!(
                        "task_create: failed to serialize result: {err}"
                    ))
                });
            }
        }

        let task = AgentOrgTaskStore::create(CreateTaskParams {
            id,
            org_run_id: self.ctx.org_context.run_id.clone(),
            subject: params.subject,
            description: params.description.unwrap_or_default(),
            active_form: params.active_form,
            owner: resolved_owner,
            status,
            blocks: params.blocks,
            blocked_by: params.blocked_by,
            metadata: params.metadata,
        })
        .map_err(map_task_write_error)?;

        let task_assigned_dispatched = task.owner.is_some()
            && task.status == TaskStatus::Pending
            && task_dependencies_resolved(
                &AgentOrgTaskStore::list(&self.ctx.org_context.run_id)
                    .map_err(ToolError::ExecutionFailed)?,
                &task,
            )
            && self.ctx.dispatch_task_assigned(&task);

        let body = json!({
            "task": task_to_json(&task),
            "already_exists": false,
            "task_assigned_dispatched": task_assigned_dispatched,
        });
        serde_json::to_string(&body).map_err(|err| {
            ToolError::ExecutionFailed(format!("task_create: failed to serialize result: {err}"))
        })
    }

    fn is_read_only(&self) -> bool {
        false
    }
}
