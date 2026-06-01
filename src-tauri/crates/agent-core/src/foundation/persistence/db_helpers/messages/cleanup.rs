//! Image-aware deletion helpers for the `<prefix>_messages` table.
//!
//! Every public delete function here first walks the rows it is about
//! to remove and asks `images::delete_image_files` to drop the on-disk
//! payloads. Skipping the cleanup step would leak files in
//! `~/.orgii/...` because the DB row is the only reference back.

use rusqlite::{params, types::Type, OptionalExtension, Result as SqliteResult};

use crate::persistence::images;
use database::db::get_connection;

use super::super::message_role;

/// Collect image file paths from messages matching a WHERE clause, then delete
/// the corresponding files from disk. Called before deleting the DB rows.
pub(super) fn cleanup_image_files_for_query(
    prefix: &str,
    where_clause: &str,
    params: &[&dyn rusqlite::ToSql],
) -> SqliteResult<()> {
    let conn = get_connection()?;
    let sql =
        format!("SELECT images FROM {prefix}_messages WHERE {where_clause} AND images IS NOT NULL");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |row| row.get::<_, String>(0))?;
    let mut paths = Vec::new();

    for row in rows {
        let json_str = row?;
        let image_paths: Vec<String> = serde_json::from_str(&json_str).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(err))
        })?;
        paths.extend(
            image_paths
                .into_iter()
                .filter(|path| !path.starts_with("data:")),
        );
    }

    if !paths.is_empty() {
        images::delete_image_files(&paths);
    }

    Ok(())
}

/// Delete all messages for a session.
/// Also cleans up any image files referenced by the deleted messages.
pub fn clear_messages(prefix: &str, session_id: &str) -> SqliteResult<i64> {
    cleanup_image_files_for_query(prefix, "session_id = ?1", &[&session_id])?;
    let conn = get_connection()?;
    let sql = format!("DELETE FROM {prefix}_messages WHERE session_id = ?1");
    let deleted = conn.execute(&sql, [session_id])?;
    Ok(deleted as i64)
}

/// Delete messages at or after a specific timestamp.
/// Also cleans up any image files referenced by the deleted messages.
pub fn truncate_messages_after(
    prefix: &str,
    session_id: &str,
    created_at: &str,
) -> SqliteResult<i64> {
    cleanup_image_files_for_query(
        prefix,
        "session_id = ?1 AND created_at >= ?2",
        &[&session_id as &dyn rusqlite::ToSql, &created_at],
    )?;
    let conn = get_connection()?;
    let sql = format!("DELETE FROM {prefix}_messages WHERE session_id = ?1 AND created_at >= ?2");
    let deleted = conn.execute(&sql, params![session_id, created_at])?;
    Ok(deleted as i64)
}

/// Delete the last user message and every message that came after it
/// (assistant, tool_call, tool_result — anything with a higher sequence).
///
/// Used by the "cancel before any assistant output" rollback path so a
/// cancelled-before-start turn leaves no residue in LLM history.
///
/// Returns the number of rows removed (0 if there is no user message in
/// this session).
pub fn delete_last_user_turn(prefix: &str, session_id: &str) -> SqliteResult<i64> {
    let conn = get_connection()?;

    // Locate the highest sequence belonging to a user message.
    let sql_find = format!(
        "SELECT sequence FROM {prefix}_messages
         WHERE session_id = ?1 AND role = ?2
         ORDER BY sequence DESC LIMIT 1",
    );
    let last_user_seq: Option<i64> = conn
        .query_row(&sql_find, params![session_id, message_role::USER], |row| {
            row.get(0)
        })
        .optional()?;

    let Some(seq) = last_user_seq else {
        return Ok(0);
    };

    cleanup_image_files_for_query(
        prefix,
        "session_id = ?1 AND sequence >= ?2",
        &[&session_id as &dyn rusqlite::ToSql, &seq],
    )?;
    let sql_delete =
        format!("DELETE FROM {prefix}_messages WHERE session_id = ?1 AND sequence >= ?2");
    let deleted = conn.execute(&sql_delete, params![session_id, seq])?;
    Ok(deleted as i64)
}
