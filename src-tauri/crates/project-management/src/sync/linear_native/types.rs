use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearPageInfo {
    pub has_next_page: bool,
    pub end_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearUserSummary {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearTeamSummary {
    pub id: String,
    pub name: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearLabelSummary {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinearProjectStatusType {
    Backlog,
    Planned,
    Started,
    Completed,
    Canceled,
}

impl LinearProjectStatusType {
    pub(super) fn from_linear_value(value: &str) -> Result<Self, String> {
        match value {
            "backlog" => Ok(Self::Backlog),
            "planned" => Ok(Self::Planned),
            "started" => Ok(Self::Started),
            "completed" => Ok(Self::Completed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(format!("Unsupported Linear project status type: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearProjectStatusSummary {
    pub id: String,
    pub name: String,
    pub r#type: Option<LinearProjectStatusType>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearProjectSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: Option<LinearProjectStatusSummary>,
    pub slug_id: Option<String>,
    pub url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub archived_at: Option<String>,
    pub lead: Option<LinearUserSummary>,
    pub teams: Vec<LinearTeamSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearProjectListResult {
    pub projects: Vec<LinearProjectSummary>,
    pub page_info: LinearPageInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearTeamListResult {
    pub teams: Vec<LinearTeamSummary>,
    pub page_info: LinearPageInfo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinearWorkflowStateType {
    Backlog,
    Unstarted,
    Started,
    Completed,
    Canceled,
}

impl LinearWorkflowStateType {
    pub(super) fn from_linear_value(value: &str) -> Result<Self, String> {
        match value {
            "backlog" => Ok(Self::Backlog),
            "unstarted" => Ok(Self::Unstarted),
            "started" => Ok(Self::Started),
            "completed" => Ok(Self::Completed),
            "canceled" => Ok(Self::Canceled),
            _ => Err(format!("Unsupported Linear workflow state type: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearWorkflowStateSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub r#type: Option<LinearWorkflowStateType>,
    pub color: Option<String>,
    pub position: Option<f64>,
    pub archived_at: Option<String>,
    pub team: Option<LinearTeamSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearWorkflowStateListResult {
    pub states: Vec<LinearWorkflowStateSummary>,
    pub page_info: LinearPageInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueSummary {
    pub id: String,
    pub identifier: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub estimate: Option<f64>,
    pub url: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub archived_at: Option<String>,
    pub state: Option<LinearIssueState>,
    pub assignee: Option<LinearUserSummary>,
    pub project: Option<LinearProjectRef>,
    pub team: Option<LinearTeamSummary>,
    pub labels: Vec<LinearLabelSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueState {
    pub id: String,
    pub name: String,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearProjectRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssueListResult {
    pub issues: Vec<LinearIssueSummary>,
    pub page_info: LinearPageInfo,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearProjectCreateRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub team_ids: Vec<String>,
    #[serde(default)]
    pub lead_id: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearProjectUpdateRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<Option<String>>,
    #[serde(default)]
    pub lead_id: Option<Option<String>>,
    #[serde(default)]
    pub start_date: Option<Option<String>>,
    #[serde(default)]
    pub target_date: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearWorkflowStateCreateRequest {
    pub team_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub state_type: Option<LinearWorkflowStateType>,
    #[serde(default)]
    pub position: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearWorkflowStateUpdateRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub state_type: Option<LinearWorkflowStateType>,
    #[serde(default)]
    pub position: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearIssueCreateRequest {
    pub title: String,
    pub team_id: String,
    pub project_id: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub estimate: Option<f64>,
    #[serde(default)]
    pub state_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LinearIssueUpdateRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub estimate: Option<f64>,
    #[serde(default)]
    pub state_id: Option<String>,
}
