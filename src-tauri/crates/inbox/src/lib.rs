//! Inbox Module
//!
//! Persists inbox messages (notifications, git events, promotions, work items)
//! in the shared SQLite database (`~/.orgii/sessions.db`).
//!
//! ## Components
//!
//! - `persistence` — SQLite CRUD for `inbox_messages` table
//! - `commands` — Tauri commands exposed to the frontend

pub mod commands;
pub mod persistence;

use rusqlite::{Connection, Result as SqliteResult};

/// Initialize inbox tables in the shared database.
///
/// Called from `session::cache::get_connection()` alongside other table inits.
pub fn init_inbox_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS inbox_messages (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            preview     TEXT NOT NULL DEFAULT '',
            content     TEXT NOT NULL DEFAULT '',
            category    TEXT NOT NULL DEFAULT 'git',
            priority    TEXT NOT NULL DEFAULT 'none',
            status      TEXT NOT NULL DEFAULT 'unread',
            sender_name TEXT,
            metadata    TEXT NOT NULL DEFAULT '{}',
            labels      TEXT NOT NULL DEFAULT '[]',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox_messages(status);
        CREATE INDEX IF NOT EXISTS idx_inbox_category ON inbox_messages(category);
        CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages(created_at);",
    )?;
    Ok(())
}
