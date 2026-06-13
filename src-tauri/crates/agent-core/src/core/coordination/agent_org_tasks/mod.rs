//! Agent Org task store: Task schema, persisted to SQLite.
//!
//! Tasks are stored in a single `agent_org_tasks` table scoped by
//! `org_run_id` (one Agent Org run = one team execution).
//!
//! This module exposes the schema, struct, store CRUD, and atomic
//! `try_claim` primitive. The LLM tool plumbing (`task_create` /
//! `task_update` / `task_list` / `task_get`), the `TaskAssigned` inbox
//! wiring, the autonomous claiming loop, and the `unassignTeammateTasks`
//! shutdown hook all live in their own modules and consume these
//! primitives.

use rusqlite::{Connection, Result as SqliteResult};

pub(super) mod graph;
pub(super) mod helpers;
mod store;
pub use store::AgentOrgTaskStore;

#[cfg(test)]
mod tests;

pub const TASK_DEPENDENCY_CYCLE_ERROR: &str = "task_dependency_cycle";

pub(super) const TASK_EVENT_CREATED: &str = "created";
pub(super) const TASK_EVENT_UPDATED: &str = "updated";
pub(super) const TASK_EVENT_CLAIMED: &str = "claimed";
pub(super) const TASK_EVENT_RELEASED: &str = "released";

/// Task status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
}

impl TaskStatus {
    pub fn as_wire(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Completed => "completed",
        }
    }

    pub fn from_wire(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(TaskStatus::Pending),
            "in_progress" => Ok(TaskStatus::InProgress),
            "completed" => Ok(TaskStatus::Completed),
            other => Err(format!("invalid TaskStatus wire value: {other}")),
        }
    }

    /// `completed` is treated as resolved. Used by both `try_claim` (to
    /// reject `already_resolved`) and `find_available` (to skip resolved
    /// tasks).
    pub fn is_resolved(&self) -> bool {
        matches!(self, TaskStatus::Completed)
    }
}

/// Persisted task row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub org_run_id: String,
    pub subject: String,
    pub description: String,
    pub active_form: Option<String>,
    pub owner: Option<String>,
    pub status: TaskStatus,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskHistoryEvent {
    pub id: String,
    pub org_run_id: String,
    pub task_id: String,
    pub event_type: String,
    pub previous_owner: Option<String>,
    pub next_owner: Option<String>,
    pub previous_status: Option<TaskStatus>,
    pub next_status: Option<TaskStatus>,
    pub actor_member_id: Option<String>,
    pub created_at: String,
}

/// Inputs for creating a task. `id` is caller-supplied so the LLM tool
/// layer can deterministically generate UUIDs. If you want the store to
/// mint one, call `new_task_id()` first.
#[derive(Debug, Clone)]
pub struct CreateTaskParams {
    pub id: String,
    pub org_run_id: String,
    pub subject: String,
    pub description: String,
    pub active_form: Option<String>,
    pub owner: Option<String>,
    pub status: TaskStatus,
    pub blocks: Vec<String>,
    pub blocked_by: Vec<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Patch applied by `update`. Every field is `Option`; only `Some(_)`
/// fields are written. `None` keeps the existing value. To clear a
/// nullable column (e.g. unassign owner), use the explicit clear-flag
/// pattern via `UpdateTaskPatch::clear_owner` etc.
#[derive(Debug, Clone, Default)]
pub struct UpdateTaskPatch {
    pub subject: Option<String>,
    pub description: Option<String>,
    pub active_form: Option<Option<String>>,
    pub owner: Option<Option<String>>,
    pub status: Option<TaskStatus>,
    pub blocks: Option<Vec<String>>,
    pub blocked_by: Option<Vec<String>>,
    pub metadata: Option<Option<serde_json::Value>>,
}

/// Options accepted by `try_claim`.
#[derive(Debug, Clone, Default)]
pub struct ClaimOptions {
    /// When `true`, reject the claim if the member already owns another
    /// non-resolved task in the same run. Default `false` so the
    /// autonomous loop can keep things flowing. Set `true` if the LLM
    /// tool wants strict serial-by-member.
    pub check_member_busy: bool,
}

/// Reasons `try_claim` can fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimError {
    /// No row matches `(org_run_id, task_id)`.
    TaskNotFound,
    /// Row exists but `owner IS NOT NULL` and != claimant.
    AlreadyClaimed { current_owner: String },
    /// Row is in a terminal status.
    AlreadyResolved { status: TaskStatus },
    /// Row's `blocked_by` contains at least one task that is not
    /// `completed`.
    Blocked { by_task_ids: Vec<String> },
    /// Only emitted when `ClaimOptions::check_member_busy = true` and
    /// claimant already owns another non-completed task.
    MemberBusy { busy_with: String },
    /// SQL or serialization failure. Bubbled as a string so callers can
    /// surface it without needing to re-implement formatting.
    Storage(String),
}

impl std::fmt::Display for ClaimError {
    fn fmt(&self, fmt: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaimError::TaskNotFound => write!(fmt, "task_not_found"),
            ClaimError::AlreadyClaimed { current_owner } => {
                write!(fmt, "already_claimed by {current_owner}")
            }
            ClaimError::AlreadyResolved { status } => {
                write!(fmt, "already_resolved (status={})", status.as_wire())
            }
            ClaimError::Blocked { by_task_ids } => {
                write!(fmt, "blocked by [{}]", by_task_ids.join(","))
            }
            ClaimError::MemberBusy { busy_with } => {
                write!(fmt, "member_busy (current_task={busy_with})")
            }
            ClaimError::Storage(msg) => write!(fmt, "storage: {msg}"),
        }
    }
}

impl std::error::Error for ClaimError {}

pub fn new_task_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Initialize the `agent_org_tasks` table.
///
/// Hot-path indexes:
/// - `(org_run_id, status, owner)` -- `find_available` and unclaimed
///   listings.
/// - `(org_run_id, owner)` -- `unassignTeammateTasks` and per-member
///   listings.
pub fn init_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_org_tasks (
            id TEXT NOT NULL,
            org_run_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            active_form TEXT,
            owner TEXT,
            status TEXT NOT NULL,
            blocks_json TEXT NOT NULL DEFAULT '[]',
            blocked_by_json TEXT NOT NULL DEFAULT '[]',
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (org_run_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_org_tasks_status
            ON agent_org_tasks(org_run_id, status, owner);
        CREATE INDEX IF NOT EXISTS idx_agent_org_tasks_owner
            ON agent_org_tasks(org_run_id, owner);
        CREATE TABLE IF NOT EXISTS agent_org_task_events (
            id TEXT PRIMARY KEY,
            org_run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            previous_owner TEXT,
            next_owner TEXT,
            previous_status TEXT,
            next_status TEXT,
            actor_member_id TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_org_task_events_run
            ON agent_org_task_events(org_run_id, created_at, id);
        CREATE INDEX IF NOT EXISTS idx_agent_org_task_events_task
            ON agent_org_task_events(org_run_id, task_id, created_at, id);",
    )?;
    add_column_if_missing(conn, "agent_org_tasks", "active_form", "TEXT")?;
    add_column_if_missing(
        conn,
        "agent_org_tasks",
        "blocks_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(
        conn,
        "agent_org_tasks",
        "blocked_by_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    add_column_if_missing(conn, "agent_org_tasks", "metadata_json", "TEXT")?;
    add_column_if_missing(conn, "agent_org_task_events", "actor_member_id", "TEXT")?;
    Ok(())
}

fn add_column_if_missing(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> SqliteResult<()> {
    let sql = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    match conn.execute(&sql, []) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(err, Some(message)))
            if err.code == rusqlite::ErrorCode::Unknown
                && message.contains("duplicate column name") =>
        {
            Ok(())
        }
        Err(err) => Err(err),
    }
}

/// Inbox helper: enqueue a `TaskAssigned` payload into the task owner's
/// inbox for the same `org_run_id` as the task itself.
///
/// Producer contract:
///
/// - `recipient_member_id` is the canonical task owner member id and must
///   match `task.owner` exactly.
/// - `recipient_agent_id` is only the delivery address for the current
///   materialized member session.
/// - `sender_member_id` is the caller's canonical member id for LLM/tool
///   producers, or `None` for system-emitted self-claim/requeue events.
///
/// Returns the row id of the persisted inbox row. The caller is
/// responsible for waking the recipient via the `InboxWakeHook`; this
/// function is intentionally side-effect-free beyond the insert so it
/// can be reused by both the synchronous tool path and the polling
/// loop.
///
/// `assigned_by_display_name` is the human-readable label that ends up
/// in the `<task_assigned assigned_by="...">` attribute. Pass the
/// producer's display name (e.g. "Coordinator", "Alice"), not the
/// agent_id.
pub fn enqueue_task_assigned_to(
    task: &Task,
    recipient_agent_id: &str,
    recipient_member_id: &str,
    sender_agent_id: &str,
    sender_member_id: Option<&str>,
    assigned_by_display_name: &str,
) -> Result<i64, String> {
    let owner_member_id = task
        .owner
        .as_deref()
        .ok_or_else(|| "enqueue_task_assigned_to called for unowned task".to_string())?;
    if owner_member_id != recipient_member_id {
        return Err(format!(
            "recipient_member_id '{recipient_member_id}' does not match task owner '{owner_member_id}'"
        ));
    }

    let message = crate::core::coordination::agent_inbox::AgentMessage::TaskAssigned {
        task_id: task.id.clone(),
        subject: task.subject.clone(),
        description: task.description.clone(),
        assigned_by: assigned_by_display_name.to_string(),
    };
    message.validate()?;

    let row = crate::core::coordination::agent_inbox::AgentInboxStore::insert(
        crate::core::coordination::agent_inbox::InsertInboxParams {
            recipient_agent_id: recipient_agent_id.to_string(),
            recipient_member_id: Some(recipient_member_id.to_string()),
            sender_agent_id: sender_agent_id.to_string(),
            sender_member_id: sender_member_id.map(str::to_string),
            org_run_id: Some(task.org_run_id.clone()),
            message,
        },
    )
    .map_err(|err| format!("failed to insert TaskAssigned inbox row: {err}"))?;
    Ok(row.id)
}
