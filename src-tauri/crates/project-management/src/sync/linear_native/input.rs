use serde_json::{json, Value};

use super::types::{
    LinearIssueCreateRequest, LinearIssueUpdateRequest, LinearProjectCreateRequest,
    LinearProjectUpdateRequest, LinearWorkflowStateCreateRequest, LinearWorkflowStateType,
    LinearWorkflowStateUpdateRequest,
};

pub(super) fn project_create_input(request: LinearProjectCreateRequest) -> Result<Value, String> {
    let name = required_trimmed("project name", &request.name)?;
    if request.team_ids.is_empty() {
        return Err("At least one Linear team is required to create a project".to_string());
    }
    let mut input = serde_json::Map::new();
    input.insert("name".to_string(), json!(name));
    input.insert("teamIds".to_string(), json!(request.team_ids));
    insert_optional_string(&mut input, "description", request.description);
    insert_optional_string(&mut input, "leadId", request.lead_id);
    insert_optional_string(&mut input, "startDate", request.start_date);
    insert_optional_string(&mut input, "targetDate", request.target_date);
    Ok(Value::Object(input))
}

pub(super) fn project_update_input(request: LinearProjectUpdateRequest) -> Result<Value, String> {
    let mut input = serde_json::Map::new();
    if let Some(name) = request.name {
        input.insert(
            "name".to_string(),
            json!(required_trimmed("project name", &name)?),
        );
    }
    insert_nullable_optional_string(&mut input, "description", request.description);
    insert_nullable_optional_string(&mut input, "leadId", request.lead_id);
    insert_nullable_optional_string(&mut input, "startDate", request.start_date);
    insert_nullable_optional_string(&mut input, "targetDate", request.target_date);
    if input.is_empty() {
        return Err("No Linear project fields supplied for update".to_string());
    }
    Ok(Value::Object(input))
}

pub(super) fn workflow_state_create_input(
    request: LinearWorkflowStateCreateRequest,
) -> Result<Value, String> {
    let team_id = required_trimmed("team id", &request.team_id)?;
    let name = required_trimmed("workflow state name", &request.name)?;
    let mut input = serde_json::Map::new();
    input.insert("teamId".to_string(), json!(team_id));
    input.insert("name".to_string(), json!(name));
    insert_optional_string(&mut input, "description", request.description);
    insert_optional_string(&mut input, "color", request.color);
    insert_optional_workflow_state_type(&mut input, request.state_type);
    if let Some(position) = request.position {
        input.insert("position".to_string(), json!(position));
    }
    Ok(Value::Object(input))
}

pub(super) fn workflow_state_update_input(
    request: LinearWorkflowStateUpdateRequest,
) -> Result<Value, String> {
    let mut input = serde_json::Map::new();
    if let Some(name) = request.name {
        input.insert(
            "name".to_string(),
            json!(required_trimmed("workflow state name", &name)?),
        );
    }
    insert_optional_string(&mut input, "description", request.description);
    insert_optional_string(&mut input, "color", request.color);
    insert_optional_workflow_state_type(&mut input, request.state_type);
    if let Some(position) = request.position {
        input.insert("position".to_string(), json!(position));
    }
    if input.is_empty() {
        return Err("No Linear workflow state fields supplied for update".to_string());
    }
    Ok(Value::Object(input))
}

pub(super) fn issue_create_input(request: LinearIssueCreateRequest) -> Result<Value, String> {
    let title = required_trimmed("issue title", &request.title)?;
    let team_id = required_trimmed("team id", &request.team_id)?;
    let project_id = required_trimmed("project id", &request.project_id)?;
    let mut input = serde_json::Map::new();
    input.insert("title".to_string(), json!(title));
    input.insert("teamId".to_string(), json!(team_id));
    input.insert("projectId".to_string(), json!(project_id));
    insert_optional_string(&mut input, "description", request.description);
    insert_optional_string(&mut input, "stateId", request.state_id);
    if let Some(priority) = request.priority {
        input.insert("priority".to_string(), json!(priority));
    }
    if let Some(estimate) = request.estimate {
        input.insert("estimate".to_string(), json!(estimate));
    }
    Ok(Value::Object(input))
}

pub(super) fn issue_update_input(request: LinearIssueUpdateRequest) -> Result<Value, String> {
    let mut input = serde_json::Map::new();
    if let Some(title) = request.title {
        input.insert(
            "title".to_string(),
            json!(required_trimmed("issue title", &title)?),
        );
    }
    insert_optional_string(&mut input, "description", request.description);
    insert_optional_string(&mut input, "stateId", request.state_id);
    if let Some(priority) = request.priority {
        input.insert("priority".to_string(), json!(priority));
    }
    if let Some(estimate) = request.estimate {
        input.insert("estimate".to_string(), json!(estimate));
    }
    if input.is_empty() {
        return Err("No Linear issue fields supplied for update".to_string());
    }
    Ok(Value::Object(input))
}

fn required_trimmed(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Linear {label} is required"));
    }
    Ok(trimmed.to_string())
}

fn insert_optional_string(
    input: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<String>,
) {
    if let Some(raw) = value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            input.insert(key.to_string(), json!(trimmed));
        }
    }
}

fn insert_nullable_optional_string(
    input: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<Option<String>>,
) {
    if let Some(raw) = value {
        let value = raw
            .map(|inner| inner.trim().to_string())
            .filter(|inner| !inner.is_empty());
        input.insert(key.to_string(), json!(value));
    }
}

fn insert_optional_workflow_state_type(
    input: &mut serde_json::Map<String, Value>,
    value: Option<LinearWorkflowStateType>,
) {
    if let Some(state_type) = value {
        input.insert("type".to_string(), json!(state_type));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    #[test]
    fn project_create_requires_team_ids() {
        let err = project_create_input(LinearProjectCreateRequest {
            name: "Launch".to_string(),
            description: None,
            team_ids: Vec::new(),
            lead_id: None,
            start_date: None,
            target_date: None,
        })
        .unwrap_err();
        assert!(err.contains("At least one Linear team"));
    }

    #[test]
    fn project_update_omits_missing_fields() {
        let input = project_update_input(LinearProjectUpdateRequest {
            name: Some("Roadmap".to_string()),
            description: None,
            lead_id: None,
            start_date: None,
            target_date: None,
        })
        .unwrap();

        assert_eq!(input, json!({ "name": "Roadmap" }));
    }

    #[test]
    fn project_update_serializes_null_for_explicit_clears() {
        let input = project_update_input(LinearProjectUpdateRequest {
            name: None,
            description: Some(None),
            lead_id: Some(None),
            start_date: Some(None),
            target_date: Some(None),
        })
        .unwrap();

        assert_eq!(input["description"], Value::Null);
        assert_eq!(input["leadId"], Value::Null);
        assert_eq!(input["startDate"], Value::Null);
        assert_eq!(input["targetDate"], Value::Null);
    }

    #[test]
    fn project_update_trims_values_and_treats_empty_patch_values_as_clear() {
        let input = project_update_input(LinearProjectUpdateRequest {
            name: Some("  Launch  ".to_string()),
            description: Some(Some("   ".to_string())),
            lead_id: Some(Some(" user-1 ".to_string())),
            start_date: Some(Some(" 2026-05-01 ".to_string())),
            target_date: Some(Some("".to_string())),
        })
        .unwrap();

        assert_eq!(input["name"], "Launch");
        assert_eq!(input["description"], Value::Null);
        assert_eq!(input["leadId"], "user-1");
        assert_eq!(input["startDate"], "2026-05-01");
        assert_eq!(input["targetDate"], Value::Null);
    }

    #[test]
    fn project_update_rejects_empty_name() {
        let err = project_update_input(LinearProjectUpdateRequest {
            name: Some("   ".to_string()),
            description: None,
            lead_id: None,
            start_date: None,
            target_date: None,
        })
        .unwrap_err();

        assert!(err.contains("Linear project name is required"));
    }

    #[test]
    fn project_update_rejects_empty_payload() {
        let err = project_update_input(LinearProjectUpdateRequest {
            name: None,
            description: None,
            lead_id: None,
            start_date: None,
            target_date: None,
        })
        .unwrap_err();

        assert!(err.contains("No Linear project fields"));
    }

    #[test]
    fn workflow_state_create_builds_input() {
        let input = workflow_state_create_input(LinearWorkflowStateCreateRequest {
            team_id: "team-1".to_string(),
            name: "In Review".to_string(),
            description: None,
            color: Some("#FFAA00".to_string()),
            state_type: Some(LinearWorkflowStateType::Started),
            position: Some(3.0),
        })
        .unwrap();

        assert_eq!(input["teamId"], "team-1");
        assert_eq!(input["name"], "In Review");
        assert_eq!(input["color"], "#FFAA00");
        assert_eq!(input["type"], "started");
        assert_eq!(input["position"], 3.0);
    }

    #[test]
    fn issue_update_accepts_state_id() {
        let input = issue_update_input(LinearIssueUpdateRequest {
            title: None,
            description: None,
            priority: None,
            estimate: None,
            state_id: Some("state-1".to_string()),
        })
        .unwrap();

        assert_eq!(input["stateId"], "state-1");
    }

    #[test]
    fn issue_update_rejects_empty_payload() {
        let err = issue_update_input(LinearIssueUpdateRequest {
            title: None,
            description: None,
            priority: None,
            estimate: None,
            state_id: None,
        })
        .unwrap_err();
        assert!(err.contains("No Linear issue fields"));
    }
}
