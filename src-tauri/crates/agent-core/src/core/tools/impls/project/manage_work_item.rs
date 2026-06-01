//! Work item tool: manage work items (tasks/issues) via the global project store.
//!
//! Thin wrapper over `tool_infra::project` — the shared implementation
//! used by both this agent tool and Tauri work-item commands.

use async_trait::async_trait;
use serde_json::Value;

use crate::tool_infra::OrchestratorConfigOverrides;
use crate::tools::names as tool_names;
use crate::tools::traits::{optional_bool, optional_string, required_string, Tool, ToolError};
use core_types::workflow::WorkItemSchedule;

/// Work item (task/issue) management tool.
#[derive(Default)]
pub struct WorkItemTool;

impl WorkItemTool {
    pub fn new() -> Self {
        Self
    }

    /// Resolve the `project_slug` parameter to a canonical slug.
    /// Accepts slug, display name, or project ID.
    fn resolve_project_slug(params: &Value) -> Result<String, ToolError> {
        let raw = required_string(params, "project_slug")?;
        crate::tool_infra::resolve_slug(&raw).map_err(ToolError::ExecutionFailed)
    }

    /// Extract an optional array of strings from params.
    fn optional_string_array(params: &Value, key: &str) -> Option<Vec<String>> {
        params.get(key).and_then(|val| {
            val.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str().map(String::from))
                    .collect()
            })
        })
    }

    /// Extract an optional array of todos: `[{"content": "...", "status": "..."}]`
    ///
    /// Each todo is returned as `(content, status)`. Status defaults to "pending".
    fn optional_todos(params: &Value) -> Option<Vec<(String, String)>> {
        params.get("todos").and_then(|val| {
            val.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let content = item.get("content")?.as_str()?.to_string();
                        let status = item
                            .get("status")
                            .and_then(|s| s.as_str())
                            .unwrap_or("pending")
                            .to_string();
                        Some((content, status))
                    })
                    .collect()
            })
        })
    }

    /// Parse an optional `schedule` object from params into `WorkItemSchedule`.
    fn parse_schedule(params: &Value) -> Option<WorkItemSchedule> {
        let obj = params.get("schedule")?;
        if obj.is_null() {
            return None;
        }
        let at = obj.get("at").and_then(|v| v.as_str()).map(String::from);
        let cron = obj.get("cron").and_then(|v| v.as_str()).map(String::from);
        let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        Some(WorkItemSchedule {
            at,
            cron,
            enabled,
            last_run: None,
        })
    }

    /// Build orchestrator config overrides from params if any agent-related fields are set.
    fn orchestrator_overrides_from_params(params: &Value) -> Option<OrchestratorConfigOverrides> {
        let account = optional_string(params, "selected_account_id");
        let model = optional_string(params, "selected_model_id");
        let sub_agents = Self::optional_string_array(params, "sub_agent_ids");
        let org_id = optional_string(params, "org_id");
        let agent_definition_id = optional_string(params, "agent_definition_id");
        let worktree_path = optional_string(params, "worktree_path");
        let review_config = params.get("review_config").and_then(|rc| {
            serde_json::from_value::<core_types::workflow::ReviewConfig>(rc.clone()).ok()
        });
        if account.is_some()
            || model.is_some()
            || sub_agents.as_ref().is_some_and(|v| !v.is_empty())
            || org_id.is_some()
            || agent_definition_id.is_some()
            || worktree_path.is_some()
            || review_config.is_some()
        {
            Some(OrchestratorConfigOverrides {
                selected_account_id: account,
                selected_model_id: model,
                sub_agent_ids: sub_agents.unwrap_or_default(),
                org_id,
                agent_definition_id,
                worktree_path,
                review_config,
            })
        } else {
            None
        }
    }
}

#[async_trait]
impl Tool for WorkItemTool {
    fn name(&self) -> &str {
        tool_names::MANAGE_WORK_ITEM
    }

    fn category(&self) -> &str {
        crate::tools::categories::PROJECT
    }

    fn description(&self) -> &str {
        "Manage work items (tasks, issues, bugs) in the global project store. \
         Work items belong to projects and can have priorities, labels, milestones, \
         todos, dates, and assignees. Supports: list, read, create, update, delete."
    }

    fn llm_description(&self) -> Option<String> {
        Some(
            "Manage work items (tasks, issues, bugs) in the global project store. \
             Supports: list, read, create, update, delete, add_delegation. \
             Work items have priorities, labels, milestones, todos, and dates."
                .to_string(),
        )
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "The operation to perform.",
                    "enum": ["list", "read", "create", "update", "delete", "add_delegation"]
                },
                "project_slug": {
                    "type": "string",
                    "description": "Project identifier — accepts slug, display name, or project ID (e.g. 'auth-system', 'Auth System', or 'proj-auth-system'). Required for all actions."
                },
                "short_id": {
                    "type": "string",
                    "description": "Work item short ID, e.g. 'PROJ-001' (for read, update, delete). Use 'list' first to discover IDs."
                },
                "title": {
                    "type": "string",
                    "description": "Work item title (required for create, optional for update)"
                },
                "description": {
                    "type": "string",
                    "description": "Work item body/description (markdown)"
                },
                "project": {
                    "type": "string",
                    "description": "Project reference stored in frontmatter (optional metadata)."
                },
                "status": {
                    "type": "string",
                    "description": "Work item status",
                    "enum": ["backlog", "planned", "in_progress", "in_review", "completed", "cancelled"]
                },
                "priority": {
                    "type": "string",
                    "description": "Work item priority",
                    "enum": ["urgent", "high", "medium", "low", "none"]
                },
                "assignee": {
                    "type": "string",
                    "description": "Member ID to assign this work item to. Pass empty string to unassign."
                },
                "labels": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Label IDs (e.g. ['lbl-bug', 'lbl-feature'])"
                },
                "milestone": {
                    "type": "string",
                    "description": "Milestone ID to associate with. Pass empty string to clear."
                },
                "parent": {
                    "type": "string",
                    "description": "Parent work item short ID (for sub-issues). Pass empty string to clear."
                },
                "start_date": {
                    "type": "string",
                    "description": "Start date (ISO 8601, e.g. '2026-02-15'). Pass empty string to clear."
                },
                "target_date": {
                    "type": "string",
                    "description": "Target/due date (ISO 8601). Pass empty string to clear."
                },
                "starred": {
                    "type": "boolean",
                    "description": "Star/bookmark this work item"
                },
                "todos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": { "type": "string", "description": "Todo text" },
                            "status": {
                                "type": "string",
                                "description": "Todo status",
                                "enum": ["pending", "in_progress", "completed"]
                            }
                        },
                        "required": ["content"]
                    },
                    "description": "Todo checklist items. Replaces all existing todos when provided."
                },
                "selected_account_id": {
                    "type": "string",
                    "description": "Code account ID for Agent Workflow (from Integrations). Assigns which account runs SDE/Review."
                },
                "selected_model_id": {
                    "type": "string",
                    "description": "Model ID for Agent Workflow. Use with selected_account_id."
                },
                "sub_agent_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "IDs of custom agents from Agent Orgs to use as sub-agents during execution."
                },
                "org_id": {
                    "type": "string",
                    "description": "ID of the agent organization to assign. All org members are resolved as sub-agents."
                },
                "delegation": {
                    "type": "object",
                    "properties": {
                        "task_id": { "type": "string", "description": "Delegation task ID" },
                        "agent_app_id": { "type": "string", "description": "Agent app ID" },
                        "agent_app_name": { "type": "string", "description": "Agent app display name" },
                        "skill_id": { "type": "string", "description": "Skill ID that was invoked" },
                        "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "failed", "cancelled"] },
                        "cost_usd": { "type": "number", "description": "Cost in USD" }
                    },
                    "description": "Delegation entry to add (for add_delegation action)"
                },
                "schedule": {
                    "type": "object",
                    "properties": {
                        "at": { "type": "string", "description": "ISO 8601 timestamp for one-time trigger (e.g. '2026-04-01T09:00:00Z')" },
                        "cron": { "type": "string", "description": "Cron expression for recurring trigger (e.g. '0 9 * * 1' = every Monday 9am)" },
                        "enabled": { "type": "boolean", "description": "Whether the schedule is active (default true)" }
                    },
                    "description": "Schedule for automatic work item triggering. Use 'at' for one-shot or 'cron' for recurring."
                }
            },
            "required": ["action", "project_slug"]
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let action = required_string(&params, "action")?;
        let project_slug = Self::resolve_project_slug(&params)?;

        match action.as_str() {
            "list" => {
                crate::tool_infra::list_work_items(&project_slug)
                    .await
                    .map_err(ToolError::ExecutionFailed)
            }

            "read" => {
                let short_id = required_string(&params, "short_id")?;
                crate::tool_infra::read_work_item(&project_slug, &short_id)
                    .await
                    .map_err(ToolError::ExecutionFailed)
            }

            "create" => {
                let title = required_string(&params, "title")?;
                let description = optional_string(&params, "description").unwrap_or_default();
                let project = optional_string(&params, "project");
                let status = optional_string(&params, "status");
                let priority = optional_string(&params, "priority");
                let assignee = optional_string(&params, "assignee");
                let labels = Self::optional_string_array(&params, "labels");
                let milestone = optional_string(&params, "milestone");
                let parent = optional_string(&params, "parent");
                let start_date = optional_string(&params, "start_date");
                let target_date = optional_string(&params, "target_date");
                let starred = optional_bool(&params, "starred");
                let todos = Self::optional_todos(&params);

                crate::tool_infra::create_work_item(
                    &project_slug,
                    &title,
                    &description,
                    project.as_deref(),
                    status.as_deref(),
                    priority.as_deref(),
                    assignee.as_deref(),
                    None,
                    labels,
                    milestone.as_deref(),
                    parent.as_deref(),
                    start_date.as_deref(),
                    target_date.as_deref(),
                    starred,
                    todos,
                    Self::orchestrator_overrides_from_params(&params),
                    Self::parse_schedule(&params),
                )
                .await
                .map_err(ToolError::ExecutionFailed)
            }

            "update" => {
                let short_id = required_string(&params, "short_id")?;
                let title = optional_string(&params, "title");
                let description = optional_string(&params, "description");
                let project = optional_string(&params, "project");
                let status = optional_string(&params, "status");
                let priority = optional_string(&params, "priority");
                let assignee = optional_string(&params, "assignee");
                let labels = Self::optional_string_array(&params, "labels");
                let milestone = optional_string(&params, "milestone");
                let parent = optional_string(&params, "parent");
                let start_date = optional_string(&params, "start_date");
                let target_date = optional_string(&params, "target_date");
                let starred = optional_bool(&params, "starred");
                let todos = Self::optional_todos(&params);

                crate::tool_infra::update_work_item(
                    &project_slug,
                    &short_id,
                    title.as_deref(),
                    description.as_deref(),
                    project.as_deref(),
                    status.as_deref(),
                    priority.as_deref(),
                    assignee.as_deref(),
                    None,
                    labels,
                    milestone.as_deref(),
                    parent.as_deref(),
                    start_date.as_deref(),
                    target_date.as_deref(),
                    starred,
                    todos,
                    Self::orchestrator_overrides_from_params(&params),
                    Self::parse_schedule(&params),
                )
                .await
                .map_err(ToolError::ExecutionFailed)
            }

            "delete" => {
                let short_id = required_string(&params, "short_id")?;
                crate::tool_infra::delete_work_item(&project_slug, &short_id)
                    .await
                    .map_err(ToolError::ExecutionFailed)
            }

            "add_delegation" => {
                let short_id = required_string(&params, "short_id")?;
                let delegation_params = params.get("delegation").ok_or_else(|| {
                    ToolError::InvalidParams("delegation object is required for add_delegation".to_string())
                })?;

                let task_id = delegation_params["task_id"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidParams("delegation.task_id is required".to_string()))?;
                let agent_app_id = delegation_params["agent_app_id"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidParams("delegation.agent_app_id is required".to_string()))?;
                let agent_app_name = delegation_params["agent_app_name"]
                    .as_str()
                    .unwrap_or("Unknown Agent");
                let skill_id = delegation_params["skill_id"]
                    .as_str()
                    .ok_or_else(|| ToolError::InvalidParams("delegation.skill_id is required".to_string()))?;
                let status = delegation_params["status"]
                    .as_str()
                    .unwrap_or("pending");
                let cost_usd = delegation_params["cost_usd"]
                    .as_f64()
                    .unwrap_or(0.0);

                project_management::projects::io::update_work_item_atomic(
                    &project_slug,
                    &short_id,
                    |frontmatter, _body| {
                        let entry = project_management::projects::types::DelegationEntry {
                            task_id: task_id.to_string(),
                            agent_app_id: agent_app_id.to_string(),
                            agent_app_name: agent_app_name.to_string(),
                            skill_id: skill_id.to_string(),
                            status: status.to_string(),
                            cost_usd,
                            created_at: chrono::Utc::now().to_rfc3339(),
                            completed_at: None,
                        };

                        frontmatter.delegations.push(entry);
                        frontmatter.updated_at = chrono::Utc::now().to_rfc3339();
                        Ok(())
                    },
                ).map_err(ToolError::ExecutionFailed)?;

                Ok(format!(
                    "Delegation added to work item {}: task_id={}, agent={} ({}), skill={}, status={}",
                    short_id, task_id, agent_app_name, agent_app_id, skill_id, status
                ))
            }

            _ => Err(ToolError::InvalidParams(format!(
                "Unknown work_item action: '{}'. Valid actions: list, read, create, update, delete, add_delegation",
                action
            ))),
        }
    }
}
