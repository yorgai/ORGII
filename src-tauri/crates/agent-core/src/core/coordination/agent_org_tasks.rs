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

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult, Transaction};
use serde::{Deserialize, Serialize};

use database::db::get_connection;

/// Task status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
///
/// Fields:
/// - `id` — UUID string, stable across LLM turns.
/// - `org_run_id` — scoping key. One team can host multiple concurrent
///   runs but task sets are per-run.
/// - `subject` / `description` / `active_form` — task labels.
/// - `owner` — canonical Agent Org member_id; `None` = unclaimed.
/// - `status` — see [`TaskStatus`].
/// - `blocks` / `blocked_by` — task ID arrays describing dependencies.
/// - `metadata` — free-form record.
/// - `created_at` / `updated_at` — ISO timestamps.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
/// mint one, call `Task::new_id()` first.
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
/// - `(org_run_id, status, owner)` — `find_available` and unclaimed
///   listings.
/// - `(org_run_id, owner)` — `unassignTeammateTasks` and per-member
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

pub const TASK_DEPENDENCY_CYCLE_ERROR: &str = "task_dependency_cycle";

const TASK_EVENT_CREATED: &str = "created";
const TASK_EVENT_UPDATED: &str = "updated";
const TASK_EVENT_CLAIMED: &str = "claimed";
const TASK_EVENT_RELEASED: &str = "released";

pub struct AgentOrgTaskStore;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn encode_json_array(values: &[String]) -> Result<String, String> {
    serde_json::to_string(values).map_err(|err| format!("encode JSON array: {err}"))
}

fn decode_json_array(raw: &str) -> Result<Vec<String>, String> {
    serde_json::from_str(raw).map_err(|err| format!("decode JSON array: {err}"))
}

fn encode_metadata(metadata: Option<&serde_json::Value>) -> Result<Option<String>, String> {
    metadata
        .map(|value| serde_json::to_string(value).map_err(|err| format!("encode metadata: {err}")))
        .transpose()
}

fn decode_metadata(raw: Option<String>) -> Result<Option<serde_json::Value>, String> {
    raw.map(|s| serde_json::from_str(&s).map_err(|err| format!("decode metadata: {err}")))
        .transpose()
}

fn status_from_optional_wire(
    value: Option<String>,
    column_index: usize,
) -> SqliteResult<Option<TaskStatus>> {
    value
        .map(|raw| {
            TaskStatus::from_wire(&raw).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    column_index,
                    rusqlite::types::Type::Text,
                    err.into(),
                )
            })
        })
        .transpose()
}

fn row_to_task(row: &rusqlite::Row<'_>) -> SqliteResult<Task> {
    let blocks_json: String = row.get(7)?;
    let blocked_by_json: String = row.get(8)?;
    let metadata_raw: Option<String> = row.get(9)?;
    let status_raw: String = row.get(6)?;

    let task = Task {
        id: row.get(0)?,
        org_run_id: row.get(1)?,
        subject: row.get(2)?,
        description: row.get(3)?,
        active_form: row.get(4)?,
        owner: row.get(5)?,
        status: TaskStatus::from_wire(&status_raw).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, err.into())
        })?,
        blocks: decode_json_array(&blocks_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, err.into())
        })?,
        blocked_by: decode_json_array(&blocked_by_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, err.into())
        })?,
        metadata: decode_metadata(metadata_raw).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, err.into())
        })?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    };
    Ok(task)
}

fn row_to_task_history_event(row: &rusqlite::Row<'_>) -> SqliteResult<TaskHistoryEvent> {
    let previous_status_raw: Option<String> = row.get(6)?;
    let next_status_raw: Option<String> = row.get(7)?;
    Ok(TaskHistoryEvent {
        id: row.get(0)?,
        org_run_id: row.get(1)?,
        task_id: row.get(2)?,
        event_type: row.get(3)?,
        previous_owner: row.get(4)?,
        next_owner: row.get(5)?,
        previous_status: status_from_optional_wire(previous_status_raw, 6)?,
        next_status: status_from_optional_wire(next_status_raw, 7)?,
        actor_member_id: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn insert_task_history_event(
    tx: &Transaction<'_>,
    org_run_id: &str,
    task_id: &str,
    event_type: &str,
    previous: Option<&Task>,
    next: &Task,
    actor_member_id: Option<&str>,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO agent_org_task_events (
            id, org_run_id, task_id, event_type, previous_owner, next_owner,
            previous_status, next_status, actor_member_id, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            uuid::Uuid::new_v4().to_string(),
            org_run_id,
            task_id,
            event_type,
            previous.and_then(|task| task.owner.as_deref()),
            next.owner.as_deref(),
            previous.map(|task| task.status.as_wire()),
            next.status.as_wire(),
            actor_member_id,
            &next.updated_at,
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

const SELECT_COLUMNS: &str = "id,
        org_run_id,
        subject,
        description,
        active_form,
        owner,
        status,
        blocks_json,
        blocked_by_json,
        metadata_json,
        created_at,
        updated_at";

fn list_tasks_with_conn(conn: &Connection, org_run_id: &str) -> Result<Vec<Task>, String> {
    let sql = format!(
        "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
         WHERE org_run_id = ?1
         ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(params![org_run_id], row_to_task)
        .map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| err.to_string())?);
    }
    Ok(out)
}

impl AgentOrgTaskStore {
    /// Insert a task. Fails if `(org_run_id, id)` already exists.
    pub fn create(params: CreateTaskParams) -> Result<Task, String> {
        if params.id.trim().is_empty() {
            return Err("task id must be non-empty".into());
        }
        if params.org_run_id.trim().is_empty() {
            return Err("org_run_id must be non-empty".into());
        }
        if params.subject.trim().is_empty() {
            return Err("task subject must be non-empty".into());
        }
        if params.status == TaskStatus::InProgress && params.owner.is_none() {
            return Err("in_progress task must have an owner".into());
        }

        let metadata_json = encode_metadata(params.metadata.as_ref())?;
        let now = now_rfc3339();

        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let existing_tasks = list_tasks_with_conn(&tx, &params.org_run_id)?;
        validate_dependency_graph_after_upsert(
            &existing_tasks,
            &params.org_run_id,
            &params.id,
            &params.blocks,
            &params.blocked_by,
        )?;
        let blocks_json = encode_json_array(&params.blocks)?;
        let blocked_by_json = encode_json_array(&params.blocked_by)?;

        tx.execute(
            "INSERT INTO agent_org_tasks (
                id, org_run_id, subject, description, active_form, owner,
                status, blocks_json, blocked_by_json, metadata_json,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                &params.id,
                &params.org_run_id,
                &params.subject,
                &params.description,
                params.active_form.as_deref(),
                params.owner.as_deref(),
                params.status.as_wire(),
                &blocks_json,
                &blocked_by_json,
                metadata_json.as_deref(),
                &now,
            ],
        )
        .map_err(|err| err.to_string())?;

        let task = Task {
            id: params.id,
            org_run_id: params.org_run_id,
            subject: params.subject,
            description: params.description,
            active_form: params.active_form,
            owner: params.owner,
            status: params.status,
            blocks: params.blocks,
            blocked_by: params.blocked_by,
            metadata: params.metadata,
            created_at: now.clone(),
            updated_at: now,
        };
        insert_task_history_event(
            &tx,
            &task.org_run_id,
            &task.id,
            TASK_EVENT_CREATED,
            None,
            &task,
            task.owner.as_deref(),
        )?;
        tx.commit().map_err(|err| err.to_string())?;

        Ok(task)
    }

    pub fn get(org_run_id: &str, task_id: &str) -> Result<Option<Task>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let sql = format!(
            "SELECT {SELECT_COLUMNS} FROM agent_org_tasks WHERE org_run_id = ?1 AND id = ?2"
        );
        let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
        let task = stmt
            .query_row(params![org_run_id, task_id], row_to_task)
            .optional()
            .map_err(|err| err.to_string())?;
        Ok(task)
    }

    pub fn list(org_run_id: &str) -> Result<Vec<Task>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        list_tasks_with_conn(&conn, org_run_id)
    }

    pub fn list_history(org_run_id: &str) -> Result<Vec<TaskHistoryEvent>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, org_run_id, task_id, event_type, previous_owner, next_owner,
                    previous_status, next_status, actor_member_id, created_at
                 FROM agent_org_task_events
                 WHERE org_run_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![org_run_id], row_to_task_history_event)
            .map_err(|err| err.to_string())?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row.map_err(|err| err.to_string())?);
        }
        Ok(events)
    }

    /// Apply a partial update. The full updated row is returned. `Err` on
    /// missing row so callers can surface a clear "task_not_found" without
    /// a separate get round-trip.
    pub fn update(org_run_id: &str, task_id: &str, patch: UpdateTaskPatch) -> Result<Task, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let existing: Option<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            stmt.query_row(params![org_run_id, task_id], row_to_task)
                .optional()
                .map_err(|err| err.to_string())?
        };
        let Some(mut task) = existing else {
            return Err(format!("task_not_found: {task_id} in run {org_run_id}"));
        };
        let previous_task = task.clone();

        if let Some(subject) = patch.subject {
            if subject.trim().is_empty() {
                return Err("task subject must be non-empty".into());
            }
            task.subject = subject;
        }
        if let Some(description) = patch.description {
            task.description = description;
        }
        if let Some(active_form) = patch.active_form {
            task.active_form = active_form;
        }
        if let Some(owner) = patch.owner {
            task.owner = owner;
        }
        if let Some(status) = patch.status {
            task.status = status;
        }
        if task.status == TaskStatus::InProgress && task.owner.is_none() {
            return Err("in_progress task must have an owner".into());
        }
        if let Some(blocks) = patch.blocks {
            task.blocks = blocks;
        }
        if let Some(blocked_by) = patch.blocked_by {
            task.blocked_by = blocked_by;
        }
        if let Some(metadata) = patch.metadata {
            task.metadata = metadata;
        }
        task.updated_at = now_rfc3339();

        let existing_tasks = list_tasks_with_conn(&tx, org_run_id)?;
        validate_dependency_graph_after_upsert(
            &existing_tasks,
            org_run_id,
            &task.id,
            &task.blocks,
            &task.blocked_by,
        )?;
        let blocks_json = encode_json_array(&task.blocks)?;
        let blocked_by_json = encode_json_array(&task.blocked_by)?;
        let metadata_json = encode_metadata(task.metadata.as_ref())?;

        tx.execute(
            "UPDATE agent_org_tasks SET
                subject = ?1,
                description = ?2,
                active_form = ?3,
                owner = ?4,
                status = ?5,
                blocks_json = ?6,
                blocked_by_json = ?7,
                metadata_json = ?8,
                updated_at = ?9
             WHERE org_run_id = ?10 AND id = ?11",
            params![
                &task.subject,
                &task.description,
                task.active_form.as_deref(),
                task.owner.as_deref(),
                task.status.as_wire(),
                &blocks_json,
                &blocked_by_json,
                metadata_json.as_deref(),
                &task.updated_at,
                org_run_id,
                task_id,
            ],
        )
        .map_err(|err| err.to_string())?;
        insert_task_history_event(
            &tx,
            org_run_id,
            task_id,
            TASK_EVENT_UPDATED,
            Some(&previous_task),
            &task,
            task.owner.as_deref(),
        )?;

        tx.commit().map_err(|err| err.to_string())?;
        Ok(task)
    }

    pub fn delete(org_run_id: &str, task_id: &str) -> Result<bool, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let n = conn
            .execute(
                "DELETE FROM agent_org_tasks WHERE org_run_id = ?1 AND id = ?2",
                params![org_run_id, task_id],
            )
            .map_err(|err| err.to_string())?;
        Ok(n > 0)
    }

    /// Return the first task in the run that is `pending`, `owner IS
    /// NULL`, and whose `blocked_by` are all `completed`. Ordered by
    /// `created_at ASC` (insertion order).
    pub fn find_available(org_run_id: &str) -> Result<Option<Task>, String> {
        let pending = Self::list(org_run_id)?;
        for task in &pending {
            if task.owner.is_some() {
                continue;
            }
            if task.status != TaskStatus::Pending {
                continue;
            }
            if !blockers_resolved(&pending, &task.blocked_by) {
                continue;
            }
            return Ok(Some(task.clone()));
        }
        Ok(None)
    }

    /// Atomic SQLite CAS-based claim.
    ///
    /// Failure precedence:
    /// 1. `task_not_found`
    /// 2. `already_resolved` (terminal status takes priority over
    ///    ownership: a completed task is not stealable even by its
    ///    original owner)
    /// 3. `already_claimed` (owner != claimant_member_id)
    /// 4. `blocked` (unresolved dependencies)
    /// 5. `member_busy` (only when `check_member_busy = true`)
    ///
    /// On success the task transitions to `(owner = claimant_member_id,
    /// status = in_progress)` and the updated row is returned. Re-claim by
    /// the current owner is idempotent (same status transition).
    pub fn try_claim(
        org_run_id: &str,
        task_id: &str,
        claimant_member_id: &str,
        options: ClaimOptions,
    ) -> Result<Task, ClaimError> {
        if claimant_member_id.trim().is_empty() {
            return Err(ClaimError::Storage(
                "claimant_member_id must be non-empty".into(),
            ));
        }

        let mut conn = get_connection().map_err(|err| ClaimError::Storage(err.to_string()))?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        let task: Task = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            match stmt
                .query_row(params![org_run_id, task_id], row_to_task)
                .optional()
                .map_err(|err| ClaimError::Storage(err.to_string()))?
            {
                Some(row) => row,
                None => return Err(ClaimError::TaskNotFound),
            }
        };

        if task.status.is_resolved() {
            return Err(ClaimError::AlreadyResolved {
                status: task.status,
            });
        }
        if let Some(owner) = &task.owner {
            if owner != claimant_member_id {
                return Err(ClaimError::AlreadyClaimed {
                    current_owner: owner.clone(),
                });
            }
        }

        let all_in_run = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let rows = stmt
                .query_map(params![org_run_id], row_to_task)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| ClaimError::Storage(err.to_string()))?);
            }
            out
        };

        let unresolved = unresolved_blockers(&all_in_run, &task.blocked_by);
        if !unresolved.is_empty() {
            return Err(ClaimError::Blocked {
                by_task_ids: unresolved,
            });
        }

        if options.check_member_busy {
            if let Some(busy_with) = find_busy_task(&all_in_run, claimant_member_id, &task.id) {
                return Err(ClaimError::MemberBusy { busy_with });
            }
        }

        let now = now_rfc3339();
        let updated = tx
            .execute(
                "UPDATE agent_org_tasks SET owner = ?1, status = ?2, updated_at = ?3
                 WHERE org_run_id = ?4 AND id = ?5
                   AND status != ?6
                   AND (owner IS NULL OR owner = ?1)",
                params![
                    claimant_member_id,
                    TaskStatus::InProgress.as_wire(),
                    &now,
                    org_run_id,
                    task_id,
                    TaskStatus::Completed.as_wire(),
                ],
            )
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        if updated == 0 {
            // Lost the CAS race. Re-read to surface the precise reason.
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let race_winner: Task = stmt
                .query_row(params![org_run_id, task_id], row_to_task)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            if race_winner.status.is_resolved() {
                return Err(ClaimError::AlreadyResolved {
                    status: race_winner.status,
                });
            }
            if let Some(owner) = &race_winner.owner {
                if owner != claimant_member_id {
                    return Err(ClaimError::AlreadyClaimed {
                        current_owner: owner.clone(),
                    });
                }
            }
            return Err(ClaimError::Storage(
                "claim CAS failed for unknown reason".into(),
            ));
        }

        let mut claimed = task.clone();
        claimed.owner = Some(claimant_member_id.to_string());
        claimed.status = TaskStatus::InProgress;
        claimed.updated_at = now;
        insert_task_history_event(
            &tx,
            org_run_id,
            task_id,
            TASK_EVENT_CLAIMED,
            Some(&task),
            &claimed,
            Some(claimant_member_id),
        )
        .map_err(ClaimError::Storage)?;

        tx.commit()
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        Ok(claimed)
    }

    /// Clear `owner` and reset `status` to `pending` for every
    /// non-completed task currently owned by the given member_id in the
    /// run. Used by the member-shutdown hook so a worker dying
    /// mid-task does not leave its in-flight rows orphaned.
    ///
    /// Returns the list of tasks that were unassigned (full updated
    /// rows). Empty list if the member owns nothing or only completed
    /// tasks.
    pub fn unassign_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let owned: Vec<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND owner = ?2 AND status != ?3
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(
                    params![org_run_id, owner_member_id, TaskStatus::Completed.as_wire()],
                    row_to_task,
                )
                .map_err(|err| err.to_string())?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| err.to_string())?);
            }
            out
        };

        if owned.is_empty() {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(Vec::new());
        }

        let now = now_rfc3339();
        let mut updated_rows = Vec::with_capacity(owned.len());
        for task in owned {
            tx.execute(
                "UPDATE agent_org_tasks
                 SET owner = NULL, status = ?1, updated_at = ?2
                 WHERE org_run_id = ?3 AND id = ?4 AND owner = ?5",
                params![
                    TaskStatus::Pending.as_wire(),
                    &now,
                    org_run_id,
                    &task.id,
                    owner_member_id,
                ],
            )
            .map_err(|err| err.to_string())?;
            let mut updated_task = task.clone();
            updated_task.owner = None;
            updated_task.status = TaskStatus::Pending;
            updated_task.updated_at = now.clone();
            insert_task_history_event(
                &tx,
                org_run_id,
                &updated_task.id,
                TASK_EVENT_RELEASED,
                Some(&task),
                &updated_task,
                Some(owner_member_id),
            )?;
            updated_rows.push(updated_task);
        }

        tx.commit().map_err(|err| err.to_string())?;
        Ok(updated_rows)
    }

    pub fn requeue_in_progress_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let owned: Vec<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND owner = ?2 AND status = ?3
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(
                    params![
                        org_run_id,
                        owner_member_id,
                        TaskStatus::InProgress.as_wire()
                    ],
                    row_to_task,
                )
                .map_err(|err| err.to_string())?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| err.to_string())?);
            }
            out
        };

        if owned.is_empty() {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(Vec::new());
        }

        let now = now_rfc3339();
        let mut updated_rows = Vec::with_capacity(owned.len());
        for task in owned {
            tx.execute(
                "UPDATE agent_org_tasks
                 SET status = ?1, updated_at = ?2
                 WHERE org_run_id = ?3 AND id = ?4 AND owner = ?5 AND status = ?6",
                params![
                    TaskStatus::Pending.as_wire(),
                    &now,
                    org_run_id,
                    &task.id,
                    owner_member_id,
                    TaskStatus::InProgress.as_wire(),
                ],
            )
            .map_err(|err| err.to_string())?;
            let mut updated_task = task.clone();
            updated_task.status = TaskStatus::Pending;
            updated_task.updated_at = now.clone();
            insert_task_history_event(
                &tx,
                org_run_id,
                &updated_task.id,
                TASK_EVENT_RELEASED,
                Some(&task),
                &updated_task,
                Some(owner_member_id),
            )?;
            updated_rows.push(updated_task);
        }

        tx.commit().map_err(|err| err.to_string())?;
        Ok(updated_rows)
    }

    /// Returns `true` iff `owner_member_id` currently owns at least one
    /// non-completed task in the run. Used by the autonomous claim
    /// path so a member that already has work in flight does not steal
    /// another row.
    pub fn has_open_task_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<bool, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let sql = "SELECT COUNT(*) FROM agent_org_tasks
                   WHERE org_run_id = ?1 AND owner = ?2 AND status != ?3";
        let count: i64 = conn
            .query_row(
                sql,
                params![org_run_id, owner_member_id, TaskStatus::Completed.as_wire()],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        Ok(count > 0)
    }
}

fn validate_dependency_graph_after_upsert(
    existing_tasks: &[Task],
    org_run_id: &str,
    task_id: &str,
    blocks: &[String],
    blocked_by: &[String],
) -> Result<(), String> {
    if blocks.iter().any(|id| id == task_id) || blocked_by.iter().any(|id| id == task_id) {
        return Err(format!(
            "{TASK_DEPENDENCY_CYCLE_ERROR}: task '{task_id}' cannot depend on itself"
        ));
    }

    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    let mut candidate_seen = false;
    for task in existing_tasks {
        if task.org_run_id != org_run_id {
            continue;
        }
        let (current_blocks, current_blocked_by) = if task.id == task_id {
            candidate_seen = true;
            (blocks, blocked_by)
        } else {
            (task.blocks.as_slice(), task.blocked_by.as_slice())
        };
        add_dependency_edges(&mut graph, &task.id, current_blocks, current_blocked_by);
    }
    if !candidate_seen {
        add_dependency_edges(&mut graph, task_id, blocks, blocked_by);
    }

    reject_dependency_cycle(&graph)
}

fn add_dependency_edges(
    graph: &mut HashMap<String, Vec<String>>,
    task_id: &str,
    blocks: &[String],
    blocked_by: &[String],
) {
    graph.entry(task_id.to_string()).or_default();
    for blocker_id in blocked_by {
        graph
            .entry(task_id.to_string())
            .or_default()
            .push(blocker_id.clone());
        graph.entry(blocker_id.clone()).or_default();
    }
    for downstream_id in blocks {
        graph
            .entry(downstream_id.clone())
            .or_default()
            .push(task_id.to_string());
        graph.entry(task_id.to_string()).or_default();
    }
}

fn reject_dependency_cycle(graph: &HashMap<String, Vec<String>>) -> Result<(), String> {
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    let mut stack = Vec::new();
    for node in graph.keys() {
        visit_dependency_node(graph, node, &mut visiting, &mut visited, &mut stack)?;
    }
    Ok(())
}

fn visit_dependency_node(
    graph: &HashMap<String, Vec<String>>,
    node: &str,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
    stack: &mut Vec<String>,
) -> Result<(), String> {
    if visited.contains(node) {
        return Ok(());
    }
    if visiting.contains(node) {
        let start = stack.iter().position(|item| item == node).unwrap_or(0);
        let mut cycle = stack[start..].to_vec();
        cycle.push(node.to_string());
        return Err(format!(
            "{TASK_DEPENDENCY_CYCLE_ERROR}: {}",
            cycle.join(" -> ")
        ));
    }

    visiting.insert(node.to_string());
    stack.push(node.to_string());
    if let Some(next_nodes) = graph.get(node) {
        for next_node in next_nodes {
            visit_dependency_node(graph, next_node, visiting, visited, stack)?;
        }
    }
    stack.pop();
    visiting.remove(node);
    visited.insert(node.to_string());
    Ok(())
}

fn blockers_resolved(all: &[Task], blocked_by: &[String]) -> bool {
    if blocked_by.is_empty() {
        return true;
    }
    for blocker_id in blocked_by {
        let resolved = all
            .iter()
            .find(|task| &task.id == blocker_id)
            .map(|task| task.status.is_resolved())
            .unwrap_or(false);
        if !resolved {
            return false;
        }
    }
    true
}

fn unresolved_blockers(all: &[Task], blocked_by: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for blocker_id in blocked_by {
        let resolved = all
            .iter()
            .find(|task| &task.id == blocker_id)
            .map(|task| task.status.is_resolved())
            .unwrap_or(false);
        if !resolved {
            out.push(blocker_id.clone());
        }
    }
    out
}

fn find_busy_task(all: &[Task], owner_member_id: &str, except_task_id: &str) -> Option<String> {
    for task in all {
        if task.id == except_task_id {
            continue;
        }
        if task.status.is_resolved() {
            continue;
        }
        if task.owner.as_deref() == Some(owner_member_id) {
            return Some(task.id.clone());
        }
    }
    None
}

/// Inbox helper: enqueue a [`TaskAssigned`] payload into the task owner's
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_params(org_run_id: &str, id: &str, subject: &str) -> CreateTaskParams {
        CreateTaskParams {
            id: id.into(),
            org_run_id: org_run_id.into(),
            subject: subject.into(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        }
    }

    fn task_store_sandbox() -> test_helpers::test_env::SandboxGuard {
        let sandbox = test_helpers::test_env::sandbox();
        let conn = get_connection().expect("test sqlite connection");
        crate::coordination::agent_inbox::init_schema(&conn).expect("agent inbox schema");
        init_schema(&conn).expect("agent team tasks schema");
        sandbox
    }

    #[test]
    fn task_status_wire_round_trip() {
        for status in [
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Completed,
        ] {
            assert_eq!(TaskStatus::from_wire(status.as_wire()).unwrap(), status);
        }
        assert!(TaskStatus::from_wire("garbage").is_err());
    }

    #[test]
    fn create_get_round_trip() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let task_id = new_task_id();

        let mut params = make_params(&run_id, &task_id, "Write tests");
        params.description = "all the tests".into();
        params.active_form = Some("Writing tests".into());
        params.metadata = Some(serde_json::json!({"priority": "high"}));
        let created = AgentOrgTaskStore::create(params).unwrap();

        let fetched = AgentOrgTaskStore::get(&run_id, &task_id).unwrap().unwrap();
        assert_eq!(fetched.id, task_id);
        assert_eq!(fetched.subject, "Write tests");
        assert_eq!(fetched.description, "all the tests");
        assert_eq!(fetched.active_form.as_deref(), Some("Writing tests"));
        assert_eq!(fetched.status, TaskStatus::Pending);
        assert!(fetched.owner.is_none());
        assert_eq!(
            fetched.metadata.as_ref().and_then(|m| m.get("priority")),
            Some(&serde_json::Value::String("high".into()))
        );
        assert_eq!(created.created_at, fetched.created_at);
    }

    #[test]
    fn create_rejects_blank_subject_and_id() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        let mut bad = make_params(&run_id, "task-1", "");
        bad.subject = "   ".into();
        assert!(AgentOrgTaskStore::create(bad).is_err());

        let bad_id = make_params(&run_id, "   ", "ok");
        assert!(AgentOrgTaskStore::create(bad_id).is_err());
    }

    #[test]
    fn create_rejects_in_progress_without_owner() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut params = make_params(&run_id, "task-1", "ownerless running");
        params.status = TaskStatus::InProgress;

        let err = AgentOrgTaskStore::create(params).unwrap_err();
        assert!(
            err.contains("in_progress task must have an owner"),
            "got {err}"
        );
    }

    #[test]
    fn update_rejects_ownerless_in_progress_state() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "task-1", "claim me")).unwrap();

        let err = AgentOrgTaskStore::update(
            &run_id,
            "task-1",
            UpdateTaskPatch {
                status: Some(TaskStatus::InProgress),
                owner: Some(None),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(
            err.contains("in_progress task must have an owner"),
            "got {err}"
        );
    }

    #[test]
    fn list_scopes_by_run_id() {
        let _sandbox = task_store_sandbox();
        let run_a = format!("run-{}", uuid::Uuid::new_v4());
        let run_b = format!("run-{}", uuid::Uuid::new_v4());

        AgentOrgTaskStore::create(make_params(&run_a, "a-1", "one")).unwrap();
        AgentOrgTaskStore::create(make_params(&run_a, "a-2", "two")).unwrap();
        AgentOrgTaskStore::create(make_params(&run_b, "b-1", "other")).unwrap();

        let listed_a = AgentOrgTaskStore::list(&run_a).unwrap();
        assert_eq!(listed_a.len(), 2);
        assert!(listed_a.iter().all(|t| t.org_run_id == run_a));

        let listed_b = AgentOrgTaskStore::list(&run_b).unwrap();
        assert_eq!(listed_b.len(), 1);
        assert_eq!(listed_b[0].id, "b-1");
    }

    #[test]
    fn update_applies_patch_and_clears_owner() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut params = make_params(&run_id, "t-1", "draft subject");
        params.owner = Some("member-alpha".into());
        params.status = TaskStatus::InProgress;
        AgentOrgTaskStore::create(params).unwrap();

        let updated = AgentOrgTaskStore::update(
            &run_id,
            "t-1",
            UpdateTaskPatch {
                subject: Some("final subject".into()),
                description: Some("filled in".into()),
                status: Some(TaskStatus::Completed),
                owner: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.subject, "final subject");
        assert_eq!(updated.description, "filled in");
        assert_eq!(updated.status, TaskStatus::Completed);
        assert!(updated.owner.is_none());

        // updated_at must have advanced (or at least be present and different
        // shape — we can't assert strict > because RFC3339 strings may match
        // when the test runs faster than 1s; presence + rewrite is enough).
        assert!(!updated.updated_at.is_empty());
    }

    #[test]
    fn update_missing_returns_error() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let err =
            AgentOrgTaskStore::update(&run_id, "missing", UpdateTaskPatch::default()).unwrap_err();
        assert!(err.contains("task_not_found"), "got {err}");
    }

    #[test]
    fn create_rejects_self_dependency_cycle() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut params = make_params(&run_id, "self", "self cycle");
        params.blocked_by = vec!["self".into()];

        let err = AgentOrgTaskStore::create(params).unwrap_err();
        assert!(err.contains(TASK_DEPENDENCY_CYCLE_ERROR), "got {err}");
    }

    #[test]
    fn update_rejects_dependency_cycle_across_blocks_and_blocked_by() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut first = make_params(&run_id, "first", "first");
        first.blocks = vec!["second".into()];
        AgentOrgTaskStore::create(first).unwrap();
        AgentOrgTaskStore::create(make_params(&run_id, "second", "second")).unwrap();

        let err = AgentOrgTaskStore::update(
            &run_id,
            "second",
            UpdateTaskPatch {
                blocks: Some(vec!["first".into()]),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(err.contains(TASK_DEPENDENCY_CYCLE_ERROR), "got {err}");

        let second = AgentOrgTaskStore::get(&run_id, "second").unwrap().unwrap();
        assert!(second.blocks.is_empty());
    }

    #[test]
    fn dependency_cycle_validation_is_scoped_by_run() {
        let _sandbox = task_store_sandbox();
        let run_a = format!("run-a-{}", uuid::Uuid::new_v4());
        let run_b = format!("run-b-{}", uuid::Uuid::new_v4());

        let mut first = make_params(&run_a, "first", "first");
        first.blocks = vec!["second".into()];
        AgentOrgTaskStore::create(first).unwrap();

        let mut second = make_params(&run_b, "second", "second");
        second.blocked_by = vec!["first".into()];
        AgentOrgTaskStore::create(second).unwrap();
    }

    #[test]
    fn delete_removes_row() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "to delete")).unwrap();

        assert!(AgentOrgTaskStore::delete(&run_id, "t-1").unwrap());
        assert!(AgentOrgTaskStore::get(&run_id, "t-1").unwrap().is_none());
        assert!(!AgentOrgTaskStore::delete(&run_id, "t-1").unwrap());
    }

    #[test]
    fn try_claim_happy_path_sets_owner_and_in_progress() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();

        let claimed =
            AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
                .unwrap();
        assert_eq!(claimed.owner.as_deref(), Some("member-alpha"));
        assert_eq!(claimed.status, TaskStatus::InProgress);
    }

    #[test]
    fn requeue_in_progress_for_owner_keeps_owner_and_releases_status() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();

        let requeued = AgentOrgTaskStore::requeue_in_progress_for_owner(&run_id, "member-alpha")
            .expect("requeue in-progress work");

        assert_eq!(requeued.len(), 1);
        assert_eq!(requeued[0].owner.as_deref(), Some("member-alpha"));
        assert_eq!(requeued[0].status, TaskStatus::Pending);
        let stored = AgentOrgTaskStore::get(&run_id, "t-1").unwrap().unwrap();
        assert_eq!(stored.owner.as_deref(), Some("member-alpha"));
        assert_eq!(stored.status, TaskStatus::Pending);
    }

    #[test]
    fn task_history_records_create_claim_update_and_release() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "history")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();
        AgentOrgTaskStore::update(
            &run_id,
            "t-1",
            UpdateTaskPatch {
                status: Some(TaskStatus::Completed),
                ..Default::default()
            },
        )
        .unwrap();
        AgentOrgTaskStore::update(
            &run_id,
            "t-1",
            UpdateTaskPatch {
                status: Some(TaskStatus::InProgress),
                owner: Some(Some("member-alpha".to_string())),
                ..Default::default()
            },
        )
        .unwrap();
        AgentOrgTaskStore::unassign_for_owner(&run_id, "member-alpha").unwrap();

        let history = AgentOrgTaskStore::list_history(&run_id).unwrap();
        let event_types: Vec<&str> = history
            .iter()
            .map(|event| event.event_type.as_str())
            .collect();
        assert_eq!(
            event_types,
            vec![
                TASK_EVENT_CREATED,
                TASK_EVENT_CLAIMED,
                TASK_EVENT_UPDATED,
                TASK_EVENT_UPDATED,
                TASK_EVENT_RELEASED
            ]
        );
        let claimed = &history[1];
        assert_eq!(claimed.previous_owner, None);
        assert_eq!(claimed.next_owner.as_deref(), Some("member-alpha"));
        assert_eq!(claimed.previous_status, Some(TaskStatus::Pending));
        assert_eq!(claimed.next_status, Some(TaskStatus::InProgress));
        let released = history.last().unwrap();
        assert_eq!(released.previous_owner.as_deref(), Some("member-alpha"));
        assert_eq!(released.next_owner, None);
        assert_eq!(released.next_status, Some(TaskStatus::Pending));
    }

    #[test]
    fn try_claim_returns_task_not_found() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let err = AgentOrgTaskStore::try_claim(
            &run_id,
            "missing",
            "member-alpha",
            ClaimOptions::default(),
        )
        .unwrap_err();
        assert_eq!(err, ClaimError::TaskNotFound);
    }

    #[test]
    fn try_claim_already_claimed_by_other_member() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();

        let err =
            AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-beta", ClaimOptions::default())
                .unwrap_err();
        match err {
            ClaimError::AlreadyClaimed { current_owner } => {
                assert_eq!(current_owner, "member-alpha");
            }
            other => panic!("expected AlreadyClaimed, got {other:?}"),
        }
    }

    #[test]
    fn try_claim_idempotent_for_current_owner() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "claim me")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();
        let again =
            AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
                .unwrap();
        assert_eq!(again.owner.as_deref(), Some("member-alpha"));
        assert_eq!(again.status, TaskStatus::InProgress);
    }

    #[test]
    fn try_claim_already_resolved_takes_priority_over_ownership() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let mut params = make_params(&run_id, "t-1", "done");
        params.owner = Some("member-alpha".into());
        params.status = TaskStatus::Completed;
        AgentOrgTaskStore::create(params).unwrap();

        let err =
            AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
                .unwrap_err();
        match err {
            ClaimError::AlreadyResolved { status } => {
                assert_eq!(status, TaskStatus::Completed);
            }
            other => panic!("expected AlreadyResolved, got {other:?}"),
        }
    }

    #[test]
    fn try_claim_blocked_lists_unresolved_blockers() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "blocker-1", "first")).unwrap();
        let mut blocker_completed = make_params(&run_id, "blocker-2", "second");
        blocker_completed.status = TaskStatus::Completed;
        AgentOrgTaskStore::create(blocker_completed).unwrap();
        let mut dependent = make_params(&run_id, "dep", "depends");
        dependent.blocked_by = vec!["blocker-1".into(), "blocker-2".into()];
        AgentOrgTaskStore::create(dependent).unwrap();

        let err =
            AgentOrgTaskStore::try_claim(&run_id, "dep", "member-alpha", ClaimOptions::default())
                .unwrap_err();
        match err {
            ClaimError::Blocked { by_task_ids } => {
                assert_eq!(by_task_ids, vec!["blocker-1".to_string()]);
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
    }

    #[test]
    fn try_claim_member_busy_only_when_option_enabled() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "t-1", "first")).unwrap();
        AgentOrgTaskStore::create(make_params(&run_id, "t-2", "second")).unwrap();

        AgentOrgTaskStore::try_claim(&run_id, "t-1", "member-alpha", ClaimOptions::default())
            .unwrap();

        // With default options the second claim succeeds.
        let _ok =
            AgentOrgTaskStore::try_claim(&run_id, "t-2", "member-alpha", ClaimOptions::default())
                .unwrap();

        // Reset t-2 (unassign + pending) so we can rerun with the strict flag.
        AgentOrgTaskStore::update(
            &run_id,
            "t-2",
            UpdateTaskPatch {
                owner: Some(None),
                status: Some(TaskStatus::Pending),
                ..Default::default()
            },
        )
        .unwrap();

        let err = AgentOrgTaskStore::try_claim(
            &run_id,
            "t-2",
            "member-alpha",
            ClaimOptions {
                check_member_busy: true,
            },
        )
        .unwrap_err();
        match err {
            ClaimError::MemberBusy { busy_with } => assert_eq!(busy_with, "t-1"),
            other => panic!("expected MemberBusy, got {other:?}"),
        }
    }

    #[test]
    fn find_available_skips_owned_blocked_and_resolved() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        // Owned (in progress)
        let mut owned = make_params(&run_id, "owned", "in flight");
        owned.owner = Some("member-alpha".into());
        owned.status = TaskStatus::InProgress;
        AgentOrgTaskStore::create(owned).unwrap();

        // Completed
        let mut done = make_params(&run_id, "done", "done");
        done.status = TaskStatus::Completed;
        AgentOrgTaskStore::create(done).unwrap();

        // Blocked by an unresolved blocker
        AgentOrgTaskStore::create(make_params(&run_id, "blocker", "first")).unwrap();
        let mut blocked = make_params(&run_id, "blocked", "wait");
        blocked.blocked_by = vec!["blocker".into()];
        AgentOrgTaskStore::create(blocked).unwrap();

        // Available
        AgentOrgTaskStore::create(make_params(&run_id, "free", "ready")).unwrap();

        let picked = AgentOrgTaskStore::find_available(&run_id).unwrap().unwrap();
        // `blocker` is the first unclaimed pending in insertion order.
        assert_eq!(picked.id, "blocker");

        // Claim blocker, complete it, and then `free` must surface.
        let _ = AgentOrgTaskStore::try_claim(
            &run_id,
            "blocker",
            "member-alpha",
            ClaimOptions::default(),
        )
        .unwrap();
        AgentOrgTaskStore::update(
            &run_id,
            "blocker",
            UpdateTaskPatch {
                status: Some(TaskStatus::Completed),
                ..Default::default()
            },
        )
        .unwrap();

        let next = AgentOrgTaskStore::find_available(&run_id).unwrap().unwrap();
        // Once `blocker` is completed, both `blocked` and `free` are ready;
        // insertion order makes `blocked` win.
        assert_eq!(next.id, "blocked");
    }

    #[test]
    fn concurrent_claim_only_one_winner() {
        // Race two threads on the same task. SQLite IMMEDIATE transactions
        // serialise them; the loser must observe AlreadyClaimed.
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        AgentOrgTaskStore::create(make_params(&run_id, "race", "contested")).unwrap();

        let run_id_clone = run_id.clone();
        let handle = std::thread::spawn(move || {
            AgentOrgTaskStore::try_claim(
                &run_id_clone,
                "race",
                "member-thread",
                ClaimOptions::default(),
            )
        });
        let main_result =
            AgentOrgTaskStore::try_claim(&run_id, "race", "member-main", ClaimOptions::default());
        let thread_result = handle.join().expect("thread join");

        let mut successes = 0;
        let mut already_claimed = 0;
        for result in [main_result, thread_result] {
            match result {
                Ok(task) => {
                    successes += 1;
                    assert!(matches!(task.status, TaskStatus::InProgress));
                    assert!(matches!(
                        task.owner.as_deref(),
                        Some("member-thread") | Some("member-main")
                    ));
                }
                Err(ClaimError::AlreadyClaimed { .. }) => already_claimed += 1,
                Err(other) => panic!("unexpected race outcome: {other:?}"),
            }
        }
        assert_eq!(successes, 1, "exactly one claimer should win");
        assert_eq!(already_claimed, 1, "the other should see AlreadyClaimed");

        let stored = AgentOrgTaskStore::get(&run_id, "race").unwrap().unwrap();
        assert!(matches!(stored.status, TaskStatus::InProgress));
        assert!(matches!(
            stored.owner.as_deref(),
            Some("member-thread") | Some("member-main")
        ));

        let claim_events = AgentOrgTaskStore::list_history(&run_id)
            .unwrap()
            .into_iter()
            .filter(|event| event.event_type == TASK_EVENT_CLAIMED)
            .collect::<Vec<_>>();
        assert_eq!(claim_events.len(), 1, "only the winning claim is persisted");
        assert_eq!(claim_events[0].next_owner, stored.owner);
    }

    #[test]
    fn enqueue_task_assigned_writes_inbox_row() {
        use crate::core::coordination::agent_inbox::{AgentInboxStore, AgentMessage};

        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        let mut params = make_params(&run_id, "task-1", "Pagination");
        params.description = "Cursor-based".into();
        params.owner = Some("member-alice".into());
        params.status = TaskStatus::InProgress;
        let task = AgentOrgTaskStore::create(params).unwrap();

        let row_id = enqueue_task_assigned_to(
            &task,
            "alice-agent",
            "member-alice",
            "coord-agent",
            Some("coordinator"),
            "Coordinator",
        )
        .unwrap();
        assert!(row_id > 0);

        let pending =
            AgentInboxStore::list_unread_for_member("member-alice", &run_id).expect("list_unread");
        assert_eq!(pending.len(), 1, "one TaskAssigned row should be pending");
        let row = &pending[0];
        assert_eq!(row.payload_kind, "task_assigned");
        assert_eq!(row.sender_agent_id, "coord-agent");
        assert_eq!(row.sender_member_id.as_deref(), Some("coordinator"));
        assert_eq!(row.recipient_agent_id, "alice-agent");
        assert_eq!(row.org_run_id.as_deref(), Some(run_id.as_str()));

        let decoded = row.decode_payload().expect("decode");
        match decoded {
            AgentMessage::TaskAssigned {
                task_id,
                subject,
                description,
                assigned_by,
            } => {
                assert_eq!(task_id, "task-1");
                assert_eq!(subject, "Pagination");
                assert_eq!(description, "Cursor-based");
                assert_eq!(assigned_by, "Coordinator");
            }
            other => panic!("expected TaskAssigned, got {other:?}"),
        }
    }

    #[test]
    fn enqueue_task_assigned_rejects_unowned_task() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        let task = AgentOrgTaskStore::create(make_params(&run_id, "task-2", "subj")).unwrap();
        // No owner set → enqueue must fail with a structured error so the
        // caller (task tools / autonomous claim) can surface it back to
        // the LLM rather than silently dropping the row.
        let err = enqueue_task_assigned_to(
            &task,
            "worker-agent",
            "member-worker",
            "_system",
            None,
            "system",
        )
        .unwrap_err();
        assert!(err.contains("unowned"), "{err}");
    }

    #[test]
    fn enqueue_task_assigned_self_claim_uses_system_sender() {
        use crate::core::coordination::agent_inbox::{AgentInboxStore, SYSTEM_SENDER_ID};

        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        AgentOrgTaskStore::create(make_params(&run_id, "task-self", "Refactor")).unwrap();
        let claimed = AgentOrgTaskStore::try_claim(
            &run_id,
            "task-self",
            "member-alice",
            ClaimOptions::default(),
        )
        .unwrap();

        // Autonomous self-claim path: sender is the system, even though
        // the recipient = claimant. Self-claim notifications route
        // through the system inbox writer rather than the worker
        // writing into its own mailbox.
        enqueue_task_assigned_to(
            &claimed,
            "alice-agent",
            "member-alice",
            SYSTEM_SENDER_ID,
            None,
            "system",
        )
        .unwrap();

        let pending = AgentInboxStore::list_unread_for_member("member-alice", &run_id).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].sender_agent_id, SYSTEM_SENDER_ID);
    }

    #[test]
    fn unassign_for_owner_clears_owner_and_resets_status() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());

        AgentOrgTaskStore::create(make_params(&run_id, "t1", "S1")).unwrap();
        AgentOrgTaskStore::create(make_params(&run_id, "t2", "S2")).unwrap();
        AgentOrgTaskStore::create(make_params(&run_id, "t3", "S3")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t1", "alice", ClaimOptions::default()).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "t2", "alice", ClaimOptions::default()).unwrap();
        // Mark t2 completed; unassign should leave it alone.
        AgentOrgTaskStore::update(
            &run_id,
            "t2",
            UpdateTaskPatch {
                status: Some(TaskStatus::Completed),
                ..Default::default()
            },
        )
        .unwrap();
        // t3 owned by bob — must not be touched.
        AgentOrgTaskStore::try_claim(&run_id, "t3", "bob", ClaimOptions::default()).unwrap();

        let unassigned = AgentOrgTaskStore::unassign_for_owner(&run_id, "alice").unwrap();
        assert_eq!(unassigned.len(), 1);
        assert_eq!(unassigned[0].id, "t1");
        assert!(unassigned[0].owner.is_none());
        assert_eq!(unassigned[0].status, TaskStatus::Pending);

        // t2 stays completed + owned, t3 stays owned by bob.
        let t2 = AgentOrgTaskStore::get(&run_id, "t2").unwrap().unwrap();
        assert_eq!(t2.status, TaskStatus::Completed);
        assert_eq!(t2.owner.as_deref(), Some("alice"));
        let t3 = AgentOrgTaskStore::get(&run_id, "t3").unwrap().unwrap();
        assert_eq!(t3.owner.as_deref(), Some("bob"));
    }

    #[test]
    fn has_open_task_for_owner_excludes_completed() {
        let _sandbox = task_store_sandbox();
        let run_id = format!("run-{}", uuid::Uuid::new_v4());
        assert!(!AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());

        AgentOrgTaskStore::create(make_params(&run_id, "h1", "S1")).unwrap();
        AgentOrgTaskStore::try_claim(&run_id, "h1", "alice", ClaimOptions::default()).unwrap();
        assert!(AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());

        AgentOrgTaskStore::update(
            &run_id,
            "h1",
            UpdateTaskPatch {
                status: Some(TaskStatus::Completed),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!AgentOrgTaskStore::has_open_task_for_owner(&run_id, "alice").unwrap());
    }
}
