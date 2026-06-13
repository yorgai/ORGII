use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::coordination::agent_org_tasks::{AgentOrgTaskStore, ClaimError, Task};
use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, CallContext, Tool, ToolError};

use super::{parse_status, task_to_json, TaskToolsContext};

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskListParams {
    /// When `true`, only include tasks owned by the calling org member.
    /// Defaults to `false` (every task in the run).
    #[serde(default)]
    pub mine_only: bool,
    /// When set, only include tasks in this status.
    #[serde(default)]
    pub status: Option<String>,
    /// When set, only include tasks owned by this exact member_id.
    #[serde(default)]
    pub owner_member_id: Option<String>,
}

pub struct TaskListTool {
    ctx: Arc<TaskToolsContext>,
}

impl TaskListTool {
    pub fn new(ctx: Arc<TaskToolsContext>) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Tool for TaskListTool {
    fn name(&self) -> &str {
        tool_names::TASK_LIST
    }

    fn description(&self) -> &str {
        concat!(
            "List tasks on the org run's task board. Returns the array in insertion ",
            "order (`created_at` ascending). ",
            "Filter with `mine_only=true` to see only the tasks you own, `status` to ",
            "narrow by `pending` / `in_progress` / `completed`, or `owner_member_id` ",
            "to query a sibling's queue. Combining filters AND-merges them. Read-only."
        )
    }

    fn category(&self) -> &str {
        crate::tools::categories::ORCHESTRATION
    }

    fn llm_description(&self) -> Option<String> {
        Some(format!(
            "{}\n\nAllowed owner_member_id filter values for this Agent Org run: {}\nUse only `owner_member_id`; do not pass agent_id or display name as ownership.",
            self.description(),
            self.ctx.owner_member_id_catalog()
        ))
    }

    fn parameters(&self) -> Value {
        params_schema::<TaskListParams>()
    }

    async fn execute_text(
        &self,
        params_value: Value,
        _ctx: &CallContext,
    ) -> Result<String, ToolError> {
        let params: TaskListParams = parse_params(params_value)?;
        let status_filter = match params.status.as_deref() {
            None => None,
            Some(value) => Some(parse_status(value).map_err(ToolError::InvalidParams)?),
        };
        let owner_filter: Option<String> = if params.mine_only {
            Some(self.ctx.caller_owner_member_id())
        } else {
            match params
                .owner_member_id
                .as_deref()
                .filter(|owner_member_id| !owner_member_id.trim().is_empty())
            {
                Some(owner_member_id) => Some(
                    self.ctx
                        .resolve_owner_member_id(owner_member_id)
                        .map_err(ToolError::InvalidParams)?,
                ),
                None => None,
            }
        };

        let tasks = AgentOrgTaskStore::list(&self.ctx.org_context.run_id)
            .map_err(ToolError::ExecutionFailed)?;
        let mut filtered: Vec<&Task> = Vec::with_capacity(tasks.len());
        for task in &tasks {
            if let Some(status) = status_filter {
                if task.status != status {
                    continue;
                }
            }
            if let Some(owner) = owner_filter.as_deref() {
                if task.owner.as_deref() != Some(owner) {
                    continue;
                }
            }
            filtered.push(task);
        }
        let body = json!({
            "tasks": filtered.iter().map(|t| task_to_json(t)).collect::<Vec<_>>(),
            "total": filtered.len(),
            "org_run_id": self.ctx.org_context.run_id,
        });
        serde_json::to_string(&body).map_err(|err| {
            ToolError::ExecutionFailed(format!("task_list: failed to serialize result: {err}"))
        })
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TaskGetParams {
    /// Task UUID to fetch.
    pub id: String,
}

pub struct TaskGetTool {
    ctx: Arc<TaskToolsContext>,
}

impl TaskGetTool {
    pub fn new(ctx: Arc<TaskToolsContext>) -> Self {
        Self { ctx }
    }
}

#[async_trait]
impl Tool for TaskGetTool {
    fn name(&self) -> &str {
        tool_names::TASK_GET
    }

    fn description(&self) -> &str {
        concat!(
            "Fetch one task by UUID. Returns the full row (subject, description, ",
            "active_form, owner, status, blocks, blocked_by, metadata, timestamps). ",
            "Read-only. Errors if the task does not exist in the current org run."
        )
    }

    fn category(&self) -> &str {
        crate::tools::categories::ORCHESTRATION
    }

    fn parameters(&self) -> Value {
        params_schema::<TaskGetParams>()
    }

    async fn execute_text(
        &self,
        params_value: Value,
        _ctx: &CallContext,
    ) -> Result<String, ToolError> {
        let params: TaskGetParams = parse_params(params_value)?;
        let task_id = params.id.trim().to_string();
        if task_id.is_empty() {
            return Err(ToolError::InvalidParams(
                "task_get requires a non-empty `id`".into(),
            ));
        }
        let task = AgentOrgTaskStore::get(&self.ctx.org_context.run_id, &task_id)
            .map_err(ToolError::ExecutionFailed)?
            .ok_or_else(|| {
                ToolError::ExecutionFailed(format!(
                    "task_get: task '{task_id}' not found in run '{}'",
                    self.ctx.org_context.run_id
                ))
            })?;
        let body = json!({ "task": task_to_json(&task) });
        serde_json::to_string(&body).map_err(|err| {
            ToolError::ExecutionFailed(format!("task_get: failed to serialize result: {err}"))
        })
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

/// Surface ClaimError as a stable string for the autonomous claim
/// path. Kept here so the tool layer owns the user-facing rendering.
pub fn claim_error_message(error: &ClaimError) -> String {
    match error {
        ClaimError::TaskNotFound => "task_not_found".into(),
        ClaimError::AlreadyClaimed { current_owner } => {
            format!("already_claimed by {current_owner}")
        }
        ClaimError::AlreadyResolved { status } => {
            format!("already_resolved (status={})", status.as_wire())
        }
        ClaimError::Blocked { by_task_ids } => {
            format!("blocked by [{}]", by_task_ids.join(","))
        }
        ClaimError::MemberBusy { busy_with } => {
            format!("member_busy (current_task={busy_with})")
        }
        ClaimError::Storage(msg) => format!("storage_error: {msg}"),
    }
}
