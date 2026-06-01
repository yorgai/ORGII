//! Work item, schedule, history, and batch operation types.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value as JsonValue;

use super::orchestrator::{
    FollowUpRef, LinkedSession, OrchestratorConfig, OrchestratorState, ProofOfWork,
    WorkItemSchedule,
};
use super::project::{CommentEntry, DelegationEntry, TodoEntry};
use super::routines::WorkItemRoutineSource;

// ============================================
// Work Item History
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkItemHistoryAction {
    Created,
    Updated,
    Commented,
    Deleted,
    Restored,
    Moved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemHistoryChange {
    pub field: String,
    pub old_value: JsonValue,
    pub new_value: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemHistoryEvent {
    pub id: String,
    pub action: WorkItemHistoryAction,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<WorkItemHistoryChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

// ============================================
// Work Item
// ============================================

/// Canonical default for `WorkItemFrontmatter::status`. Exposed at
/// `pub(crate)` so the sync worker (and any future inbound-create
/// path) can populate the same default instead of re-encoding the
/// string literal — keeping a single source of truth.
pub(crate) fn default_status() -> String {
    "backlog".to_string()
}

/// Canonical default for `WorkItemFrontmatter::priority`. See
/// [`default_status`] for the rationale behind the visibility.
pub(crate) fn default_priority() -> String {
    "none".to_string()
}

/// YAML frontmatter of a `work-items/{SHORT_ID}.md` file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemFrontmatter {
    pub id: String,
    pub short_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    /// "member" | "agent" | "org" — defaults to "member" when absent
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_type: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub milestone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub starred: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub todos: Vec<TodoEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<CommentEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<WorkItemHistoryEvent>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub delegations: Vec<DelegationEntry>,
    // --- Agent Workflow Fields ---
    //
    // `linked_sessions` and `orchestrator_state` are persisted in SQLite
    // (`orchestrator_runs` / `orchestrator_linked_sessions`), NOT in the
    // `.md` frontmatter. We keep the in-memory fields so existing mutator
    // closures work unchanged, but they are skipped during YAML
    // serialization. Deserialization is preserved so legacy `.md` files
    // can still be parsed during the one-time migration.
    #[serde(default, skip_serializing)]
    pub linked_sessions: Vec<LinkedSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof_of_work: Option<ProofOfWork>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestrator_config: Option<OrchestratorConfig>,
    #[serde(default, skip_serializing)]
    pub orchestrator_state: Option<OrchestratorState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub follow_up_items: Vec<FollowUpRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<WorkItemSchedule>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routine_source: Option<WorkItemRoutineSource>,
}

/// Combined work item data returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemData {
    pub frontmatter: WorkItemFrontmatter,
    /// Markdown body (everything after the frontmatter `---`)
    pub body: String,
    /// Filename without extension (e.g. "AUTH-001")
    pub filename: String,
}

fn deserialize_optional_update<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Partial update payload for work items.
///
/// All fields are optional — only provided fields will be updated.
/// This enables atomic read-modify-write in Rust, eliminating
/// multiple IPC calls and JS-side type conversions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemPartialUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub project: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    /// Assignee ID (member/agent ID)
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub assignee: Option<Option<String>>,
    /// Assignee type: "member" | "agent" | "org"
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub assignee_type: Option<Option<String>>,
    /// Label IDs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub milestone: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub start_date: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub target_date: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<TodoEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<CommentEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_sessions: Option<Vec<LinkedSession>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestrator_config: Option<OrchestratorConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orchestrator_state: Option<OrchestratorState>,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_update",
        skip_serializing_if = "Option::is_none"
    )]
    pub schedule: Option<Option<WorkItemSchedule>>,
}

// ============================================
// Work Item History (git-based field diffs)
// ============================================

/// A single field change between two commits
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldChange {
    pub field: String,
    pub old_value: String,
    pub new_value: String,
}

/// A history entry representing one commit's changes to a work item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemHistoryEntry {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: String,
    /// "created" for the first commit, "updated" for subsequent
    pub action: String,
    pub changes: Vec<FieldChange>,
}

// ============================================
// Batch Operations
// ============================================

/// Result of a batch delete operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDeleteResult {
    /// IDs that were successfully deleted
    pub deleted: Vec<String>,
    /// IDs that failed to delete, with error messages
    pub errors: Vec<BatchItemError>,
}

/// Result of a batch update operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchUpdateResult {
    /// Successfully updated items
    pub updated: Vec<super::enriched::EnrichedWorkItem>,
    /// IDs that failed to update, with error messages
    pub errors: Vec<BatchItemError>,
}

/// Error details for a single item in a batch operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemError {
    /// The short ID of the item that failed
    pub short_id: String,
    /// Error message
    pub error: String,
}
