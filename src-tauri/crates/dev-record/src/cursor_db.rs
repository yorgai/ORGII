//! Cursor DB Scanner
//!
//! Reads Cursor's internal `state.vscdb` SQLite database (read-only) to extract
//! AI session history — chat/agent sessions with name, model, lines changed, etc.
//!
//! DB location: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
//! Table: `cursorDiskKV` (key TEXT, value BLOB)
//! Relevant keys: `composerData:{uuid}` — JSON blobs with session metadata
//!
//! ## Caching
//!
//! Parsed sessions are cached in our own `sessions.db` (`cursor_session_cache`
//! table). On each query we delta-sync: only parse composerData blobs for
//! sessions that are new, active, or recently terminal.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::TimeZone;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use database::db::get_connection;

static LAST_SYNC: Mutex<Option<SyncSnapshot>> = Mutex::new(None);
const SYNC_COOLDOWN: Duration = Duration::from_secs(60);
const RECENT_TERMINAL_RESYNC_WINDOW: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const TERMINAL_STATUSES: &[&str] = &["completed", "aborted", "cancelled", "failed"];

#[derive(Debug, Clone, Copy)]
struct SyncSnapshot {
    synced_at: Instant,
    cursor_db_modified_at: Option<SystemTime>,
}

// ============================================
// Deserialization types (Cursor's state.vscdb)
// ============================================

const COMPOSER_KEY_PREFIX: &str = "composerData:";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawComposerData {
    #[serde(default)]
    composer_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    last_updated_at: i64,
    #[serde(default)]
    status: String,
    #[serde(default)]
    is_agentic: bool,
    #[serde(default)]
    unified_mode: String,
    #[serde(default)]
    model_config: Option<ModelConfig>,
    #[serde(default)]
    total_lines_added: i64,
    #[serde(default)]
    total_lines_removed: i64,
    #[serde(default)]
    files_changed_count: i64,
    #[serde(default)]
    context_tokens_used: f64,
    #[serde(default)]
    full_conversation_headers_only: Vec<BubbleHeader>,
    /// Set on subagent composers spawned by `task_v2`. Their parent surfaces
    /// them inline via the Subagent block, so we never want them to appear
    /// in the sidebar / dev record list as standalone sessions. Treated as
    /// opaque — we only check presence.
    #[serde(default)]
    subagent_info: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BubbleHeader {
    #[serde(default)]
    bubble_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BubbleTimestamp {
    #[serde(default)]
    created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfig {
    #[serde(default)]
    model_name: String,
}

// ============================================
// Public type returned to frontend
// ============================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorSession {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub last_active_at: i64,
    pub status: String,
    pub is_agentic: bool,
    pub mode: String,
    pub model: String,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub files_changed: i64,
    pub tokens_used: i64,
}

// ============================================
// Public API
// ============================================

/// Query cursor sessions within a date range.
///
/// 1. Delta-syncs from Cursor's state.vscdb into our cache
/// 2. Queries the cache for the requested date range
pub fn get_cursor_sessions(start_date: &str, end_date: &str) -> Result<Vec<CursorSession>, String> {
    let cache_conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;

    delta_sync(&cache_conn)?;

    query_cache(&cache_conn, start_date, end_date)
}

/// Paginated session list for the sidebar, ordered most-recent-first.
///
/// Shares the same delta-sync + cache pipeline as `get_cursor_sessions` so
/// the sidebar's first call and the Dev Record's date-range queries both
/// benefit from the same warm cache. Returns `(sessions, has_more)` where
/// `has_more` indicates whether a `(limit, offset+limit)` follow-up call
/// would yield additional rows — used by the frontend's per-category
/// pagination state to decide whether to render a "Load more" row.
///
/// Subagent composers are filtered out at write time inside
/// `parse_sessions_by_ids`, so the cache is already subagent-free by the
/// time it's read here.
pub fn list_for_sidebar(limit: usize, offset: usize) -> Result<(Vec<CursorSession>, bool), String> {
    list_for_sidebar_filtered(limit, offset, |_| Ok(true))
}

pub fn list_for_sidebar_filtered<F>(
    limit: usize,
    offset: usize,
    mut include: F,
) -> Result<(Vec<CursorSession>, bool), String>
where
    F: FnMut(&CursorSession) -> Result<bool, String>,
{
    let cache_conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;

    delta_sync(&cache_conn)?;

    let sessions = query_cache_for_sidebar(&cache_conn)?;
    let mut matched = Vec::with_capacity(limit.saturating_add(1));
    let mut skipped = 0usize;

    for session in sessions {
        if !include(&session)? {
            continue;
        }
        if skipped < offset {
            skipped += 1;
            continue;
        }
        matched.push(session);
        if matched.len() > limit {
            break;
        }
    }

    let has_more = matched.len() > limit;
    if has_more {
        matched.truncate(limit);
    }
    Ok((matched, has_more))
}

// ============================================
// Delta sync
// ============================================

/// Sync new/changed sessions from Cursor's DB into our cache.
///
/// Strategy:
/// 1. Scan all `composerData:*` **keys** (cheap — no value blobs)
/// 2. Compare against cached IDs; skip sessions already cached as "completed"
/// 3. Fetch + parse values only for new and still-active sessions
/// 4. Upsert into cache
fn delta_sync(cache_conn: &Connection) -> Result<(), String> {
    let now = Instant::now();
    let cursor_path = match cursor_db_path() {
        Some(path) => path,
        None => return Ok(()),
    };
    let cursor_db_modified_at = cursor_path
        .metadata()
        .and_then(|metadata| metadata.modified())
        .ok();

    if let Ok(guard) = LAST_SYNC.lock() {
        if let Some(last) = *guard {
            if now.duration_since(last.synced_at) < SYNC_COOLDOWN
                && last.cursor_db_modified_at == cursor_db_modified_at
            {
                return Ok(());
            }
        }
    }

    let cursor_conn = Connection::open_with_flags(&cursor_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("Failed to open Cursor DB: {}", err))?;

    let old_terminal_ids = get_old_terminal_cached_ids(cache_conn)?;

    let all_keys = get_all_composer_keys(&cursor_conn)?;

    let ids_to_sync: Vec<String> = all_keys
        .iter()
        .filter(|id| !old_terminal_ids.contains(*id))
        .cloned()
        .collect();

    if ids_to_sync.is_empty() {
        update_sync_snapshot(now, cursor_db_modified_at);
        return Ok(());
    }

    let sessions = parse_sessions_by_ids(&cursor_conn, &ids_to_sync)?;

    upsert_cache(cache_conn, &sessions)?;
    update_sync_snapshot(now, cursor_db_modified_at);

    Ok(())
}

fn update_sync_snapshot(synced_at: Instant, cursor_db_modified_at: Option<SystemTime>) {
    if let Ok(mut guard) = LAST_SYNC.lock() {
        *guard = Some(SyncSnapshot {
            synced_at,
            cursor_db_modified_at,
        });
    }
}

fn get_old_terminal_cached_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("System time is before Unix epoch: {}", err))?
        .as_millis() as i64;
    let cutoff_ms = now_ms - RECENT_TERMINAL_RESYNC_WINDOW.as_millis() as i64;

    let status_placeholders = TERMINAL_STATUSES
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT id FROM cursor_session_cache WHERE status IN ({}) AND last_active_at < ?",
        status_placeholders
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|err| format!("Failed to query cache: {}", err))?;

    let params_iter = TERMINAL_STATUSES
        .iter()
        .map(|status| rusqlite::types::Value::from((*status).to_string()))
        .chain(std::iter::once(rusqlite::types::Value::from(cutoff_ms)));
    let ids = stmt
        .query_map(rusqlite::params_from_iter(params_iter), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|err| format!("Failed to read cache: {}", err))?
        .filter_map(|row_result| row_result.ok())
        .collect();

    Ok(ids)
}

/// Scan Cursor's DB for all composerData keys, returning the extracted IDs.
fn get_all_composer_keys(cursor_conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = cursor_conn
        .prepare("SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .map_err(|err| format!("Failed to query Cursor DB keys: {}", err))?;

    let keys: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("Failed to read Cursor DB keys: {}", err))?
        .filter_map(|r| r.ok())
        .filter_map(|key| key.strip_prefix(COMPOSER_KEY_PREFIX).map(String::from))
        .collect();

    Ok(keys)
}

/// Parse full composerData values for the given session IDs.
fn parse_sessions_by_ids(
    cursor_conn: &Connection,
    ids: &[String],
) -> Result<Vec<CursorSession>, String> {
    let mut sessions = Vec::with_capacity(ids.len());

    for id in ids {
        let key = format!("{}{}", COMPOSER_KEY_PREFIX, id);
        let json_str: String = match cursor_conn.query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&key],
            |row| row.get(0),
        ) {
            Ok(val) => val,
            Err(_) => continue,
        };

        let raw: RawComposerData = match serde_json::from_str(&json_str) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        if raw.created_at == 0 || raw.composer_id.is_empty() {
            continue;
        }

        // Subagent composers are children of a parent's `task_v2` tool call.
        // The Subagent chat block on the parent already replays them inline,
        // so listing them as standalone rows in the sidebar / dev record
        // would double-count them. We never write subagent rows to the cache
        // — once filtered here, all readers (sidebar `list_for_sidebar`,
        // dev record `query_cache`) get a subagent-free view for free.
        if raw.subagent_info.is_some() {
            continue;
        }

        let model = raw
            .model_config
            .as_ref()
            .map(|mc| mc.model_name.clone())
            .unwrap_or_default();

        let mut last_active_at = raw.created_at.max(raw.last_updated_at);
        if let Some(last_header) = raw.full_conversation_headers_only.last() {
            if !last_header.bubble_id.is_empty() {
                let bubble_key = format!("bubbleId:{}:{}", raw.composer_id, last_header.bubble_id);
                if let Ok(bubble_json) = cursor_conn.query_row(
                    "SELECT value FROM cursorDiskKV WHERE key = ?1",
                    [&bubble_key],
                    |row| row.get::<_, String>(0),
                ) {
                    if let Ok(bt) = serde_json::from_str::<BubbleTimestamp>(&bubble_json) {
                        let ts = parse_iso_to_epoch_ms(&bt.created_at);
                        if ts > 0 {
                            last_active_at = last_active_at.max(ts);
                        }
                    }
                }
            }
        }

        sessions.push(CursorSession {
            id: raw.composer_id,
            name: raw.name,
            created_at: raw.created_at,
            last_active_at,
            status: raw.status,
            is_agentic: raw.is_agentic,
            mode: raw.unified_mode,
            model,
            lines_added: raw.total_lines_added,
            lines_removed: raw.total_lines_removed,
            files_changed: raw.files_changed_count,
            tokens_used: raw.context_tokens_used as i64,
        });
    }

    Ok(sessions)
}

/// Upsert sessions into the cache table.
fn upsert_cache(conn: &Connection, sessions: &[CursorSession]) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO cursor_session_cache
                (id, name, created_at, last_active_at, status, is_agentic, mode, model,
                 lines_added, lines_removed, files_changed, tokens_used)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                last_active_at = excluded.last_active_at,
                status = excluded.status,
                is_agentic = excluded.is_agentic,
                mode = excluded.mode,
                model = excluded.model,
                lines_added = excluded.lines_added,
                lines_removed = excluded.lines_removed,
                files_changed = excluded.files_changed,
                tokens_used = excluded.tokens_used",
        )
        .map_err(|err| format!("Failed to prepare upsert: {}", err))?;

    for session in sessions {
        stmt.execute(params![
            session.id,
            session.name,
            session.created_at,
            session.last_active_at,
            session.status,
            session.is_agentic as i32,
            session.mode,
            session.model,
            session.lines_added,
            session.lines_removed,
            session.files_changed,
            session.tokens_used,
        ])
        .map_err(|err| format!("Failed to upsert session {}: {}", session.id, err))?;
    }

    Ok(())
}

// ============================================
// Cache query
// ============================================

/// Query the local cache for sessions within a date range.
fn query_cache(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CursorSession>, String> {
    let start_epoch = date_str_to_epoch_ms(start_date);
    let end_epoch = date_str_to_epoch_ms_end(end_date);

    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, last_active_at, status, is_agentic,
                    mode, model, lines_added, lines_removed, files_changed, tokens_used
             FROM cursor_session_cache
             WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY created_at DESC",
        )
        .map_err(|err| format!("Failed to query cache: {}", err))?;

    let sessions = stmt
        .query_map(params![start_epoch, end_epoch], |row| {
            Ok(CursorSession {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                last_active_at: row.get(3)?,
                status: row.get(4)?,
                is_agentic: row.get::<_, i32>(5)? != 0,
                mode: row.get(6)?,
                model: row.get(7)?,
                lines_added: row.get(8)?,
                lines_removed: row.get(9)?,
                files_changed: row.get(10)?,
                tokens_used: row.get(11)?,
            })
        })
        .map_err(|err| format!("Failed to read cache results: {}", err))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

fn query_cache_for_sidebar(conn: &Connection) -> Result<Vec<CursorSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, last_active_at, status, is_agentic,
                    mode, model, lines_added, lines_removed, files_changed, tokens_used
             FROM cursor_session_cache
             ORDER BY last_active_at DESC, created_at DESC",
        )
        .map_err(|err| format!("Failed to prepare sidebar query: {}", err))?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(CursorSession {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                last_active_at: row.get(3)?,
                status: row.get(4)?,
                is_agentic: row.get::<_, i32>(5)? != 0,
                mode: row.get(6)?,
                model: row.get(7)?,
                lines_added: row.get(8)?,
                lines_removed: row.get(9)?,
                files_changed: row.get(10)?,
                tokens_used: row.get(11)?,
            })
        })
        .map_err(|err| format!("Failed to read sidebar query results: {}", err))?
        .filter_map(|row_result| row_result.ok())
        .collect();

    Ok(sessions)
}

// ============================================
// Cursor DB helpers
// ============================================

fn cursor_db_path() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let path = home
        .join("Library")
        .join("Application Support")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "linux")]
    let path = home
        .join(".config")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "windows")]
    let path = home
        .join("AppData")
        .join("Roaming")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    if path.exists() {
        Some(path)
    } else {
        None
    }
}

// ============================================
// Date / time helpers
// ============================================

fn date_str_to_epoch_ms(date_str: &str) -> i64 {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return 0;
    }
    let year: i32 = parts[0].parse().unwrap_or(2025);
    let month: u32 = parts[1].parse().unwrap_or(1);
    let day: u32 = parts[2].parse().unwrap_or(1);

    match chrono::NaiveDate::from_ymd_opt(year, month, day) {
        Some(date) => {
            let dt = date.and_hms_opt(0, 0, 0).unwrap_or_default();
            let local = chrono::Local
                .from_local_datetime(&dt)
                .single()
                .unwrap_or_else(chrono::Local::now);
            local.timestamp_millis()
        }
        None => 0,
    }
}

fn date_str_to_epoch_ms_end(date_str: &str) -> i64 {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return i64::MAX;
    }
    let year: i32 = parts[0].parse().unwrap_or(2025);
    let month: u32 = parts[1].parse().unwrap_or(1);
    let day: u32 = parts[2].parse().unwrap_or(1);

    match chrono::NaiveDate::from_ymd_opt(year, month, day) {
        Some(date) => {
            let dt = date.and_hms_opt(23, 59, 59).unwrap_or_default();
            let local = chrono::Local
                .from_local_datetime(&dt)
                .single()
                .unwrap_or_else(chrono::Local::now);
            local.timestamp_millis()
        }
        None => i64::MAX,
    }
}

fn parse_iso_to_epoch_ms(iso: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

// ============================================================================
// Tests — subagent_info wire shape
//
// `parse_sessions_by_ids` skips composers whose `subagentInfo` field is set,
// so we lock in the deserialize behaviour here. Without these tests a serde
// rename or a Cursor schema change could silently flip subagents back into
// the cache, polluting the sidebar with the same nested rows the parent
// composer already replays inline.
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_composer_detects_subagent_info_when_present() {
        let json = r#"{
            "composerId": "c6f60eb9-575a-4478-aef7-037ee6c9f620",
            "name": "Cleanup bucket A",
            "createdAt": 1746150752293,
            "status": "completed",
            "contextTokensUsed": 12345.0,
            "subagentInfo": {
                "subagentType": 3,
                "subagentTypeName": "generalPurpose",
                "parentComposerId": "df05eda5-7f2e-40d1-9e15-1667a1c49af2"
            }
        }"#;
        let row: RawComposerData = serde_json::from_str(json).expect("parse");
        assert!(row.subagent_info.is_some());
    }

    #[test]
    fn raw_composer_treats_missing_subagent_info_as_top_level() {
        let json = r#"{
            "composerId": "df05eda5-7f2e-40d1-9e15-1667a1c49af2",
            "name": "User-initiated session",
            "createdAt": 1746150752293,
            "status": "completed",
            "contextTokensUsed": 0.0
        }"#;
        let row: RawComposerData = serde_json::from_str(json).expect("parse");
        assert!(row.subagent_info.is_none());
    }

    #[test]
    fn raw_composer_treats_null_subagent_info_as_top_level() {
        let json = r#"{
            "composerId": "abc",
            "name": "Top-level",
            "createdAt": 1,
            "status": "",
            "contextTokensUsed": 0.0,
            "subagentInfo": null
        }"#;
        let row: RawComposerData = serde_json::from_str(json).expect("parse");
        assert!(row.subagent_info.is_none());
    }
}
