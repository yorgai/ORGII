//! Per-round token usage persistence.
//!
//! Stores one row per chat round in `session_token_usage`.
//! Shared by code sessions and OS Agent sessions.

use chrono::Utc;
use rusqlite::{params, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use super::get_connection;

// ============================================
// Types
// ============================================

/// A single per-round token usage record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageRecord {
    pub id: i64,
    pub session_id: String,
    pub session_type: String,
    pub model: Option<String>,
    pub account_id: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_tokens: i64,
    /// Last LLM call's prompt tokens — represents actual context window fill level.
    pub context_tokens: i64,
    pub created_at: String,
}

// ============================================
// CRUD
// ============================================

/// Insert a single per-round token usage record.
///
/// `session_type` should be `"sde"` or `"os"`.
#[allow(clippy::too_many_arguments)]
pub fn insert_token_usage_record(
    session_id: &str,
    session_type: &str,
    model: Option<&str>,
    account_id: Option<&str>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    total_tokens: i64,
    context_tokens: i64,
) -> SqliteResult<i64> {
    let conn = get_connection()?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO session_token_usage
            (session_id, session_type, model, account_id,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
             total_tokens, context_tokens, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            session_id,
            session_type,
            model,
            account_id,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            total_tokens,
            context_tokens,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Get all per-round token usage records for a session, ordered by created_at.
pub fn get_token_usage_records(session_id: &str) -> SqliteResult<Vec<TokenUsageRecord>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT id, session_id, session_type, model, account_id,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                total_tokens, context_tokens, created_at
         FROM session_token_usage
         WHERE session_id = ?1
         ORDER BY created_at ASC",
    )?;
    let records = stmt
        .query_map([session_id], |row| {
            Ok(TokenUsageRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                session_type: row.get(2)?,
                model: row.get(3)?,
                account_id: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_tokens: row.get(9)?,
                context_tokens: row.get(10)?,
                created_at: row.get(11)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(records)
}

/// Delete all per-round token usage records for a session.
///
/// Called when a session is deleted to keep the table clean.
pub fn delete_token_usage_records(session_id: &str) -> SqliteResult<usize> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "DELETE FROM session_token_usage WHERE session_id = ?1",
        [session_id],
    )?;
    Ok(affected)
}
