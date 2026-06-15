//! Tauri commands for the Linear-native Projects view.
//!
//! These commands intentionally bypass the project-sync import/outbox pipeline.
//! They read and mutate Linear directly through a global sync connection token
//! so the UI can browse Linear without creating ORGII Project or WorkItem rows.

use crate::sync::linear_native::{
    self, LinearIssueCreateRequest, LinearIssueListResult, LinearIssueSummary,
    LinearIssueUpdateRequest, LinearProjectCreateRequest, LinearProjectListResult,
    LinearProjectSummary, LinearProjectUpdateRequest, LinearTeamListResult,
    LinearWorkflowStateCreateRequest, LinearWorkflowStateListResult, LinearWorkflowStateSummary,
    LinearWorkflowStateUpdateRequest,
};

#[tauri::command]
pub async fn linear_projects_list(
    connection_id: String,
    cursor: Option<String>,
    force_refresh: Option<bool>,
) -> Result<LinearProjectListResult, String> {
    linear_native::list_projects(&connection_id, cursor, force_refresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn linear_project_get(
    connection_id: String,
    project_id: String,
    force_refresh: Option<bool>,
) -> Result<LinearProjectSummary, String> {
    linear_native::get_project(&connection_id, &project_id, force_refresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn linear_teams_list(
    connection_id: String,
    cursor: Option<String>,
    force_refresh: Option<bool>,
) -> Result<LinearTeamListResult, String> {
    linear_native::list_teams(&connection_id, cursor, force_refresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn linear_workflow_states_list(
    connection_id: String,
    team_id: String,
    force_refresh: Option<bool>,
) -> Result<LinearWorkflowStateListResult, String> {
    linear_native::list_workflow_states(&connection_id, &team_id, force_refresh.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn linear_workflow_state_create(
    connection_id: String,
    request: LinearWorkflowStateCreateRequest,
) -> Result<LinearWorkflowStateSummary, String> {
    linear_native::create_workflow_state(&connection_id, request).await
}

#[tauri::command]
pub async fn linear_workflow_state_update(
    connection_id: String,
    state_id: String,
    request: LinearWorkflowStateUpdateRequest,
) -> Result<LinearWorkflowStateSummary, String> {
    linear_native::update_workflow_state(&connection_id, &state_id, request).await
}

#[tauri::command]
pub async fn linear_workflow_state_archive(
    connection_id: String,
    state_id: String,
) -> Result<LinearWorkflowStateSummary, String> {
    linear_native::archive_workflow_state(&connection_id, &state_id).await
}

#[tauri::command]
pub async fn linear_project_create(
    connection_id: String,
    request: LinearProjectCreateRequest,
) -> Result<LinearProjectSummary, String> {
    linear_native::create_project(&connection_id, request).await
}

#[tauri::command]
pub async fn linear_project_update(
    connection_id: String,
    project_id: String,
    request: LinearProjectUpdateRequest,
) -> Result<LinearProjectSummary, String> {
    linear_native::update_project(&connection_id, &project_id, request).await
}

#[tauri::command]
pub async fn linear_project_archive(
    connection_id: String,
    project_id: String,
) -> Result<(), String> {
    linear_native::archive_project(&connection_id, &project_id).await
}

#[tauri::command]
pub async fn linear_project_issues_list(
    connection_id: String,
    project_id: String,
    cursor: Option<String>,
    force_refresh: Option<bool>,
) -> Result<LinearIssueListResult, String> {
    linear_native::list_project_issues(
        &connection_id,
        &project_id,
        cursor,
        force_refresh.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn linear_issue_create(
    connection_id: String,
    request: LinearIssueCreateRequest,
) -> Result<LinearIssueSummary, String> {
    linear_native::create_issue(&connection_id, request).await
}

#[tauri::command]
pub async fn linear_issue_update(
    connection_id: String,
    issue_id: String,
    request: LinearIssueUpdateRequest,
) -> Result<LinearIssueSummary, String> {
    linear_native::update_issue(&connection_id, &issue_id, request).await
}

#[tauri::command]
pub async fn linear_issue_archive(connection_id: String, issue_id: String) -> Result<(), String> {
    linear_native::archive_issue(&connection_id, &issue_id).await
}
