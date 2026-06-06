//! Materialized turn index derived from normalized session events.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use super::connection::{begin_immediate, get_connection, with_sessions_writer};
use super::crud::normalize_session_sequences;

const USER_MESSAGE_FUNCTION: &str = "user_message";
const TURN_STATUS_PENDING: &str = "pending";
const TURN_STATUS_COMPLETED: &str = "completed";
const TURN_INDEX_VERSION: i64 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTurnSummary {
    pub session_id: String,
    pub turn_id: String,
    pub start_sequence: i64,
    pub end_sequence: Option<i64>,
    pub next_turn_id: Option<String>,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub user_event_ids: Vec<String>,
    pub user_preview: String,
    pub event_count: i64,
    pub body_event_count: i64,
    pub status: String,
    pub interrupted: bool,
}

#[derive(Debug, Clone)]
struct IndexEventRow {
    id: String,
    function_name: Option<String>,
    result_json: String,
    content: String,
    created_at: String,
    order_sequence: i64,
}

#[derive(Debug, Clone)]
struct TurnDraft {
    turn_id: String,
    start_sequence: i64,
    end_sequence: Option<i64>,
    next_turn_id: Option<String>,
    started_at: String,
    ended_at: Option<String>,
    user_event_ids: Vec<String>,
    user_preview: String,
    event_count: i64,
    body_event_count: i64,
}

#[derive(Debug, Clone)]
struct UserMessageRow {
    id: String,
    content: String,
    sequence: i64,
    created_at: String,
    images: Option<String>,
}

fn load_index_rows(conn: &Connection, session_id: &str) -> SqliteResult<Vec<IndexEventRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, function_name, result_json, content, created_at, history_sequence AS order_sequence
         FROM events
         WHERE session_id = ?1
         ORDER BY history_sequence ASC, created_at ASC, id ASC",
    )?;

    let rows = stmt
        .query_map([session_id], |row| {
            Ok(IndexEventRow {
                id: row.get(0)?,
                function_name: row.get(1)?,
                result_json: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                order_sequence: row.get(5)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(rows)
}

fn event_state(conn: &Connection, session_id: &str) -> SqliteResult<(i64, Option<i64>)> {
    conn.query_row(
        "SELECT COUNT(*), MAX(COALESCE(history_sequence, rowid))
         FROM events
         WHERE session_id = ?1",
        [session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

fn is_synthetic_user_input(row: &IndexEventRow) -> bool {
    serde_json::from_str::<serde_json::Value>(&row.result_json)
        .ok()
        .and_then(|result| {
            result
                .get("syntheticUserInput")
                .and_then(|value| value.as_bool())
        })
        .unwrap_or(false)
}

fn is_user_message(row: &IndexEventRow) -> bool {
    row.function_name.as_deref() == Some(USER_MESSAGE_FUNCTION) && !is_synthetic_user_input(row)
}

fn user_event_id_for_message(message_id: &str) -> String {
    format!("user-message-{message_id}")
}

fn load_user_messages(conn: &Connection, session_id: &str) -> SqliteResult<Vec<UserMessageRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, content, sequence, created_at, images
         FROM agent_messages
         WHERE session_id = ?1 AND role = 'user'
         ORDER BY sequence ASC, created_at ASC, id ASC",
    )?;

    let rows = stmt
        .query_map([session_id], |row| {
            Ok(UserMessageRow {
                id: row.get(0)?,
                content: row.get(1)?,
                sequence: row.get(2)?,
                created_at: row.get(3)?,
                images: row.get(4)?,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(rows)
}

fn load_existing_user_event_keys(
    conn: &Connection,
    session_id: &str,
) -> SqliteResult<(
    std::collections::HashSet<String>,
    std::collections::HashMap<String, usize>,
)> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, content, result_json
         FROM events
         WHERE session_id = ?1 AND function_name = 'user_message'
         ORDER BY COALESCE(history_sequence, rowid) ASC, created_at ASC, id ASC",
    )?;
    let mut ids = std::collections::HashSet::new();
    let mut content_counts = std::collections::HashMap::new();
    let rows = stmt.query_map([session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (id, content, result_json) = row?;
        let event_row = IndexEventRow {
            id: id.clone(),
            function_name: Some(USER_MESSAGE_FUNCTION.to_string()),
            result_json,
            content: content.clone(),
            created_at: String::new(),
            order_sequence: 0,
        };
        if is_synthetic_user_input(&event_row) {
            continue;
        }
        ids.insert(id);
        let preview = content
            .strip_prefix("user_message ")
            .unwrap_or(&content)
            .to_string();
        *content_counts.entry(preview).or_insert(0) += 1;
    }
    Ok((ids, content_counts))
}

fn backfill_missing_user_events(conn: &Connection, session_id: &str) -> SqliteResult<usize> {
    let messages = load_user_messages(conn, session_id)?;
    if messages.is_empty() {
        return Ok(0);
    }

    let (existing_ids, mut existing_content_counts) =
        load_existing_user_event_keys(conn, session_id)?;
    let mut inserted = 0;
    for message in messages {
        let event_id = user_event_id_for_message(&message.id);
        if existing_ids.contains(&event_id) {
            continue;
        }
        if let Some(count) = existing_content_counts.get_mut(&message.content) {
            if *count > 0 {
                *count -= 1;
                continue;
            }
        }

        let images_value = message
            .images
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .unwrap_or(serde_json::Value::Null);
        let result = if images_value.is_null() {
            serde_json::json!({
                "type": "user",
                "message": { "content": &message.content, "role": "user" },
                "backendPersisted": true,
                "messageId": &message.id,
            })
        } else {
            serde_json::json!({
                "type": "user",
                "message": { "content": &message.content, "role": "user" },
                "images": images_value,
                "backendPersisted": true,
                "messageId": &message.id,
            })
        };
        let meta = serde_json::json!({
            "source": "user",
            "displayText": &message.content,
            "displayStatus": "completed",
            "displayVariant": "message",
            "activityStatus": "agent",
            "uiCanonical": "user_message",
            "chunk_id": event_id,
            "callId": null,
            "filePath": null,
            "command": null,
            "isDelta": false,
            "processId": null,
            "repoId": null,
            "repoPath": null,
        });
        let content = format!("user_message {}", message.content);

        let affected = conn.execute(
            "INSERT OR IGNORE INTO events
             (id, session_id, event_type, function_name, thread_id, args_json, result_json,
              content, created_at, meta_json, history_sequence)
             VALUES (?1, ?2, 'raw', 'user_message', NULL, '{}', ?3, ?4, ?5, ?6, ?7)",
            params![
                event_id,
                session_id,
                serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string()),
                content,
                message.created_at,
                serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string()),
                message.sequence,
            ],
        )?;
        inserted += affected;
    }

    Ok(inserted)
}

fn duration_ms(started_at: &str, ended_at: Option<&str>) -> Option<i64> {
    let ended_at = ended_at?;
    let start = DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = DateTime::parse_from_rfc3339(ended_at).ok()?;
    Some((end - start).num_milliseconds().max(0))
}

fn max_timestamp(left: &str, right: &str) -> String {
    match (
        DateTime::parse_from_rfc3339(left),
        DateTime::parse_from_rfc3339(right),
    ) {
        (Ok(left_time), Ok(right_time)) if right_time > left_time => right.to_string(),
        (Ok(_), Ok(_)) => left.to_string(),
        _ if right > left => right.to_string(),
        _ => left.to_string(),
    }
}

fn build_turn_drafts(rows: &[IndexEventRow]) -> Vec<TurnDraft> {
    let mut drafts: Vec<TurnDraft> = Vec::new();
    let mut current: Option<TurnDraft> = None;

    for row in rows {
        if is_user_message(row) {
            if let Some(mut completed) = current.take() {
                completed.end_sequence = Some(row.order_sequence);
                completed.next_turn_id = Some(row.id.clone());
                drafts.push(completed);
            }

            current = Some(TurnDraft {
                turn_id: row.id.clone(),
                start_sequence: row.order_sequence,
                end_sequence: None,
                next_turn_id: None,
                started_at: row.created_at.clone(),
                ended_at: Some(row.created_at.clone()),
                user_event_ids: vec![row.id.clone()],
                user_preview: row.content.clone(),
                event_count: 1,
                body_event_count: 0,
            });
            continue;
        }

        if let Some(ref mut turn) = current {
            turn.ended_at = Some(max_timestamp(&turn.started_at, &row.created_at));
            turn.event_count += 1;
            turn.body_event_count += 1;
        }
    }

    if let Some(turn) = current {
        drafts.push(turn);
    }

    materialized_turn_drafts(drafts)
}

fn materialized_turn_drafts(drafts: Vec<TurnDraft>) -> Vec<TurnDraft> {
    let last_index = drafts.len().saturating_sub(1);
    drafts
        .into_iter()
        .enumerate()
        .filter_map(|(index, draft)| {
            if draft.body_event_count > 0 || index == last_index {
                Some(draft)
            } else {
                None
            }
        })
        .collect()
}

fn turn_summary_from_row(row: &rusqlite::Row<'_>) -> SqliteResult<CachedTurnSummary> {
    let user_event_ids_json: String = row.get(8)?;
    let user_event_ids = serde_json::from_str(&user_event_ids_json).unwrap_or_else(|_| Vec::new());
    let interrupted_int: i64 = row.get(13)?;

    Ok(CachedTurnSummary {
        session_id: row.get(0)?,
        turn_id: row.get(1)?,
        start_sequence: row.get(2)?,
        end_sequence: row.get(3)?,
        next_turn_id: row.get(4)?,
        started_at: row.get(5)?,
        ended_at: row.get(6)?,
        duration_ms: row.get(7)?,
        user_event_ids,
        user_preview: row.get(9)?,
        event_count: row.get(10)?,
        body_event_count: row.get(11)?,
        status: row.get(12)?,
        interrupted: interrupted_int != 0,
    })
}

pub fn rebuild_turn_index(session_id: &str) -> SqliteResult<Vec<CachedTurnSummary>> {
    with_sessions_writer(|| rebuild_turn_index_inner(session_id))
}

fn rebuild_turn_index_inner(session_id: &str) -> SqliteResult<Vec<CachedTurnSummary>> {
    let conn = get_connection()?;
    backfill_missing_user_events(&conn, session_id)?;
    normalize_session_sequences(&conn, session_id)?;
    let rows = load_index_rows(&conn, session_id)?;
    let drafts = build_turn_drafts(&rows);
    let (event_count, max_sequence) = event_state(&conn, session_id)?;
    let rebuilt_at = Utc::now().to_rfc3339();

    let tx = begin_immediate(&conn)?;
    tx.execute(
        "DELETE FROM session_turns WHERE session_id = ?1",
        [session_id],
    )?;

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO session_turns
             (session_id, turn_id, start_sequence, end_sequence, next_turn_id, started_at, ended_at,
              duration_ms, user_event_ids_json, user_preview, event_count, body_event_count,
              status, interrupted, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;

        for draft in &drafts {
            let user_event_ids_json =
                serde_json::to_string(&draft.user_event_ids).unwrap_or_else(|_| "[]".to_string());
            let status = if draft.body_event_count > 0 {
                TURN_STATUS_COMPLETED
            } else {
                TURN_STATUS_PENDING
            };
            stmt.execute(params![
                session_id,
                draft.turn_id,
                draft.start_sequence,
                draft.end_sequence,
                draft.next_turn_id,
                draft.started_at,
                draft.ended_at,
                duration_ms(&draft.started_at, draft.ended_at.as_deref()),
                user_event_ids_json,
                draft.user_preview,
                draft.event_count,
                draft.body_event_count,
                status,
                0_i64,
                rebuilt_at,
            ])?;
        }
    }

    tx.execute(
        "INSERT INTO session_turn_index_state
         (session_id, indexed_event_count, indexed_max_sequence, rebuilt_at, index_version)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(session_id) DO UPDATE SET
           indexed_event_count = excluded.indexed_event_count,
           indexed_max_sequence = excluded.indexed_max_sequence,
           rebuilt_at = excluded.rebuilt_at,
           index_version = excluded.index_version",
        params![
            session_id,
            event_count,
            max_sequence,
            rebuilt_at,
            TURN_INDEX_VERSION
        ],
    )?;
    tx.commit()?;

    load_turn_index(session_id)
}

pub fn ensure_turn_index_fresh(session_id: &str) -> SqliteResult<()> {
    // `backfill_missing_user_events` and `normalize_session_sequences`
    // are writers, so the freshness check and the optional rebuild all
    // run under one writer-lock acquisition. The lock is cheap to take
    // and easier to reason about than splitting the check across
    // multiple guard scopes.
    with_sessions_writer(|| {
        let conn = get_connection()?;
        let inserted_user_events = backfill_missing_user_events(&conn, session_id)?;
        if inserted_user_events > 0 {
            normalize_session_sequences(&conn, session_id)?;
        }
        let (event_count, max_sequence) = event_state(&conn, session_id)?;
        let state = conn
            .query_row(
                "SELECT indexed_event_count, indexed_max_sequence, index_version
                 FROM session_turn_index_state
                 WHERE session_id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?;

        let fresh = inserted_user_events == 0
            && state
                .map(
                    |(indexed_event_count, indexed_max_sequence, index_version)| {
                        indexed_event_count == event_count
                            && indexed_max_sequence == max_sequence
                            && index_version == TURN_INDEX_VERSION
                    },
                )
                .unwrap_or(false);

        if fresh {
            return Ok(());
        }

        drop(conn);
        rebuild_turn_index_inner(session_id).map(|_| ())
    })
}

pub fn load_turn_index(session_id: &str) -> SqliteResult<Vec<CachedTurnSummary>> {
    ensure_turn_index_fresh(session_id)?;
    let conn = get_connection()?;
    let mut stmt = conn.prepare_cached(
        "SELECT session_id, turn_id, start_sequence, end_sequence, next_turn_id, started_at, ended_at,
                duration_ms, user_event_ids_json, user_preview, event_count, body_event_count,
                status, interrupted
         FROM session_turns
         WHERE session_id = ?1
         ORDER BY started_at ASC, start_sequence ASC",
    )?;

    let rows = stmt
        .query_map([session_id], turn_summary_from_row)?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(rows)
}

pub fn get_turn_summary(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
) -> SqliteResult<Option<CachedTurnSummary>> {
    conn.query_row(
        "SELECT session_id, turn_id, start_sequence, end_sequence, next_turn_id, started_at, ended_at,
                duration_ms, user_event_ids_json, user_preview, event_count, body_event_count,
                status, interrupted
         FROM session_turns
         WHERE session_id = ?1 AND turn_id = ?2",
        params![session_id, turn_id],
        turn_summary_from_row,
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        id: &str,
        function_name: Option<&str>,
        result_json: &str,
        sequence: i64,
    ) -> IndexEventRow {
        IndexEventRow {
            id: id.to_string(),
            function_name: function_name.map(str::to_string),
            result_json: result_json.to_string(),
            content: id.to_string(),
            created_at: "2026-05-27T00:00:00Z".to_string(),
            order_sequence: sequence,
        }
    }

    fn create_backfill_test_tables(conn: &Connection) {
        crate::schema::init_session_tables(conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                images TEXT
            );",
        )
        .unwrap();
    }

    #[test]
    fn backfill_missing_user_events_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_backfill_test_tables(&conn);
        conn.execute(
            "INSERT INTO agent_messages (id, session_id, role, content, sequence, created_at, images)
             VALUES (?1, ?2, 'user', ?3, ?4, ?5, NULL)",
            params![
                "message-1",
                "session-1",
                "hello from persisted user",
                1_i64,
                "2026-05-27T00:00:00Z",
            ],
        )
        .unwrap();

        assert_eq!(backfill_missing_user_events(&conn, "session-1").unwrap(), 1);
        assert_eq!(backfill_missing_user_events(&conn, "session-1").unwrap(), 0);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE session_id = ?1 AND id = ?2",
                params!["session-1", "user-message-message-1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn synthetic_user_input_does_not_start_turn() {
        let rows = vec![
            row(
                "user-input-optimistic",
                Some(USER_MESSAGE_FUNCTION),
                r#"{"syntheticUserInput":true}"#,
                1,
            ),
            row("assistant-event", Some("assistant_message"), "{}", 2),
            row(
                "user-message-authoritative",
                Some(USER_MESSAGE_FUNCTION),
                r#"{"backendPersisted":true}"#,
                3,
            ),
        ];

        let drafts = build_turn_drafts(&rows);

        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].turn_id, "user-message-authoritative");
        assert_eq!(drafts[0].start_sequence, 3);
    }

    #[test]
    fn consecutive_user_messages_do_not_materialize_ghost_pending_turns() {
        let rows = vec![
            row(
                "user-message-queued-ghost",
                Some(USER_MESSAGE_FUNCTION),
                r#"{"backendPersisted":true}"#,
                1,
            ),
            row(
                "user-message-authoritative",
                Some(USER_MESSAGE_FUNCTION),
                r#"{"backendPersisted":true}"#,
                2,
            ),
            row("assistant-event", Some("assistant_message"), "{}", 3),
        ];

        let drafts = build_turn_drafts(&rows);

        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].turn_id, "user-message-authoritative");
        assert_eq!(drafts[0].start_sequence, 2);
        assert_eq!(drafts[0].body_event_count, 1);
    }

    #[test]
    fn latest_user_only_turn_still_materializes_as_pending() {
        let rows = vec![row(
            "user-message-latest",
            Some(USER_MESSAGE_FUNCTION),
            r#"{"backendPersisted":true}"#,
            1,
        )];

        let drafts = build_turn_drafts(&rows);

        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].turn_id, "user-message-latest");
        assert_eq!(drafts[0].body_event_count, 0);
    }
}
