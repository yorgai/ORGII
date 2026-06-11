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
//! - `task_update` with `status=\"deleted\"` deletes the row instead of
//!   updating it. `deleted` is not a stored status — it is a sentinel
//!   value that means "remove this row from the board" so the LLM
//!   does not need a separate `task_delete` tool.

use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::coordination::agent_inbox::SYSTEM_SENDER_ID;
use crate::coordination::agent_org_runs::{AgentOrgRunContext, COORDINATOR_MEMBER_ID};
use crate::coordination::agent_org_tasks::{
    self, AgentOrgTaskStore, ClaimError, CreateTaskParams, Task, TaskStatus, UpdateTaskPatch,
    TASK_DEPENDENCY_CYCLE_ERROR,
};
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;
use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError};

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
    fn owner_member_id_catalog(&self) -> String {
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

    fn caller_display_name(&self) -> String {
        self.org_context
            .participant_display_name(&self.caller_member_id)
            .unwrap_or_else(|| self.caller_member_id.clone())
    }

    fn caller_owner_member_id(&self) -> String {
        self.caller_member_id.clone()
    }

    fn resolve_owner_member_id(&self, raw_owner_member_id: &str) -> Result<String, String> {
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

    fn dispatch_task_assigned(&self, task: &Task) -> bool {
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

    fn dispatch_ready_assigned_tasks_unblocked_by(&self, blocker_task_id: &str) -> Vec<String> {
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

fn task_dependencies_resolved(all_tasks: &[Task], task: &Task) -> bool {
    task.blocked_by.iter().all(|blocker_id| {
        all_tasks
            .iter()
            .find(|candidate| &candidate.id == blocker_id)
            .is_some_and(|candidate| candidate.status.is_resolved())
    })
}

fn parse_status(value: &str) -> Result<TaskStatus, String> {
    TaskStatus::from_wire(value).map_err(|err| {
        format!("invalid status: {err} (expected: pending | in_progress | completed)")
    })
}

fn map_task_write_error(err: String) -> ToolError {
    if err.starts_with(TASK_DEPENDENCY_CYCLE_ERROR) {
        ToolError::InvalidParams(err)
    } else {
        ToolError::ExecutionFailed(err)
    }
}

fn task_to_json(task: &Task) -> Value {
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

// ─────────────────────────────────────────────────────────────────────
// task_create
// ─────────────────────────────────────────────────────────────────────

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

    async fn execute_text(
        &self,
        params_value: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
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

// ─────────────────────────────────────────────────────────────────────
// task_update
// ─────────────────────────────────────────────────────────────────────

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
        _ctx: &crate::tools::traits::CallContext,
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

// ─────────────────────────────────────────────────────────────────────
// task_list
// ─────────────────────────────────────────────────────────────────────

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
        _ctx: &crate::tools::traits::CallContext,
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

// ─────────────────────────────────────────────────────────────────────
// task_get
// ─────────────────────────────────────────────────────────────────────

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
        _ctx: &crate::tools::traits::CallContext,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordination::agent_inbox::{AgentInboxStore, AgentMessage};
    use crate::coordination::agent_org_runs::AgentOrgContextMember;
    use crate::tools::impls::orchestration::org_send_message::NoopInboxWakeHook;
    use test_helpers::test_env;

    fn org_context() -> Arc<AgentOrgRunContext> {
        Arc::new(AgentOrgRunContext {
            run_id: "run-tools-1".into(),
            org_id: "org-tools-1".into(),
            org_name: "Tools Org".into(),
            org_role: "lead engineer".into(),
            coordinator_agent_id: "coord-1".into(),
            coordinator_name: "Coordinator".into(),
            coordinator_role: "lead engineer".into(),
            members: vec![
                AgentOrgContextMember {
                    member_id: "m-alice".into(),
                    name: "Alice".into(),
                    role: "engineer".into(),
                    agent_id: "alice-1".into(),
                    parent_member_id: None,
                },
                AgentOrgContextMember {
                    member_id: "m-bob".into(),
                    name: "Bob".into(),
                    role: "engineer".into(),
                    agent_id: "bob-1".into(),
                    parent_member_id: None,
                },
            ],
            hierarchy_mode: Default::default(),
            root_session_id: Some("root-tools-1".into()),
        })
    }

    fn ctx(caller_member_id: &str) -> Arc<TaskToolsContext> {
        let org_context = org_context();
        let caller_agent_id = org_context
            .require_participant_agent_id(caller_member_id)
            .expect("test caller member id resolves");
        Arc::new(TaskToolsContext {
            org_context,
            caller_agent_id,
            caller_member_id: caller_member_id.to_string(),
            wake_hook: Arc::new(NoopInboxWakeHook),
        })
    }

    fn shared_sde_ctx(caller_member_id: Option<&str>) -> Arc<TaskToolsContext> {
        Arc::new(TaskToolsContext {
            org_context: Arc::new(AgentOrgRunContext {
                run_id: "run-shared-sde".into(),
                org_id: "org-shared-sde".into(),
                org_name: "Default Agent Org".into(),
                org_role: "Coordinator".into(),
                coordinator_agent_id: "builtin:sde".into(),
                coordinator_name: "Coordinator".into(),
                coordinator_role: "Coordinator".into(),
                members: vec![AgentOrgContextMember {
                    member_id: "sde-planner".into(),
                    name: "Planner".into(),
                    role: "Plans".into(),
                    agent_id: "builtin:sde".into(),
                    parent_member_id: None,
                }],
                hierarchy_mode: Default::default(),
                root_session_id: Some("root-shared-sde".into()),
            }),
            caller_agent_id: "builtin:sde".into(),
            caller_member_id: caller_member_id
                .unwrap_or(COORDINATOR_MEMBER_ID)
                .to_string(),
            wake_hook: Arc::new(NoopInboxWakeHook),
        })
    }

    fn task_tools_sandbox() -> test_env::SandboxGuard {
        let sandbox = test_env::sandbox();
        let conn = database::db::get_connection().expect("test sqlite connection");
        crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
        crate::coordination::agent_org_tasks::init_schema(&conn).expect("agent team tasks schema");
        sandbox
    }

    #[tokio::test]
    async fn task_create_unassigned_does_not_dispatch_inbox() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let tool = TaskCreateTool::new(Arc::clone(&ctx));
        let res = tool
            .execute_text(json!({ "subject": "S1" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("task_create succeeds");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(!value["task_assigned_dispatched"].as_bool().unwrap());
        let task_id = value["task"]["id"].as_str().unwrap().to_string();
        let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        assert!(inbox.is_empty());
        let stored = AgentOrgTaskStore::get("run-tools-1", &task_id)
            .unwrap()
            .unwrap();
        assert!(stored.owner.is_none());
    }

    #[tokio::test]
    async fn task_create_with_owner_dispatches_inbox() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let tool = TaskCreateTool::new(Arc::clone(&ctx));
        let res = tool
            .execute_text(json!({
                "subject": "S2",
                "owner_member_id": "m-alice",
                "description": "do the thing",
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("task_create succeeds");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(value["task_assigned_dispatched"].as_bool().unwrap());

        let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        assert_eq!(inbox.len(), 1);
        let payload: AgentMessage = serde_json::from_str(&inbox[0].payload_json).unwrap();
        match &payload {
            AgentMessage::TaskAssigned {
                subject,
                assigned_by,
                ..
            } => {
                assert_eq!(subject, "S2");
                assert_eq!(assigned_by, "Coordinator");
            }
            other => panic!("expected TaskAssigned, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_create_duplicate_explicit_id_returns_existing_without_dispatch() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let tool = TaskCreateTool::new(Arc::clone(&ctx));
        let first = tool
            .execute_text(json!({
                "id": "stable-task-id",
                "subject": "Original subject",
                "owner_member_id": "m-alice",
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("first task_create succeeds");
        let first_value: Value = serde_json::from_str(&first).unwrap();
        assert!(!first_value["already_exists"].as_bool().unwrap());
        assert!(first_value["task_assigned_dispatched"].as_bool().unwrap());

        let second = tool
            .execute_text(json!({
                "id": "stable-task-id",
                "subject": "Retry subject should not replace original",
                "owner_member_id": "m-bob",
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("duplicate task_create returns existing task");
        let second_value: Value = serde_json::from_str(&second).unwrap();
        assert!(second_value["already_exists"].as_bool().unwrap());
        assert!(!second_value["task_assigned_dispatched"].as_bool().unwrap());
        assert_eq!(
            second_value["task"]["subject"].as_str().unwrap(),
            "Original subject"
        );
        assert_eq!(second_value["task"]["owner"].as_str().unwrap(), "m-alice");

        let alice_inbox =
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        let bob_inbox = AgentInboxStore::list_unread_for_member("m-bob", "run-tools-1").unwrap();
        assert_eq!(alice_inbox.len(), 1);
        assert!(bob_inbox.is_empty());
    }

    #[tokio::test]
    async fn task_create_coordinator_in_progress_requires_explicit_owner_member_id() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let err = tool
            .execute_text(json!({
                "subject": "Coordinator started work",
                "status": "in_progress"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("ownerless in_progress task_create is invalid");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_create_coordinator_can_start_explicit_coordinator_work() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let res = tool
            .execute_text(json!({
                "subject": "Coordinator explicit work",
                "status": "in_progress",
                "owner_member_id": "coordinator"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("coordinator can explicitly own in-progress work");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
    }

    #[tokio::test]
    async fn task_create_coordinator_can_assign_member_pending_work() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let res = tool
            .execute_text(json!({
                "subject": "Coordinator assigned member work",
                "status": "pending",
                "owner_member_id": "m-alice"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("task_create assigns pending member work");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "pending");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
        assert!(value["task_assigned_dispatched"].as_bool().unwrap());
        let inbox = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        assert_eq!(inbox.len(), 1);
    }

    #[tokio::test]
    async fn task_create_member_in_progress_requires_explicit_owner_member_id() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx("m-alice"));
        let err = tool
            .execute_text(json!({
                "subject": "Alice started work",
                "status": "in_progress"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("ownerless in_progress task_create is invalid");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_create_coordinator_cannot_start_member_work_in_progress() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let err = tool
            .execute_text(json!({
                "subject": "Coordinator attempted member start",
                "status": "in_progress",
                "owner_member_id": "m-alice"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("coordinator cannot start another member's work");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_create_member_cannot_start_other_member_work_in_progress() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx("m-alice"));
        let err = tool
            .execute_text(json!({
                "subject": "Alice attempted Bob start",
                "status": "in_progress",
                "owner_member_id": "m-bob"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("member cannot start another member's work");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_create_member_can_start_self_work_in_progress() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx("m-alice"));
        let res = tool
            .execute_text(json!({
                "subject": "Alice started self work",
                "status": "in_progress",
                "owner_member_id": "m-alice"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("member can start self-owned work");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
    }

    #[tokio::test]
    async fn task_create_shared_agent_coordinator_member_id_explicitly_self_claims() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(shared_sde_ctx(Some(COORDINATOR_MEMBER_ID)));
        let res = tool
            .execute_text(json!({
                "subject": "Shared SDE coordinator explicit start",
                "status": "in_progress",
                "owner_member_id": "coordinator"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("shared-agent coordinator task_create uses member_id only");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
    }

    #[tokio::test]
    async fn task_create_rejects_unknown_owner() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let err = tool
            .execute_text(json!({ "subject": "S3", "owner_member_id": "ghost" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("must reject unknown owner");
        assert!(matches!(err, ToolError::InvalidParams(_)));
    }

    #[tokio::test]
    async fn task_create_rejects_dependency_cycle_as_invalid_params() {
        let _sandbox = task_tools_sandbox();
        let tool = TaskCreateTool::new(ctx(COORDINATOR_MEMBER_ID));
        let err = tool
            .execute_text(json!({
                "id": "cycle-self",
                "subject": "S3-cycle",
                "blocked_by": ["cycle-self"]
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("must reject task dependency cycle");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains(TASK_DEPENDENCY_CYCLE_ERROR)),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_update_rejects_dependency_cycle_as_invalid_params() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({
                "id": "first-cycle",
                "subject": "First",
                "blocks": ["second-cycle"]
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        create
            .execute_text(json!({ "id": "second-cycle", "subject": "Second" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let err = update
            .execute_text(json!({ "id": "second-cycle", "blocks": ["first-cycle"] }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("must reject task dependency cycle");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains(TASK_DEPENDENCY_CYCLE_ERROR)),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_update_in_progress_without_owner_returns_invalid_params() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({ "id": "coord-start", "subject": "Coordinator start" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let err = update
            .execute_text(json!({ "id": "coord-start", "status": "in_progress" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("ownerless in_progress task_update is invalid");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owner_member_id")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_update_coordinator_can_start_explicit_coordinator_task() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({
                "id": "coordinator-owned-start",
                "subject": "Coordinator owned start",
                "owner_member_id": "coordinator"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let res = update
            .execute_text(json!({ "id": "coordinator-owned-start", "status": "in_progress" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("coordinator starts explicitly owned task");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "coordinator");
    }

    #[tokio::test]
    async fn task_update_coordinator_cannot_start_member_task_in_progress() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({
                "id": "member-owned-start-attempt",
                "subject": "Member owned start attempt",
                "owner_member_id": "m-alice"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let err = update
            .execute_text(json!({ "id": "member-owned-start-attempt", "status": "in_progress" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("coordinator cannot start member-owned task");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_update_member_cannot_start_other_member_task_in_progress() {
        let _sandbox = task_tools_sandbox();
        let coord = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&coord));
        create
            .execute_text(json!({
                "id": "bob-owned-start-attempt",
                "subject": "Bob owned start attempt",
                "owner_member_id": "m-bob"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let alice = ctx("m-alice");
        let update = TaskUpdateTool::new(Arc::clone(&alice));
        let err = update
            .execute_text(json!({ "id": "bob-owned-start-attempt", "status": "in_progress" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect_err("member cannot start another member's task");
        match err {
            ToolError::InvalidParams(msg) => assert!(msg.contains("owning member")),
            other => panic!("expected InvalidParams, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn task_update_shared_agent_member_can_start_own_task() {
        let _sandbox = task_tools_sandbox();
        let coord = shared_sde_ctx(None);
        let create = TaskCreateTool::new(Arc::clone(&coord));
        create
            .execute_text(json!({
                "id": "shared-member-owned-start",
                "subject": "Shared member owned start",
                "owner_member_id": "sde-planner"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let planner = shared_sde_ctx(Some("sde-planner"));
        let update = TaskUpdateTool::new(Arc::clone(&planner));
        let res = update
            .execute_text(json!({ "id": "shared-member-owned-start", "status": "in_progress" }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("shared-agent member starts own task");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "sde-planner");
    }

    #[tokio::test]
    async fn task_update_member_can_start_with_explicit_owner_member_id() {
        let _sandbox = task_tools_sandbox();
        let coord = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&coord));
        create
            .execute_text(json!({ "id": "alice-start", "subject": "Alice start" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();

        let alice = ctx("m-alice");
        let update = TaskUpdateTool::new(Arc::clone(&alice));
        let res = update
            .execute_text(json!({
                "id": "alice-start",
                "owner_member_id": "m-alice",
                "status": "in_progress"
            }), &crate::tools::call_context::CallContext::default())
            .await
            .expect("member task_update starts explicit member-owned task");
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["status"].as_str().unwrap(), "in_progress");
        assert_eq!(value["task"]["owner"].as_str().unwrap(), "m-alice");
    }

    #[tokio::test]
    async fn task_update_reassign_dispatches_inbox() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        let res = create
            .execute_text(json!({ "subject": "S4", "owner_member_id": "m-alice" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let res = update
            .execute_text(json!({ "id": task_id, "owner_member_id": "m-bob" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(value["owner_changed"].as_bool().unwrap());
        assert!(value["task_assigned_dispatched"].as_bool().unwrap());
        let bob_inbox = AgentInboxStore::list_unread_for_member("m-bob", "run-tools-1").unwrap();
        assert_eq!(bob_inbox.len(), 1);
    }

    #[tokio::test]
    async fn task_create_blocked_assigned_task_does_not_dispatch_until_unblocked() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({ "id": "blocker-task", "subject": "Blocker" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let blocked = create
            .execute_text(json!({
                "id": "blocked-task",
                "subject": "Blocked work",
                "owner_member_id": "m-alice",
                "blocked_by": ["blocker-task"]
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let blocked_value: Value = serde_json::from_str(&blocked).unwrap();
        assert!(!blocked_value["task_assigned_dispatched"].as_bool().unwrap());
        let alice_before =
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        assert!(alice_before.is_empty());

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let completed = update
            .execute_text(json!({ "id": "blocker-task", "status": "completed" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let completed_value: Value = serde_json::from_str(&completed).unwrap();
        assert_eq!(
            completed_value["unblocked_task_assigned_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["blocked-task"]
        );
        let alice_after =
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1").unwrap();
        assert_eq!(alice_after.len(), 1);
    }

    #[tokio::test]
    async fn task_update_clearing_blockers_on_assigned_pending_dispatches_once() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        create
            .execute_text(json!({ "id": "manual-blocker", "subject": "Manual blocker" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        create
            .execute_text(json!({
                "id": "manually-unblocked",
                "subject": "Manual unblock",
                "owner_member_id": "m-alice",
                "blocked_by": ["manual-blocker"]
            }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        assert!(
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
                .unwrap()
                .is_empty()
        );

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let res = update
            .execute_text(json!({ "id": "manually-unblocked", "blocked_by": [] }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(value["task_assigned_dispatched"].as_bool().unwrap());
        assert_eq!(
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
                .unwrap()
                .len(),
            1
        );

        let repeat = update
            .execute_text(json!({ "id": "manually-unblocked", "description": "metadata update" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let repeat_value: Value = serde_json::from_str(&repeat).unwrap();
        assert!(!repeat_value["task_assigned_dispatched"].as_bool().unwrap());
        assert_eq!(
            AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn task_update_unassign_does_not_dispatch_inbox() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        let res = create
            .execute_text(json!({ "subject": "S5", "owner_member_id": "m-alice" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let before = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
            .unwrap()
            .len();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let res = update
            .execute_text(json!({ "id": task_id, "owner_member_id": null }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(value["owner_changed"].as_bool().unwrap());
        assert!(!value["task_assigned_dispatched"].as_bool().unwrap());
        let after = AgentInboxStore::list_unread_for_member("m-alice", "run-tools-1")
            .unwrap()
            .len();
        assert_eq!(before, after);
    }

    #[tokio::test]
    async fn task_update_status_deleted_removes_row() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        let res = create
            .execute_text(json!({ "subject": "S6" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string();

        let update = TaskUpdateTool::new(Arc::clone(&ctx));
        let res = update
            .execute_text(json!({ "id": task_id, "status": "deleted" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert!(value["deleted"].as_bool().unwrap());
        assert!(AgentOrgTaskStore::get("run-tools-1", &task_id)
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn task_list_filters_by_owner_and_mine() {
        let _sandbox = task_tools_sandbox();
        let coord = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&coord));
        for (subject, owner) in [("L1", Some("m-alice")), ("L2", Some("m-bob")), ("L3", None)] {
            let mut req = json!({ "subject": subject });
            if let Some(o) = owner {
                req["owner_member_id"] = json!(o);
            }
            create.execute_text(req, &crate::tools::call_context::CallContext::default()).await.unwrap();
        }
        let coord_list = TaskListTool::new(Arc::clone(&coord));
        let res = coord_list.execute_text(json!({}), &crate::tools::call_context::CallContext::default()).await.unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["total"].as_u64().unwrap(), 3);
        let res = coord_list
            .execute_text(json!({ "owner_member_id": "m-alice" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["total"].as_u64().unwrap(), 1);
        // Alice only sees her tasks via mine_only.
        let alice = ctx("m-alice");
        let alice_list = TaskListTool::new(alice);
        let res = alice_list
            .execute_text(json!({ "mine_only": true }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["total"].as_u64().unwrap(), 1);
    }

    #[tokio::test]
    async fn task_get_returns_full_row() {
        let _sandbox = task_tools_sandbox();
        let ctx = ctx(COORDINATOR_MEMBER_ID);
        let create = TaskCreateTool::new(Arc::clone(&ctx));
        let res = create
            .execute_text(json!({ "subject": "G1", "description": "details" }), &crate::tools::call_context::CallContext::default())
            .await
            .unwrap();
        let task_id = serde_json::from_str::<Value>(&res).unwrap()["task"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let get = TaskGetTool::new(Arc::clone(&ctx));
        let res = get.execute_text(json!({ "id": task_id }), &crate::tools::call_context::CallContext::default()).await.unwrap();
        let value: Value = serde_json::from_str(&res).unwrap();
        assert_eq!(value["task"]["subject"], "G1");
        assert_eq!(value["task"]["description"], "details");
    }
}
