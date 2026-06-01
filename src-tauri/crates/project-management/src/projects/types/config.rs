//! Configuration, labels, milestones, and members types.

use serde::{Deserialize, Serialize};

// ============================================
// Config
// ============================================

/// Per-project config row projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgiiConfig {
    /// Schema version (currently 1)
    pub version: u32,
    /// Default short-ID prefix for new work items (e.g. "WORK-ITEM")
    pub id_prefix: String,
    /// Auto-increment counter for the next work item short ID
    pub next_id: u32,
    /// Default status for new work items
    #[serde(default = "default_status")]
    pub default_status: String,
    /// Default priority for new work items
    #[serde(default = "default_priority")]
    pub default_priority: String,
}

fn default_status() -> String {
    "backlog".to_string()
}

fn default_priority() -> String {
    "none".to_string()
}

impl Default for OrgiiConfig {
    fn default() -> Self {
        Self {
            version: 1,
            id_prefix: "WORK-ITEM".to_string(),
            next_id: 1,
            default_status: default_status(),
            default_priority: default_priority(),
        }
    }
}

// ============================================
// Labels
// ============================================

/// Per-project labels projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelsFile {
    #[serde(default)]
    pub labels: Vec<LabelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelEntry {
    pub id: String,
    pub name: String,
    pub color: String,
}

// ============================================
// Milestones
// ============================================

/// Per-project milestones projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilestonesFile {
    #[serde(default)]
    pub milestones: Vec<MilestoneEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MilestoneEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default = "default_milestone_status")]
    pub status: String,
}

fn default_milestone_status() -> String {
    "open".to_string()
}

// ============================================
// Members
// ============================================

/// Per-project members projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MembersFile {
    #[serde(default)]
    pub members: Vec<MemberEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// GitHub username (optional, user-editable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_username: Option<String>,
    /// ISO 8601 date of the most recent commit by this contributor (e.g. "2025-12-24")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit_date: Option<String>,
    /// Whether this member is active on the team (defaults to true)
    #[serde(default = "app_utils::default_true")]
    pub active: bool,
}
