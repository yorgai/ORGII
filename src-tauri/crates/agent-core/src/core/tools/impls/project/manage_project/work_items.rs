//! Work-item action handlers (`list_items`, `read_item`, `create_item`,
//! `update_item`, `delete_item`, `start_item`, `find`).

use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex as TokioMutex;

use crate::tools::traits::{optional_bool, optional_string, required_string, ToolError};

use super::params::{
    optional_schedule, optional_string_array, optional_todos, orchestrator_overrides_from_params,
};

pub(super) async fn list(slug: &str) -> Result<String, ToolError> {
    crate::tool_infra::list_work_items(slug)
        .await
        .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn read(slug: &str, short_id: &str) -> Result<String, ToolError> {
    crate::tool_infra::read_work_item(slug, short_id)
        .await
        .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn create(slug: &str, params: &Value) -> Result<String, ToolError> {
    let title = required_string(params, "title")?;
    let description = optional_string(params, "description").unwrap_or_default();
    let project_id = optional_string(params, "project_id");
    let status = optional_string(params, "status");
    let priority = optional_string(params, "priority");
    let assignee = optional_string(params, "assignee");
    let assignee_type = optional_string(params, "assignee_type");
    let labels = optional_string_array(params, "labels");
    let milestone = optional_string(params, "milestone");
    let parent = optional_string(params, "parent");
    let start_date = optional_string(params, "start_date");
    let target_date = optional_string(params, "target_date");
    let starred = optional_bool(params, "starred");
    let todos = optional_todos(params);
    let schedule = optional_schedule(params);

    crate::tool_infra::create_work_item(
        slug,
        &title,
        &description,
        project_id.as_deref(),
        status.as_deref(),
        priority.as_deref(),
        assignee.as_deref(),
        assignee_type.as_deref(),
        labels,
        milestone.as_deref(),
        parent.as_deref(),
        start_date.as_deref(),
        target_date.as_deref(),
        starred,
        todos,
        orchestrator_overrides_from_params(params),
        schedule,
    )
    .await
    .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn update(
    slug: &str,
    short_id: &str,
    params: &Value,
) -> Result<String, ToolError> {
    let title = optional_string(params, "title");
    let description = optional_string(params, "description");
    let project_id = optional_string(params, "project_id");
    let status = optional_string(params, "status");
    let priority = optional_string(params, "priority");
    let assignee = optional_string(params, "assignee");
    let assignee_type = optional_string(params, "assignee_type");
    let labels = optional_string_array(params, "labels");
    let milestone = optional_string(params, "milestone");
    let parent = optional_string(params, "parent");
    let start_date = optional_string(params, "start_date");
    let target_date = optional_string(params, "target_date");
    let starred = optional_bool(params, "starred");
    let todos = optional_todos(params);
    let schedule = optional_schedule(params);

    crate::tool_infra::update_work_item(
        slug,
        short_id,
        title.as_deref(),
        description.as_deref(),
        project_id.as_deref(),
        status.as_deref(),
        priority.as_deref(),
        assignee.as_deref(),
        assignee_type.as_deref(),
        labels,
        milestone.as_deref(),
        parent.as_deref(),
        start_date.as_deref(),
        target_date.as_deref(),
        starred,
        todos,
        orchestrator_overrides_from_params(params),
        schedule,
    )
    .await
    .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn delete(slug: &str, short_id: &str) -> Result<String, ToolError> {
    crate::tool_infra::delete_work_item(slug, short_id)
        .await
        .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn start(
    slug: &str,
    short_id: &str,
    app_handle: Option<&tauri::AppHandle>,
    current_account_id: Option<&Arc<TokioMutex<Option<String>>>>,
    agent_model: &str,
) -> Result<String, ToolError> {
    let app = app_handle.ok_or_else(|| {
        ToolError::ExecutionFailed(
            "start_item requires app_handle (not available in this context)".to_string(),
        )
    })?;
    let session_acct = if let Some(mtx) = current_account_id {
        mtx.lock().await.clone().filter(|acct| !acct.is_empty())
    } else {
        None
    };
    let override_account = session_acct.as_deref();
    let override_model = if !agent_model.trim().is_empty() {
        Some(agent_model)
    } else {
        None
    };
    crate::tool_infra::start_work_item(slug, short_id, app, override_account, override_model)
        .await
        .map_err(ToolError::ExecutionFailed)
}

pub(super) async fn find(query: &str) -> Result<String, ToolError> {
    crate::tool_infra::find_across_workspaces(query)
        .await
        .map_err(ToolError::ExecutionFailed)
}
