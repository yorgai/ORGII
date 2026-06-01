use serde_json::{json, Value};

use crate::sync::adapters::linear::client::LinearClient;
use crate::sync::{connection_store, oauth};

use super::input::{
    issue_create_input, issue_update_input, project_create_input, project_update_input,
    workflow_state_create_input, workflow_state_update_input,
};
use super::parse::{
    parse_issue, parse_issue_list, parse_project, parse_project_list, parse_success,
    parse_team_list, parse_workflow_state, parse_workflow_state_list,
};
use super::queries::{
    ISSUE_ARCHIVE_MUTATION, ISSUE_CREATE_MUTATION, ISSUE_UPDATE_MUTATION, PROJECTS_QUERY,
    PROJECT_ARCHIVE_MUTATION, PROJECT_CREATE_MUTATION, PROJECT_ISSUES_QUERY, PROJECT_QUERY,
    PROJECT_UPDATE_MUTATION, TEAMS_QUERY, TEAM_WORKFLOW_STATES_QUERY,
    WORKFLOW_STATE_ARCHIVE_MUTATION, WORKFLOW_STATE_CREATE_MUTATION,
    WORKFLOW_STATE_UPDATE_MUTATION,
};
use super::types::{
    LinearIssueCreateRequest, LinearIssueListResult, LinearIssueSummary, LinearIssueUpdateRequest,
    LinearProjectCreateRequest, LinearProjectListResult, LinearProjectSummary,
    LinearProjectUpdateRequest, LinearTeamListResult, LinearWorkflowStateCreateRequest,
    LinearWorkflowStateListResult, LinearWorkflowStateSummary, LinearWorkflowStateUpdateRequest,
};

async fn bearer_for_linear_connection(connection_id: &str) -> Result<String, String> {
    let connection = connection_store::get(connection_id)?;
    if connection.adapter_id != connection_store::ADAPTER_LINEAR {
        return Err(format!(
            "Sync connection '{}' belongs to adapter '{}' but Linear Projects requires 'linear'",
            connection_id, connection.adapter_id
        ));
    }
    oauth::ensure_fresh_connection_token(connection_id, connection_store::ADAPTER_LINEAR).await
}

pub async fn list_projects(
    connection_id: &str,
    cursor: Option<String>,
) -> Result<LinearProjectListResult, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(&token, PROJECTS_QUERY, json!({ "cursor": cursor }))
        .await
        .map_err(|err| err.to_string())?;
    parse_project_list(data.pointer("/projects").unwrap_or(&Value::Null))
}

pub async fn get_project(
    connection_id: &str,
    project_id: &str,
) -> Result<LinearProjectSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(&token, PROJECT_QUERY, json!({ "id": project_id }))
        .await
        .map_err(|err| err.to_string())?;
    parse_project(data.pointer("/project").unwrap_or(&Value::Null))
}

pub async fn list_teams(
    connection_id: &str,
    cursor: Option<String>,
) -> Result<LinearTeamListResult, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(&token, TEAMS_QUERY, json!({ "cursor": cursor }))
        .await
        .map_err(|err| err.to_string())?;
    parse_team_list(data.pointer("/teams").unwrap_or(&Value::Null))
}

pub async fn list_workflow_states(
    connection_id: &str,
    team_id: &str,
) -> Result<LinearWorkflowStateListResult, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(
            &token,
            TEAM_WORKFLOW_STATES_QUERY,
            json!({ "teamId": team_id }),
        )
        .await
        .map_err(|err| err.to_string())?;
    parse_workflow_state_list(data.pointer("/team/states").unwrap_or(&Value::Null))
}

pub async fn create_workflow_state(
    connection_id: &str,
    request: LinearWorkflowStateCreateRequest,
) -> Result<LinearWorkflowStateSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "input": workflow_state_create_input(request)? });
    let data = client
        .graphql(&token, WORKFLOW_STATE_CREATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_workflow_state(
        data.pointer("/workflowStateCreate/workflowState")
            .unwrap_or(&Value::Null),
    )
}

pub async fn update_workflow_state(
    connection_id: &str,
    state_id: &str,
    request: LinearWorkflowStateUpdateRequest,
) -> Result<LinearWorkflowStateSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "id": state_id, "input": workflow_state_update_input(request)? });
    let data = client
        .graphql(&token, WORKFLOW_STATE_UPDATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_workflow_state(
        data.pointer("/workflowStateUpdate/workflowState")
            .unwrap_or(&Value::Null),
    )
}

pub async fn archive_workflow_state(
    connection_id: &str,
    state_id: &str,
) -> Result<LinearWorkflowStateSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(
            &token,
            WORKFLOW_STATE_ARCHIVE_MUTATION,
            json!({ "id": state_id }),
        )
        .await
        .map_err(|err| err.to_string())?;
    let success = data.pointer("/workflowStateArchive/success");
    parse_success(success, "workflowStateArchive")?;
    parse_workflow_state(
        data.pointer("/workflowStateArchive/entity")
            .unwrap_or(&Value::Null),
    )
}

pub async fn create_project(
    connection_id: &str,
    request: LinearProjectCreateRequest,
) -> Result<LinearProjectSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "input": project_create_input(request)? });
    let data = client
        .graphql(&token, PROJECT_CREATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_project(
        data.pointer("/projectCreate/project")
            .unwrap_or(&Value::Null),
    )
}

pub async fn update_project(
    connection_id: &str,
    project_id: &str,
    request: LinearProjectUpdateRequest,
) -> Result<LinearProjectSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "id": project_id, "input": project_update_input(request)? });
    let data = client
        .graphql(&token, PROJECT_UPDATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_project(
        data.pointer("/projectUpdate/project")
            .unwrap_or(&Value::Null),
    )
}

pub async fn archive_project(connection_id: &str, project_id: &str) -> Result<(), String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(
            &token,
            PROJECT_ARCHIVE_MUTATION,
            json!({ "id": project_id }),
        )
        .await
        .map_err(|err| err.to_string())?;
    parse_success(data.pointer("/projectArchive/success"), "projectArchive")
}

pub async fn list_project_issues(
    connection_id: &str,
    project_id: &str,
    cursor: Option<String>,
) -> Result<LinearIssueListResult, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(
            &token,
            PROJECT_ISSUES_QUERY,
            json!({ "projectId": project_id, "cursor": cursor }),
        )
        .await
        .map_err(|err| err.to_string())?;
    parse_issue_list(data.pointer("/issues").unwrap_or(&Value::Null))
}

pub async fn create_issue(
    connection_id: &str,
    request: LinearIssueCreateRequest,
) -> Result<LinearIssueSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "input": issue_create_input(request)? });
    let data = client
        .graphql(&token, ISSUE_CREATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_issue(data.pointer("/issueCreate/issue").unwrap_or(&Value::Null))
}

pub async fn update_issue(
    connection_id: &str,
    issue_id: &str,
    request: LinearIssueUpdateRequest,
) -> Result<LinearIssueSummary, String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let variables = json!({ "id": issue_id, "input": issue_update_input(request)? });
    let data = client
        .graphql(&token, ISSUE_UPDATE_MUTATION, variables)
        .await
        .map_err(|err| err.to_string())?;
    parse_issue(data.pointer("/issueUpdate/issue").unwrap_or(&Value::Null))
}

pub async fn archive_issue(connection_id: &str, issue_id: &str) -> Result<(), String> {
    let token = bearer_for_linear_connection(connection_id).await?;
    let client = LinearClient::new().map_err(|err| err.to_string())?;
    let data = client
        .graphql(&token, ISSUE_ARCHIVE_MUTATION, json!({ "id": issue_id }))
        .await
        .map_err(|err| err.to_string())?;
    parse_success(data.pointer("/issueArchive/success"), "issueArchive")
}
