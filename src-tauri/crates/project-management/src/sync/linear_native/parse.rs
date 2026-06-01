use serde_json::Value;

use super::types::{
    LinearIssueListResult, LinearIssueState, LinearIssueSummary, LinearLabelSummary,
    LinearPageInfo, LinearProjectListResult, LinearProjectRef, LinearProjectStatusSummary,
    LinearProjectStatusType, LinearProjectSummary, LinearTeamListResult, LinearTeamSummary,
    LinearUserSummary, LinearWorkflowStateListResult, LinearWorkflowStateSummary,
    LinearWorkflowStateType,
};

pub(super) fn parse_project_list(value: &Value) -> Result<LinearProjectListResult, String> {
    let projects = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Linear projects response missing nodes".to_string())?
        .iter()
        .map(parse_project)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LinearProjectListResult {
        projects,
        page_info: parse_page_info(value)?,
    })
}

pub(super) fn parse_team_list(value: &Value) -> Result<LinearTeamListResult, String> {
    let teams = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Linear teams response missing nodes".to_string())?
        .iter()
        .map(parse_team)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LinearTeamListResult {
        teams,
        page_info: parse_page_info(value)?,
    })
}

pub(super) fn parse_workflow_state_list(
    value: &Value,
) -> Result<LinearWorkflowStateListResult, String> {
    let states = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Linear workflow states response missing nodes".to_string())?
        .iter()
        .map(parse_workflow_state)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LinearWorkflowStateListResult {
        states,
        page_info: parse_page_info(value)?,
    })
}

pub(super) fn parse_issue_list(value: &Value) -> Result<LinearIssueListResult, String> {
    let issues = value
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "Linear issues response missing nodes".to_string())?
        .iter()
        .map(parse_issue)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LinearIssueListResult {
        issues,
        page_info: parse_page_info(value)?,
    })
}

pub(super) fn parse_project(value: &Value) -> Result<LinearProjectSummary, String> {
    Ok(LinearProjectSummary {
        id: required_string(value, "id", "Linear project")?,
        name: required_string(value, "name", "Linear project")?,
        description: optional_string(value, "description"),
        status: parse_optional_project_status(value.get("status"))?,
        slug_id: optional_string(value, "slugId"),
        url: optional_string(value, "url"),
        icon: optional_string(value, "icon"),
        color: optional_string(value, "color"),
        start_date: optional_string(value, "startDate"),
        target_date: optional_string(value, "targetDate"),
        created_at: optional_string(value, "createdAt"),
        updated_at: optional_string(value, "updatedAt"),
        archived_at: optional_string(value, "archivedAt"),
        lead: parse_optional_user(value.get("lead"))?,
        teams: value
            .pointer("/teams/nodes")
            .and_then(Value::as_array)
            .map(|nodes| nodes.iter().map(parse_team).collect())
            .unwrap_or_else(|| Ok(Vec::new()))?,
    })
}

pub(super) fn parse_workflow_state(value: &Value) -> Result<LinearWorkflowStateSummary, String> {
    Ok(LinearWorkflowStateSummary {
        id: required_string(value, "id", "Linear workflow state")?,
        name: required_string(value, "name", "Linear workflow state")?,
        description: optional_string(value, "description"),
        r#type: optional_workflow_state_type(value, "type")?,
        color: optional_string(value, "color"),
        position: value.get("position").and_then(Value::as_f64),
        archived_at: optional_string(value, "archivedAt"),
        team: parse_optional_team(value.get("team"))?,
    })
}

pub(super) fn parse_issue(value: &Value) -> Result<LinearIssueSummary, String> {
    Ok(LinearIssueSummary {
        id: required_string(value, "id", "Linear issue")?,
        identifier: optional_string(value, "identifier"),
        title: required_string(value, "title", "Linear issue")?,
        description: optional_string(value, "description"),
        priority: value.get("priority").and_then(Value::as_i64),
        estimate: value.get("estimate").and_then(Value::as_f64),
        url: optional_string(value, "url"),
        created_at: optional_string(value, "createdAt"),
        updated_at: optional_string(value, "updatedAt"),
        archived_at: optional_string(value, "archivedAt"),
        state: parse_optional_state(value.get("state"))?,
        assignee: parse_optional_user(value.get("assignee"))?,
        project: parse_optional_project_ref(value.get("project"))?,
        team: parse_optional_team(value.get("team"))?,
        labels: value
            .pointer("/labels/nodes")
            .and_then(Value::as_array)
            .map(|nodes| nodes.iter().map(parse_label).collect())
            .unwrap_or_else(|| Ok(Vec::new()))?,
    })
}

pub(super) fn parse_success(value: Option<&Value>, operation: &str) -> Result<(), String> {
    match value.and_then(Value::as_bool) {
        Some(true) => Ok(()),
        Some(false) => Err(format!("Linear {operation} returned success=false")),
        None => Err(format!("Linear {operation} response missing success")),
    }
}

fn parse_page_info(value: &Value) -> Result<LinearPageInfo, String> {
    let page_info = value
        .get("pageInfo")
        .ok_or_else(|| "Linear response missing pageInfo".to_string())?;
    Ok(LinearPageInfo {
        has_next_page: page_info
            .get("hasNextPage")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        end_cursor: page_info
            .get("endCursor")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn parse_optional_project_status(
    value: Option<&Value>,
) -> Result<Option<LinearProjectStatusSummary>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(LinearProjectStatusSummary {
        id: required_string(value, "id", "Linear project status")?,
        name: required_string(value, "name", "Linear project status")?,
        r#type: optional_project_status_type(value, "type")?,
        color: optional_string(value, "color"),
    }))
}

fn parse_optional_state(value: Option<&Value>) -> Result<Option<LinearIssueState>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(LinearIssueState {
        id: required_string(value, "id", "Linear state")?,
        name: required_string(value, "name", "Linear state")?,
        r#type: optional_string(value, "type"),
    }))
}

fn parse_optional_project_ref(value: Option<&Value>) -> Result<Option<LinearProjectRef>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(LinearProjectRef {
        id: required_string(value, "id", "Linear project ref")?,
        name: required_string(value, "name", "Linear project ref")?,
    }))
}

fn parse_optional_user(value: Option<&Value>) -> Result<Option<LinearUserSummary>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(LinearUserSummary {
        id: required_string(value, "id", "Linear user")?,
        name: required_string(value, "name", "Linear user")?,
        email: optional_string(value, "email"),
    }))
}

fn parse_optional_team(value: Option<&Value>) -> Result<Option<LinearTeamSummary>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    Ok(Some(parse_team(value)?))
}

fn parse_team(value: &Value) -> Result<LinearTeamSummary, String> {
    Ok(LinearTeamSummary {
        id: required_string(value, "id", "Linear team")?,
        name: required_string(value, "name", "Linear team")?,
        key: required_string(value, "key", "Linear team")?,
    })
}

fn parse_label(value: &Value) -> Result<LinearLabelSummary, String> {
    Ok(LinearLabelSummary {
        id: required_string(value, "id", "Linear label")?,
        name: required_string(value, "name", "Linear label")?,
        color: optional_string(value, "color"),
    })
}

fn required_string(value: &Value, field: &str, label: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("{label} missing {field}"))
}

fn optional_string(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::to_string)
}

fn optional_project_status_type(
    value: &Value,
    field: &str,
) -> Result<Option<LinearProjectStatusType>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(LinearProjectStatusType::from_linear_value)
        .transpose()
}

fn optional_workflow_state_type(
    value: &Value,
    field: &str,
) -> Result<Option<LinearWorkflowStateType>, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(LinearWorkflowStateType::from_linear_value)
        .transpose()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_project_list() {
        let payload = json!({
            "pageInfo": { "hasNextPage": false, "endCursor": null },
            "nodes": [{
                "id": "proj-1",
                "name": "Project One",
                "description": "Ship it",
                "status": { "id": "project-status-1", "name": "In Progress", "type": "started", "color": "#22c55e" },
                "slugId": "PRJ",
                "url": "https://linear.app/acme/project/prj",
                "icon": "Briefcase",
                "color": "#123456",
                "startDate": "2026-05-01",
                "targetDate": "2026-06-01",
                "createdAt": "2026-05-01T00:00:00Z",
                "updatedAt": "2026-05-02T00:00:00Z",
                "archivedAt": null,
                "lead": { "id": "user-1", "name": "Ada", "email": "ada@example.com" },
                "teams": { "nodes": [{ "id": "team-1", "name": "Engineering", "key": "ENG" }] }
            }]
        });
        let parsed = parse_project_list(&payload).unwrap();
        assert_eq!(parsed.projects.len(), 1);
        assert_eq!(parsed.projects[0].teams[0].key, "ENG");
        assert_eq!(
            parsed.projects[0].status.as_ref().unwrap().r#type,
            Some(LinearProjectStatusType::Started)
        );
        assert!(!parsed.page_info.has_next_page);
    }

    #[test]
    fn parses_workflow_state_list() {
        let payload = json!({
            "pageInfo": { "hasNextPage": false, "endCursor": null },
            "nodes": [{
                "id": "state-1",
                "name": "In Progress",
                "description": null,
                "type": "started",
                "color": "#123456",
                "position": 2.0,
                "archivedAt": null,
                "team": { "id": "team-1", "name": "Engineering", "key": "ENG" }
            }]
        });

        let parsed = parse_workflow_state_list(&payload).unwrap();
        assert_eq!(parsed.states.len(), 1);
        assert_eq!(parsed.states[0].id, "state-1");
        assert_eq!(
            parsed.states[0].r#type,
            Some(LinearWorkflowStateType::Started)
        );
        assert_eq!(parsed.states[0].team.as_ref().unwrap().key, "ENG");
    }
}
