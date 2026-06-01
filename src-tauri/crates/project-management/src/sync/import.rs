//! Bulk historical import bookkeeping + DB I/O.
//!
//! The import_progress table holds one row per
//! `(project_slug, adapter_id)` capturing where the worker's
//! background import loop is in its paginated walk of the remote's
//! full history. This module owns the row's lifecycle:
//!
//! - [`ensure_pending`] — create the row on attach (no-op when one
//!   already exists, including terminal rows so re-attach doesn't
//!   re-import).
//! - [`read_status`] — read the current row for the UI status panel.
//! - [`advance`] — bump cursor + counter after a page applied.
//! - [`mark_completed`] / [`mark_failed`] / [`mark_cancelled`] —
//!   terminal-state writers.
//! - [`list_runnable`] — worker scheduler: rows in `pending` /
//!   `running` state that the import loop should process.
//! - [`reset_for_retry`] — moves a `failed` row back to `pending`
//!   so the user-facing "retry" button has a place to go.
//!
//! Kept separate from `webhook_secrets` / `outbox` because the
//! lifecycle (pending → running → terminal) and the row shape are
//! distinct enough that conflating them would obscure intent.

use rusqlite::{params, Connection, OptionalExtension};

use super::types::ImportState;

/// Wire shape for the UI status panel.
///
/// Mirror of the table row except `state` is the typed enum and
/// `last_error` is `None` unless `state == Failed`. Returned by
/// [`read_status`] and surfaced through the
/// `project_sync_import_status` Tauri command.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportProgressRow {
    pub project_slug: String,
    pub adapter_id: String,
    pub state: ImportState,
    /// Adapter-defined opaque cursor for the **next** page to fetch.
    /// `None` when the import hasn't started yet (state = Pending) or
    /// has finished (state = Completed; cursor is exhausted).
    pub page_cursor: Option<String>,
    /// Number of [`super::adapter::ExternalChange`] rows successfully
    /// applied so far. Counts entities, not bytes — matches the
    /// "47 / 200" UI presentation.
    pub imported_count: u64,
    /// Total entity count the adapter advertised on the first page,
    /// when known. `None` when the adapter doesn't surface a count.
    pub total_hint: Option<u64>,
    /// Unix-epoch ms of the row's creation. Survives state transitions
    /// so the UI can show "import started 12 minutes ago" even after
    /// the import completes.
    pub started_at: i64,
    /// Unix-epoch ms of the most recent row mutation (page applied,
    /// state flipped, cancel acknowledged). Drives the freshness
    /// indicator in the UI.
    pub updated_at: i64,
    /// Permanent-failure message; `None` unless `state == Failed`.
    pub last_error: Option<String>,
}

/// Idempotent: insert a `pending` row for the project ↔ adapter pair
/// when none exists. Returns `Ok(true)` when a fresh row was created,
/// `Ok(false)` when a row already existed (regardless of state).
///
/// The "regardless of state" rule is intentional: a project that
/// previously completed an import and is now being re-attached
/// SHOULD NOT re-import — the local store already holds the entities
/// and the user's changes take priority. The user-facing "force a
/// fresh import" path is [`reset_for_retry`], which gates on
/// `Failed` only.
pub fn ensure_pending(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    now_ms: i64,
) -> Result<bool, String> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM import_progress
              WHERE project_slug = ?1 AND adapter_id = ?2",
            params![project_slug, adapter_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|err| format!("DB error (ensure_pending exists): {}", err))?;
    if existing.is_some() {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO import_progress
           (project_slug, adapter_id, state, page_cursor, imported_count,
            total_hint, started_at, updated_at, last_error)
         VALUES (?1, ?2, 'pending', NULL, 0, NULL, ?3, ?3, NULL)",
        params![project_slug, adapter_id, now_ms],
    )
    .map_err(|err| format!("DB error (ensure_pending insert): {}", err))?;
    Ok(true)
}

/// Read the row for `(slug, adapter_id)`, or `Ok(None)` when no row
/// exists yet (project hasn't attached this adapter, or the adapter
/// doesn't support import).
pub fn read_status(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
) -> Result<Option<ImportProgressRow>, String> {
    let row = conn
        .query_row(
            "SELECT project_slug, adapter_id, state, page_cursor,
                    imported_count, total_hint, started_at, updated_at,
                    last_error
               FROM import_progress
              WHERE project_slug = ?1 AND adapter_id = ?2",
            params![project_slug, adapter_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()
        .map_err(|err| format!("DB error (read_status): {}", err))?;
    match row {
        None => Ok(None),
        Some((slug, adapter, state, cursor, imported, total, started, updated, err)) => {
            Ok(Some(ImportProgressRow {
                project_slug: slug,
                adapter_id: adapter,
                state: ImportState::from_db_str(&state)?,
                page_cursor: cursor,
                imported_count: imported.max(0) as u64,
                total_hint: total.map(|v| v.max(0) as u64),
                started_at: started,
                updated_at: updated,
                last_error: err,
            }))
        }
    }
}

/// Advance the row after one page applied: bump `imported_count`,
/// update `page_cursor`, set `total_hint` (only if currently `NULL`
/// and the caller has a fresh value — keeps the first-page hint
/// stable), promote `state` from `pending` → `running`.
pub fn advance(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    next_cursor: Option<&str>,
    delta_count: u64,
    total_hint: Option<u64>,
    now_ms: i64,
) -> Result<(), String> {
    // Promotion to `running` is only meaningful from `pending`; from
    // `running` it's a no-op. Terminal states (completed / cancelled
    // / failed) must not be advanced — surface as an error so a
    // double-completion bug doesn't silently overwrite the row.
    let current = read_status(conn, project_slug, adapter_id)?
        .ok_or_else(|| format!("import_progress row missing for ({project_slug}, {adapter_id})"))?;
    if current.state.is_terminal() {
        return Err(format!(
            "cannot advance import_progress in terminal state {:?}",
            current.state
        ));
    }
    let total_to_write = current.total_hint.or(total_hint);
    let imported = current.imported_count.saturating_add(delta_count) as i64;
    conn.execute(
        "UPDATE import_progress
            SET state = 'running',
                page_cursor = ?3,
                imported_count = ?4,
                total_hint = ?5,
                updated_at = ?6,
                last_error = NULL
          WHERE project_slug = ?1 AND adapter_id = ?2",
        params![
            project_slug,
            adapter_id,
            next_cursor,
            imported,
            total_to_write.map(|v| v as i64),
            now_ms,
        ],
    )
    .map_err(|err| format!("DB error (advance): {}", err))?;
    Ok(())
}

/// Stamp the row as `completed`. Idempotent against a row already in
/// `completed` state.
pub fn mark_completed(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    now_ms: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE import_progress
            SET state = 'completed',
                page_cursor = NULL,
                updated_at = ?3,
                last_error = NULL
          WHERE project_slug = ?1 AND adapter_id = ?2",
        params![project_slug, adapter_id, now_ms],
    )
    .map_err(|err| format!("DB error (mark_completed): {}", err))?;
    Ok(())
}

/// Stamp the row as `failed` with the error message. Cursor is
/// preserved so a retry resumes from the same page.
pub fn mark_failed(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    error: &str,
    now_ms: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE import_progress
            SET state = 'failed',
                last_error = ?3,
                updated_at = ?4
          WHERE project_slug = ?1 AND adapter_id = ?2",
        params![project_slug, adapter_id, error, now_ms],
    )
    .map_err(|err| format!("DB error (mark_failed): {}", err))?;
    Ok(())
}

/// Stamp the row as `cancelled`. Cursor is preserved, but no retry
/// path in v1 — the `cancelled` state is final by user choice.
pub fn mark_cancelled(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    now_ms: i64,
) -> Result<(), String> {
    conn.execute(
        "UPDATE import_progress
            SET state = 'cancelled',
                updated_at = ?3,
                last_error = NULL
          WHERE project_slug = ?1 AND adapter_id = ?2",
        params![project_slug, adapter_id, now_ms],
    )
    .map_err(|err| format!("DB error (mark_cancelled): {}", err))?;
    Ok(())
}

/// Reset a `failed` row to `pending` so the import loop picks it up
/// again. Cursor stays intact — the retry resumes mid-stream. Returns
/// `Ok(true)` when a row was actually transitioned, `Ok(false)` when
/// the current state isn't `Failed` (no-op; the UI shouldn't be
/// offering "retry" in that state, but be defensive).
pub fn reset_for_retry(
    conn: &Connection,
    project_slug: &str,
    adapter_id: &str,
    now_ms: i64,
) -> Result<bool, String> {
    let updated = conn
        .execute(
            "UPDATE import_progress
                SET state = 'pending',
                    last_error = NULL,
                    updated_at = ?3
              WHERE project_slug = ?1
                AND adapter_id = ?2
                AND state = 'failed'",
            params![project_slug, adapter_id, now_ms],
        )
        .map_err(|err| format!("DB error (reset_for_retry): {}", err))?;
    Ok(updated > 0)
}

/// Worker scheduler view: every row in `pending` or `running` state
/// that the import loop should process this tick. Ordered by
/// `updated_at ASC` so older work doesn't starve under load.
pub fn list_runnable(conn: &Connection) -> Result<Vec<ImportProgressRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT project_slug, adapter_id, state, page_cursor,
                    imported_count, total_hint, started_at, updated_at,
                    last_error
               FROM import_progress
              WHERE state IN ('pending', 'running')
           ORDER BY updated_at ASC",
        )
        .map_err(|err| format!("DB error (list_runnable prepare): {}", err))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|err| format!("DB error (list_runnable query): {}", err))?;
    let mut out = Vec::new();
    for row in rows {
        let (slug, adapter, state, cursor, imported, total, started, updated, err) =
            row.map_err(|err| format!("DB error (list_runnable row): {}", err))?;
        out.push(ImportProgressRow {
            project_slug: slug,
            adapter_id: adapter,
            state: ImportState::from_db_str(&state)?,
            page_cursor: cursor,
            imported_count: imported.max(0) as u64,
            total_hint: total.map(|v| v.max(0) as u64),
            started_at: started,
            updated_at: updated,
            last_error: err,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::schema::init_import_progress_table;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_import_progress_table(&conn).unwrap();
        conn
    }

    #[test]
    fn ensure_pending_creates_then_skips() {
        let c = fresh_db();
        assert!(ensure_pending(&c, "alpha", "echo", 100).unwrap());
        assert!(!ensure_pending(&c, "alpha", "echo", 200).unwrap());
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.state, ImportState::Pending);
        assert_eq!(row.imported_count, 0);
        assert_eq!(row.started_at, 100);
        assert_eq!(row.updated_at, 100); // second call is a no-op
    }

    #[test]
    fn read_status_returns_none_when_absent() {
        let c = fresh_db();
        assert!(read_status(&c, "alpha", "echo").unwrap().is_none());
    }

    #[test]
    fn advance_promotes_pending_to_running_and_bumps_counter() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        advance(&c, "alpha", "echo", Some("cur1"), 5, Some(100), 200).unwrap();
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.state, ImportState::Running);
        assert_eq!(row.imported_count, 5);
        assert_eq!(row.page_cursor.as_deref(), Some("cur1"));
        assert_eq!(row.total_hint, Some(100));
        assert_eq!(row.updated_at, 200);
    }

    #[test]
    fn advance_keeps_first_page_total_hint_stable() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        advance(&c, "alpha", "echo", Some("cur1"), 5, Some(100), 200).unwrap();
        // Subsequent page advances must NOT overwrite the original
        // `total_hint` — adapters may report different totals on
        // different pages and we want the first-page snapshot.
        advance(&c, "alpha", "echo", Some("cur2"), 5, Some(80), 300).unwrap();
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.total_hint, Some(100));
        assert_eq!(row.imported_count, 10);
    }

    #[test]
    fn advance_rejects_terminal_state() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        mark_completed(&c, "alpha", "echo", 200).unwrap();
        let err = advance(&c, "alpha", "echo", None, 1, None, 300).unwrap_err();
        assert!(err.contains("terminal state"), "got: {err}");
    }

    #[test]
    fn mark_completed_clears_cursor() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        advance(&c, "alpha", "echo", Some("cur1"), 5, None, 200).unwrap();
        mark_completed(&c, "alpha", "echo", 300).unwrap();
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.state, ImportState::Completed);
        assert!(row.page_cursor.is_none());
    }

    #[test]
    fn mark_failed_preserves_cursor_and_records_error() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        advance(&c, "alpha", "echo", Some("cur1"), 5, None, 200).unwrap();
        mark_failed(&c, "alpha", "echo", "auth bounced", 300).unwrap();
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.state, ImportState::Failed);
        assert_eq!(row.page_cursor.as_deref(), Some("cur1"));
        assert_eq!(row.last_error.as_deref(), Some("auth bounced"));
    }

    #[test]
    fn reset_for_retry_only_works_on_failed_rows() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        // Pending row: reset is a no-op.
        assert!(!reset_for_retry(&c, "alpha", "echo", 200).unwrap());

        mark_failed(&c, "alpha", "echo", "boom", 300).unwrap();
        assert!(reset_for_retry(&c, "alpha", "echo", 400).unwrap());
        let row = read_status(&c, "alpha", "echo").unwrap().unwrap();
        assert_eq!(row.state, ImportState::Pending);
        assert!(row.last_error.is_none());
    }

    #[test]
    fn list_runnable_excludes_terminal_states() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        ensure_pending(&c, "beta", "echo", 110).unwrap();
        ensure_pending(&c, "gamma", "echo", 120).unwrap();
        ensure_pending(&c, "delta", "echo", 130).unwrap();
        mark_completed(&c, "beta", "echo", 200).unwrap();
        mark_failed(&c, "gamma", "echo", "x", 210).unwrap();
        mark_cancelled(&c, "delta", "echo", 220).unwrap();
        advance(&c, "alpha", "echo", Some("cur"), 1, None, 300).unwrap();

        let runnable = list_runnable(&c).unwrap();
        assert_eq!(runnable.len(), 1);
        assert_eq!(runnable[0].project_slug, "alpha");
        assert_eq!(runnable[0].state, ImportState::Running);
    }

    #[test]
    fn list_runnable_orders_oldest_first() {
        let c = fresh_db();
        ensure_pending(&c, "alpha", "echo", 100).unwrap();
        ensure_pending(&c, "beta", "echo", 110).unwrap();
        // Bump `alpha` so its updated_at is newer.
        advance(&c, "alpha", "echo", None, 1, None, 500).unwrap();
        let runnable = list_runnable(&c).unwrap();
        assert_eq!(runnable[0].project_slug, "beta");
        assert_eq!(runnable[1].project_slug, "alpha");
    }
}
