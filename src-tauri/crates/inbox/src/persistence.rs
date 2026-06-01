//! SQLite persistence for inbox messages.

use chrono::Utc;
use rusqlite::{params, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use database::db::get_connection;

// ============================================
// Types
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxMessage {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub content: String,
    pub category: String,
    pub priority: String,
    pub status: String,
    pub sender_name: Option<String>,
    /// JSON string of metadata object
    pub metadata: String,
    /// JSON string of labels array
    pub labels: String,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================
// CRUD
// ============================================

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Insert or update an inbox message, preserving existing read/unread status.
pub fn upsert_message(msg: &InboxMessage) -> SqliteResult<()> {
    let conn = get_connection()?;
    conn.execute(
        "INSERT INTO inbox_messages
            (id, title, preview, content, category, priority, status,
             sender_name, metadata, labels, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            preview = excluded.preview,
            content = excluded.content,
            category = excluded.category,
            priority = excluded.priority,
            sender_name = excluded.sender_name,
            metadata = excluded.metadata,
            labels = excluded.labels,
            updated_at = excluded.updated_at",
        params![
            msg.id,
            msg.title,
            msg.preview,
            msg.content,
            msg.category,
            msg.priority,
            msg.status,
            msg.sender_name,
            msg.metadata,
            msg.labels,
            msg.created_at,
            now_iso(),
        ],
    )?;
    Ok(())
}

/// List all inbox messages, newest first. Capped at 200.
pub fn list_messages() -> SqliteResult<Vec<InboxMessage>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT id, title, preview, content, category, priority, status,
                sender_name, metadata, labels, created_at, updated_at
         FROM inbox_messages
         ORDER BY created_at DESC
         LIMIT 200",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(InboxMessage {
            id: row.get(0)?,
            title: row.get(1)?,
            preview: row.get(2)?,
            content: row.get(3)?,
            category: row.get(4)?,
            priority: row.get(5)?,
            status: row.get(6)?,
            sender_name: row.get(7)?,
            metadata: row.get(8)?,
            labels: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;

    rows.collect()
}

/// Update the status of a message (read, archived, etc.).
pub fn update_status(id: &str, status: &str) -> SqliteResult<()> {
    let conn = get_connection()?;
    conn.execute(
        "UPDATE inbox_messages SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, now_iso()],
    )?;
    Ok(())
}

/// Delete a message by ID.
pub fn delete_message(id: &str) -> SqliteResult<()> {
    let conn = get_connection()?;
    conn.execute("DELETE FROM inbox_messages WHERE id = ?1", params![id])?;
    Ok(())
}

/// Delete all messages with a given status (e.g., purge archived).
pub fn delete_by_status(status: &str) -> SqliteResult<usize> {
    let conn = get_connection()?;
    let count = conn.execute(
        "DELETE FROM inbox_messages WHERE status = ?1",
        params![status],
    )?;
    Ok(count)
}
