//! SQLite CRUD operations for session event persistence
//!
//! All functions are synchronous (`rusqlite`) and must be called from a
//! blocking thread (e.g. inside `tokio::task::spawn_blocking`).
//!
//! Operations: `save_events`, `load_events`, `delete_session`,
//! `update_session_metadata`, `get_session_metadata`.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

use database::db::get_db_path;

use super::connection::get_connection;
use super::sequence::{get_next_sequence, increment_sequence, reset_sequence};
use super::types::{
    CacheStats, CachedEvent, CachedSession, CrossSessionSearchHit, SearchResult, SessionMetadata,
};

/// TS-side per-delta placeholder IDs are live-only display artifacts and must
/// never be persisted (see `cache_bridge::is_ts_placeholder_id` for the full
/// rationale). This is the last line of defense: every `save_events` caller
/// should already have filtered them upstream, but duplicating the check here
/// means a future caller that forgets cannot pollute the DB.
fn is_ts_placeholder_id(id: &str) -> bool {
    id.starts_with("stream-msg-ts-") || id.starts_with("stream-think-ts-")
}

/// Return the `history_sequence` already persisted for `event_id`, if the
/// row exists. Used by `save_events` so a frontend re-submission cannot
/// clobber the server-assigned sequence.
fn existing_event_sequence(
    conn: &Connection,
    session_id: &str,
    event_id: &str,
) -> SqliteResult<Option<i64>> {
    conn.query_row(
        "SELECT history_sequence FROM events
         WHERE session_id = ?1 AND id = ?2",
        params![session_id, event_id],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .map(|opt| opt.flatten())
}

pub(crate) fn normalize_session_sequences(conn: &Connection, session_id: &str) -> SqliteResult<()> {
    let mut stmt = conn.prepare_cached(
        "SELECT id FROM events
         WHERE session_id = ?1
         ORDER BY created_at ASC, COALESCE(history_sequence, rowid) ASC, id ASC",
    )?;
    let event_ids = stmt
        .query_map([session_id], |row| row.get::<_, String>(0))?
        .collect::<SqliteResult<Vec<_>>>()?;

    for (idx, event_id) in event_ids.iter().enumerate() {
        conn.execute(
            "UPDATE events
             SET history_sequence = ?1
             WHERE session_id = ?2 AND id = ?3
               AND (history_sequence IS NULL OR history_sequence != ?1)",
            params![idx as i64, session_id, event_id],
        )?;
    }

    reset_sequence(session_id, event_ids.len() as i64);
    Ok(())
}

/// Save events to cache
pub fn save_events(session_id: &str, events: &[CachedEvent]) -> SqliteResult<()> {
    let conn = get_connection()?;
    let tx = conn.unchecked_transaction()?;

    // Initialize sequence counter from DB if needed
    get_next_sequence(&conn, session_id)?;

    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO events
         (id, session_id, event_type, function_name, thread_id, args_json, result_json,
          content, created_at, meta_json, history_sequence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;

    let mut time_start: Option<String> = None;
    let mut time_end: Option<String> = None;

    for event in events {
        if is_ts_placeholder_id(&event.id) {
            continue;
        }
        // `save_events` is `INSERT OR REPLACE`: it rewrites the whole row.
        // The frontend's in-memory event cache does NOT track the server-
        // owned `history_sequence` stamp (minted by the sequence counter).
        // When the frontend re-submits an already persisted event after a
        // reload, the field comes back as `None`. Replacing the row with
        // `None` would desync `history_sequence` from `created_at` and
        // break truncate cutoffs. So: for an event the frontend submits
        // without a stamp, KEEP the value already persisted; only mint a
        // fresh sequence for genuinely new rows.
        let seq = match event.history_sequence {
            Some(seq) => seq,
            None => existing_event_sequence(&conn, session_id, &event.id)?
                .unwrap_or_else(|| increment_sequence(session_id)),
        };

        stmt.execute(params![
            event.id,
            event.session_id,
            event.event_type,
            event.function_name,
            event.thread_id,
            event.args_json,
            event.result_json,
            event.content,
            event.created_at,
            event.meta_json,
            seq,
        ])?;

        // Track time range
        if time_start.is_none() || event.created_at < *time_start.as_ref().unwrap() {
            time_start = Some(event.created_at.clone());
        }
        if time_end.is_none() || event.created_at > *time_end.as_ref().unwrap() {
            time_end = Some(event.created_at.clone());
        }
    }

    // Update session metadata, preserving existing specs_json
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO sessions (session_id, event_count, cached_at, time_range_start, time_range_end, specs_json)
         VALUES (?1,
                 (SELECT COUNT(*) FROM events WHERE session_id = ?1),
                 ?2, ?3, ?4, NULL)
         ON CONFLICT(session_id) DO UPDATE SET
             event_count      = excluded.event_count,
             cached_at        = excluded.cached_at,
             time_range_start = excluded.time_range_start,
             time_range_end   = excluded.time_range_end",
        params![session_id, now, time_start, time_end],
    )?;

    normalize_session_sequences(&conn, session_id)?;

    tx.commit()?;
    super::turn_index::rebuild_turn_index(session_id)?;
    Ok(())
}

/// Load all events for a session.
pub fn load_events(session_id: &str) -> SqliteResult<Vec<CachedEvent>> {
    let conn = get_connection()?;
    normalize_session_sequences(&conn, session_id)?;
    let mut stmt = conn.prepare_cached(
        "SELECT id, session_id, event_type, function_name, thread_id,
                args_json, result_json, content, created_at, meta_json, history_sequence
         FROM events
         WHERE session_id = ?1
         ORDER BY history_sequence ASC, created_at ASC, id ASC",
    )?;

    let events = stmt
        .query_map([session_id], |row| {
            Ok(CachedEvent {
                id: row.get(0)?,
                session_id: row.get(1)?,
                event_type: row.get(2)?,
                function_name: row.get(3)?,
                thread_id: row.get(4)?,
                args_json: row.get(5)?,
                result_json: row.get(6)?,
                content: row.get(7)?,
                created_at: row.get(8)?,
                meta_json: row.get(9)?,
                history_sequence: row.get(10)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(events)
}

/// Full-text search within a session
pub fn search_events(session_id: &str, query: &str, limit: i64) -> SqliteResult<Vec<SearchResult>> {
    let conn = get_connection()?;

    // Use FTS5 for fast full-text search with BM25 ranking
    let mut stmt = conn.prepare_cached(
        "SELECT e.id, e.session_id, e.event_type, e.function_name,
                e.thread_id, e.args_json, e.result_json, e.content, e.created_at, e.meta_json,
                e.history_sequence,
                bm25(events_fts) as rank,
                snippet(events_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
         FROM events_fts fts
         JOIN events e ON fts.id = e.id
         WHERE events_fts MATCH ?1 AND e.session_id = ?2
         ORDER BY rank
         LIMIT ?3",
    )?;

    // Escape special FTS5 characters and add prefix matching
    let fts_query = format!("\"{}\"*", query.replace('"', "\"\""));

    let results = stmt
        .query_map(params![fts_query, session_id, limit], |row| {
            Ok(SearchResult {
                event: CachedEvent {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    event_type: row.get(2)?,
                    function_name: row.get(3)?,
                    thread_id: row.get(4)?,
                    args_json: row.get(5)?,
                    result_json: row.get(6)?,
                    content: row.get(7)?,
                    created_at: row.get(8)?,
                    meta_json: row.get(9)?,
                    history_sequence: row.get(10)?,
                },
                rank: row.get(11)?,
                snippet: row.get(12)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(results)
}

/// Full-text search across all sessions. Returns one hit per session (the
/// best-ranked snippet for that session). The caller should join with the
/// session list API to resolve display names.
pub fn search_all_sessions(query: &str, limit: i64) -> SqliteResult<Vec<CrossSessionSearchHit>> {
    let conn = get_connection()?;
    let fts_query = format!("\"{}\"*", query.replace('"', "\"\""));

    // Use FTS5 to find the best-ranked snippet per session_id.
    // GROUP BY session_id picks the highest-scored row for each session
    // (MIN(rank) because BM25 scores are negative — lower = better).
    let mut stmt = conn.prepare_cached(
        "SELECT e.session_id,
                snippet(events_fts, 1, '<mark>', '</mark>', '...', 32) as snip,
                e.created_at,
                bm25(events_fts) as rank
         FROM events_fts fts
         JOIN events e ON fts.id = e.id
         WHERE events_fts MATCH ?1
         GROUP BY e.session_id
         ORDER BY rank
         LIMIT ?2",
    )?;

    let hits = stmt
        .query_map(params![fts_query, limit], |row| {
            Ok(CrossSessionSearchHit {
                session_id: row.get(0)?,
                snippet: row.get(1)?,
                timestamp: row.get(2)?,
                rank: row.get(3)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(hits)
}

/// Get session metadata
pub fn get_session_metadata(session_id: &str) -> SqliteResult<Option<SessionMetadata>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare_cached(
        "SELECT session_id, event_count, cached_at, time_range_start, time_range_end, specs_json
         FROM sessions WHERE session_id = ?1",
    )?;

    let result = stmt.query_row([session_id], |row| {
        Ok(SessionMetadata {
            session_id: row.get(0)?,
            event_count: row.get(1)?,
            cached_at: row.get(2)?,
            time_range_start: row.get(3)?,
            time_range_end: row.get(4)?,
            specs_json: row.get(5)?,
        })
    });

    match result {
        Ok(meta) => Ok(Some(meta)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err),
    }
}

/// Delete a session and its events
pub fn delete_session(session_id: &str) -> SqliteResult<()> {
    let conn = get_connection()?;
    conn.execute("DELETE FROM events WHERE session_id = ?1", [session_id])?;
    conn.execute(
        "DELETE FROM session_turns WHERE session_id = ?1",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM session_turn_index_state WHERE session_id = ?1",
        [session_id],
    )?;
    conn.execute("DELETE FROM sessions WHERE session_id = ?1", [session_id])?;
    app_paths::cleanup_scratchpad_by_session_id(session_id);
    Ok(())
}

/// Delete the last "user_message" event and every event that came after it.
///
/// Used by the Scenario A cancel-rollback path so the event store mirrors
/// the `agent_messages` rollback: the just-cancelled user prompt disappears
/// from the session view, and subsequent turns do not re-see it.
///
/// Returns the number of rows removed.
pub fn delete_last_user_event_and_after(session_id: &str) -> SqliteResult<i64> {
    let conn = get_connection()?;
    normalize_session_sequences(&conn, session_id)?;

    let last_user_seq: Option<i64> = conn
        .query_row(
            "SELECT history_sequence FROM events
             WHERE session_id = ?1 AND function_name = 'user_message'
             ORDER BY COALESCE(history_sequence, 0) DESC, created_at DESC
             LIMIT 1",
            [session_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten();

    let Some(seq) = last_user_seq else {
        return Ok(0);
    };

    let deleted = conn.execute(
        "DELETE FROM events
         WHERE session_id = ?1
           AND COALESCE(history_sequence, 0) >= ?2",
        params![session_id, seq],
    )?;

    // Refresh metadata so event_count reflects the truncation.
    conn.execute(
        "UPDATE sessions
         SET event_count = (SELECT COUNT(*) FROM events WHERE session_id = ?1)
         WHERE session_id = ?1",
        [session_id],
    )?;
    reset_sequence(session_id, seq);
    super::turn_index::rebuild_turn_index(session_id)?;

    Ok(deleted as i64)
}

/// Clear sessions older than TTL
pub fn clear_old_sessions(max_age_hours: i64) -> SqliteResult<i64> {
    let conn = get_connection()?;
    let cutoff = Utc::now().timestamp() - (max_age_hours * 3600);

    // Get session IDs to delete. `session_id` is `TEXT NOT NULL`, so
    // `row.get(0)` should never fail in practice — but if it does (e.g.
    // future schema drift), surfacing the error prevents silently
    // skipping the per-session `events` / `agent_snapshots` cleanup
    // while the bulk `DELETE FROM sessions` below still succeeds, which
    // would otherwise orphan the child rows.
    let mut stmt = conn.prepare("SELECT session_id FROM sessions WHERE cached_at < ?1")?;
    let session_ids: Vec<String> = stmt
        .query_map([cutoff], |row| row.get(0))?
        .collect::<SqliteResult<Vec<String>>>()?;

    let count = session_ids.len() as i64;

    // Delete events, sessions, and associated snapshot records
    for sid in &session_ids {
        conn.execute("DELETE FROM events WHERE session_id = ?1", [sid])?;
        let _ = conn.execute("DELETE FROM agent_snapshots WHERE session_id = ?1", [sid]);
    }
    conn.execute("DELETE FROM sessions WHERE cached_at < ?1", [cutoff])?;

    // Reclaim space incrementally (VACUUM locks the entire DB and blocks
    // concurrent readers in WAL mode; incremental_vacuum is non-blocking).
    if count > 0 {
        conn.execute_batch("PRAGMA incremental_vacuum(100);")?;
    }

    Ok(count)
}

/// Get all session metadata
pub fn get_all_sessions() -> SqliteResult<Vec<SessionMetadata>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT session_id, event_count, cached_at, time_range_start, time_range_end, specs_json
         FROM sessions ORDER BY cached_at DESC",
    )?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(SessionMetadata {
                session_id: row.get(0)?,
                event_count: row.get(1)?,
                cached_at: row.get(2)?,
                time_range_start: row.get(3)?,
                time_range_end: row.get(4)?,
                specs_json: row.get(5)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(sessions)
}

/// Get cache statistics
pub fn get_cache_stats() -> SqliteResult<CacheStats> {
    let conn = get_connection()?;

    let total_sessions: i64 =
        conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;

    let total_events: i64 = conn.query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))?;

    let db_path = get_db_path();
    let db_size_bytes = std::fs::metadata(&db_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    Ok(CacheStats {
        total_sessions,
        total_events,
        db_size_bytes,
    })
}

/// Helper to update session metadata after modifications.
/// Preserves existing specs_json when updating time range and event count.
pub(crate) fn update_session_metadata(conn: &Connection, session_id: &str) -> SqliteResult<()> {
    let now = Utc::now().timestamp();

    // Get new time range
    let time_range: (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT MIN(created_at), MAX(created_at) FROM events WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or((None, None));

    conn.execute(
        "INSERT INTO sessions (session_id, event_count, cached_at, time_range_start, time_range_end, specs_json)
         VALUES (?1,
                 (SELECT COUNT(*) FROM events WHERE session_id = ?1),
                 ?2, ?3, ?4, NULL)
         ON CONFLICT(session_id) DO UPDATE SET
             event_count = excluded.event_count,
             cached_at   = excluded.cached_at,
             time_range_start = excluded.time_range_start,
             time_range_end   = excluded.time_range_end",
        params![session_id, now, time_range.0, time_range.1],
    )?;

    Ok(())
}

/// Save a full session (events + specs + explicit timeRange) atomically.
///
/// Replaces all existing events for the session, sets specs_json, and
/// stores the caller-supplied timeRange instead of deriving it from events.
/// This is the preferred write path when the caller already has specs/timeRange
/// (e.g. migrated from IndexedDB).
pub fn save_session(session: &CachedSession) -> SqliteResult<()> {
    let conn = get_connection()?;
    let tx = conn.unchecked_transaction()?;

    // Remove existing events for a clean replace
    conn.execute(
        "DELETE FROM events WHERE session_id = ?1",
        [&session.session_id],
    )?;

    // Reset sequence counter
    super::sequence::reset_sequence(&session.session_id, 0);

    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO events
         (id, session_id, event_type, function_name, thread_id, args_json, result_json,
          content, created_at, meta_json, history_sequence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )?;

    let mut persisted_count: i64 = 0;
    for (idx, event) in session.events.iter().enumerate() {
        if is_ts_placeholder_id(&event.id) {
            continue;
        }
        let seq = event.history_sequence.unwrap_or(idx as i64 + 1);
        stmt.execute(params![
            event.id,
            event.session_id,
            event.event_type,
            event.function_name,
            event.thread_id,
            event.args_json,
            event.result_json,
            event.content,
            event.created_at,
            event.meta_json,
            seq,
        ])?;
        persisted_count += 1;
    }

    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT OR REPLACE INTO sessions
             (session_id, event_count, cached_at, time_range_start, time_range_end, specs_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            session.session_id,
            persisted_count,
            now,
            session.time_range_start,
            session.time_range_end,
            session.specs_json,
        ],
    )?;

    tx.commit()?;
    super::turn_index::rebuild_turn_index(&session.session_id)?;
    Ok(())
}

/// Load full session data: events + specs_json + timeRange.
pub fn load_session(session_id: &str) -> SqliteResult<Option<CachedSession>> {
    let meta = get_session_metadata(session_id)?;
    let Some(meta) = meta else {
        return Ok(None);
    };
    let events = load_events(session_id)?;
    Ok(Some(CachedSession {
        session_id: session_id.to_string(),
        events,
        specs_json: meta.specs_json,
        time_range_start: meta.time_range_start,
        time_range_end: meta.time_range_end,
    }))
}

/// Update specs_json for an existing session without touching events.
pub fn update_session_specs(session_id: &str, specs_json: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE sessions SET specs_json = ?2 WHERE session_id = ?1",
        params![session_id, specs_json],
    )?;
    Ok(affected > 0)
}

/// Get event by ID
pub fn get_event(session_id: &str, event_id: &str) -> SqliteResult<Option<CachedEvent>> {
    let conn = get_connection()?;
    normalize_session_sequences(&conn, session_id)?;

    let result = conn.query_row(
        "SELECT id, session_id, event_type, function_name, thread_id,
                args_json, result_json, content, created_at, meta_json, history_sequence
         FROM events
         WHERE session_id = ?1 AND id = ?2",
        params![session_id, event_id],
        |row| {
            Ok(CachedEvent {
                id: row.get(0)?,
                session_id: row.get(1)?,
                event_type: row.get(2)?,
                function_name: row.get(3)?,
                thread_id: row.get(4)?,
                args_json: row.get(5)?,
                result_json: row.get(6)?,
                content: row.get(7)?,
                created_at: row.get(8)?,
                meta_json: row.get(9)?,
                history_sequence: row.get(10)?,
            })
        },
    );

    match result {
        Ok(event) => Ok(Some(event)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::sync::Mutex as StdMutex;

    static ORGII_HOME_TEST_LOCK: StdMutex<()> = StdMutex::new(());

    fn with_temp_orgii_home<R>(run: impl FnOnce() -> R) -> R {
        let _guard = ORGII_HOME_TEST_LOCK
            .lock()
            .expect("lock ORGII_HOME test guard");
        let previous = std::env::var("ORGII_HOME").ok();
        let root = std::env::temp_dir().join(format!(
            "orgii-session-persistence-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create temp ORGII_HOME");
        std::env::set_var("ORGII_HOME", &root);
        let result = run();
        match previous {
            Some(value) => std::env::set_var("ORGII_HOME", value),
            None => std::env::remove_var("ORGII_HOME"),
        }
        let _ = std::fs::remove_dir_all(&root);
        result
    }

    #[test]
    fn load_events_normalizes_legacy_writer_order_sequences() {
        with_temp_orgii_home(|| {
            let conn = get_connection().expect("open sessions DB");
            super::super::schema::init_session_tables(&conn).expect("init session schema");
            let session_id = "legacy-sequence-session";

            conn.execute(
                "INSERT INTO events
                 (id, session_id, event_type, function_name, thread_id,
                  args_json, result_json, content, created_at, meta_json, history_sequence)
                 VALUES (?1, ?2, 'raw', ?3, NULL, '{}', '{}', ?4, ?5, NULL, ?6)",
                params![
                    "tool-1",
                    session_id,
                    "tool_call",
                    "tool first by writer order",
                    "2026-05-20T00:00:01.000Z",
                    0_i64,
                ],
            )
            .expect("insert tool event");
            conn.execute(
                "INSERT INTO events
                 (id, session_id, event_type, function_name, thread_id,
                  args_json, result_json, content, created_at, meta_json, history_sequence)
                 VALUES (?1, ?2, 'raw', ?3, NULL, '{}', '{}', ?4, ?5, NULL, ?6)",
                params![
                    "user-1",
                    session_id,
                    "user_message",
                    "user started earlier",
                    "2026-05-20T00:00:00.000Z",
                    3_i64,
                ],
            )
            .expect("insert user event");
            drop(conn);

            let events = load_events(session_id).expect("load events");
            assert_eq!(events[0].id, "user-1");
            assert_eq!(events[0].history_sequence, Some(0));
            assert_eq!(events[1].id, "tool-1");
            assert_eq!(events[1].history_sequence, Some(1));

            let turns = super::super::turn_index::load_turn_index(session_id)
                .expect("load normalized turn index");
            assert_eq!(turns.len(), 1);
            assert_eq!(turns[0].turn_id, "user-1");
            assert_eq!(turns[0].start_sequence, 0);
        });
    }
}
