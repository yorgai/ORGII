//! Todo persistence layer.
//!
//! Stores per-session todo lists in the `agent_todos` table. Used by the
//! `manage_todo` tool and the `coding` session command surface.
//!
//! Schema (one row per todo, ordered by `position`):
//!
//! - `session_id` — owning session
//! - `position`   — 0-based index inside the list
//! - `content`    — task description
//! - `active_form` — present-continuous spinner label shown while the todo
//!   is `in_progress` (e.g. "Running tests")
//! - `status` / `priority` — free-form strings (semantics owned by the tool)
//! - `blocked_by` — JSON array of positions that must be `completed` first
//!
//! This module owns its own table and is intentionally decoupled from
//! message persistence — they share only the connection helper, not data.

use rusqlite::{params, Result as SqliteResult};

use database::db::get_connection;

/// One todo row.
///
/// - `active_form`: present-continuous spinner label rendered while the todo
///   is `in_progress` (e.g. "Running tests"). `None` means the UI falls back
///   to `content`.
/// - `blocked_by`: indices (0-based positions) of tasks that must be
///   `completed` before this one is considered "ready". Empty vec = no
///   blockers. Stored as a JSON array in the DB column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoRecord {
    pub content: String,
    pub active_form: Option<String>,
    pub status: String,
    pub priority: String,
    /// Positions of blocking tasks. Serialized to/from JSON `'[]'` in DB.
    pub blocked_by: Vec<usize>,
}

/// Partial update applied by `update_todo` — any `None` field is left
/// untouched. Used by `manage_todo` action=update so callers can flip one
/// status without re-sending the full list (a full bulk replace goes through
/// `save_todos` instead).
#[derive(Debug, Clone, Default)]
pub struct TodoUpdate {
    pub content: Option<String>,
    pub active_form: Option<Option<String>>,
    pub status: Option<String>,
    pub priority: Option<String>,
    /// Replace the blocked_by list. `None` = leave unchanged.
    pub blocked_by: Option<Vec<usize>>,
}

/// Serialize a `blocked_by` vec to the compact JSON stored in the DB.
///
/// `Vec<usize>` serialization is infallible for any in-memory value, so this
/// returns `String` directly; the previous `unwrap_or_else` shim hid that
/// invariant.
fn blocked_by_to_json(v: &[usize]) -> String {
    serde_json::to_string(v).expect("Vec<usize> serialization is infallible")
}

/// Deserialize the `blocked_by` JSON column.
///
/// - Empty / NULL column → `Ok(vec![])` (legacy rows + freshly inserted
///   defaults).
/// - Non-empty but invalid JSON → `Err`. This surfaces row corruption rather
///   than silently turning a "blocked by foo" todo into an unblocked one.
fn blocked_by_from_json(s: &str) -> Result<Vec<usize>, serde_json::Error> {
    if s.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(s)
}

pub fn save_todos(session_id: &str, todos: &[TodoRecord]) -> SqliteResult<()> {
    let conn = get_connection()?;
    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "DELETE FROM agent_todos WHERE session_id = ?1",
        [session_id],
    )?;
    for (position, todo) in todos.iter().enumerate() {
        conn.execute(
            "INSERT INTO agent_todos
                 (session_id, content, active_form, status, priority, position, blocked_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session_id,
                todo.content,
                todo.active_form,
                todo.status,
                todo.priority,
                position as i64,
                blocked_by_to_json(&todo.blocked_by),
            ],
        )?;
    }
    tx.commit()
}

pub fn get_todos(session_id: &str) -> SqliteResult<Vec<TodoRecord>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT content, active_form, status, priority, blocked_by
         FROM agent_todos
         WHERE session_id = ?1
         ORDER BY position ASC",
    )?;
    let rows = stmt
        .query_map([session_id], |row| {
            let blocked_raw: String = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let blocked_by = blocked_by_from_json(&blocked_raw).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })?;
            Ok(TodoRecord {
                content: row.get(0)?,
                active_form: row.get(1)?,
                status: row.get(2)?,
                priority: row.get(3)?,
                blocked_by,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

/// Apply a partial update to a single todo identified by position (0-based).
/// Returns whether the row existed. Does NOT shift positions — use
/// `save_todos` for insert/delete semantics.
pub fn update_todo(session_id: &str, position: usize, patch: &TodoUpdate) -> SqliteResult<bool> {
    let conn = get_connection()?;

    let mut fragments: Vec<&str> = Vec::new();
    let mut bindings: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(content) = &patch.content {
        fragments.push("content = ?");
        bindings.push(Box::new(content.clone()));
    }
    if let Some(active_form) = &patch.active_form {
        fragments.push("active_form = ?");
        bindings.push(Box::new(active_form.clone()));
    }
    if let Some(status) = &patch.status {
        fragments.push("status = ?");
        bindings.push(Box::new(status.clone()));
    }
    if let Some(priority) = &patch.priority {
        fragments.push("priority = ?");
        bindings.push(Box::new(priority.clone()));
    }
    if let Some(blocked_by) = &patch.blocked_by {
        fragments.push("blocked_by = ?");
        bindings.push(Box::new(blocked_by_to_json(blocked_by)));
    }

    if fragments.is_empty() {
        // Nothing to update; treat as a no-op but confirm the row exists so
        // the tool can still report accurate success/not-found to the LLM.
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agent_todos WHERE session_id = ?1 AND position = ?2",
            params![session_id, position as i64],
            |row| row.get(0),
        )?;
        return Ok(exists > 0);
    }

    let sql = format!(
        "UPDATE agent_todos SET {} WHERE session_id = ? AND position = ?",
        fragments.join(", ")
    );
    bindings.push(Box::new(session_id.to_string()));
    bindings.push(Box::new(position as i64));

    let param_refs: Vec<&dyn rusqlite::ToSql> = bindings.iter().map(|b| b.as_ref()).collect();
    let changed = conn.execute(&sql, param_refs.as_slice())?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::{blocked_by_from_json, blocked_by_to_json};

    #[test]
    fn blocked_by_to_json_round_trips() {
        let v = vec![0usize, 2, 5];
        let json = blocked_by_to_json(&v);
        assert_eq!(json, "[0,2,5]");
        assert_eq!(blocked_by_from_json(&json).expect("valid"), v);
    }

    #[test]
    fn blocked_by_from_json_empty_string_is_empty_vec() {
        let result = blocked_by_from_json("").expect("empty string is empty vec");
        assert!(result.is_empty());
    }

    #[test]
    fn blocked_by_from_json_invalid_json_is_err() {
        let err = blocked_by_from_json("{ invalid").unwrap_err();
        let message = err.to_string();
        assert!(
            message.contains("expected") || message.contains("invalid"),
            "expected serde error message, got: {message}"
        );
    }

    #[test]
    fn blocked_by_from_json_wrong_shape_is_err() {
        // A JSON object instead of an array of integers is the realistic
        // corruption mode for this column.
        let err = blocked_by_from_json("{\"foo\": 1}").unwrap_err();
        let _ = err.to_string();
    }
}
