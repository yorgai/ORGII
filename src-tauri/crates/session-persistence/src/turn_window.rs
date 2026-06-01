//! Turn-window queries over the normalized session event cache.
//!
//! These functions intentionally return `CachedEvent` rows from `events`; the
//! app crate converts them to `SessionEvent` at the existing cache bridge layer.

use std::collections::HashSet;

use rusqlite::{params, params_from_iter, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use super::connection::get_connection;
use super::turn_index;
use super::types::CachedEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTurnBodyWindow {
    pub turn_id: String,
    pub events: Vec<CachedEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedInitialTurnWindow {
    pub turns: Vec<turn_index::CachedTurnSummary>,
    pub events: Vec<CachedEvent>,
}

fn cached_event_from_row(row: &rusqlite::Row<'_>) -> SqliteResult<CachedEvent> {
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
}

fn load_events_for_turn_ranges(
    session_id: &str,
    ranges: &[(String, Option<String>)],
) -> SqliteResult<Vec<CachedEvent>> {
    if ranges.is_empty() {
        return Ok(Vec::new());
    }

    let conn = get_connection()?;
    let mut events = Vec::new();
    for (start, end) in ranges {
        if let Some(end) = end {
            let mut stmt = conn.prepare_cached(
                "SELECT id, session_id, event_type, function_name, thread_id,
                        args_json, result_json, content, created_at, meta_json, history_sequence
                 FROM events
                 WHERE session_id = ?1
                   AND created_at >= ?2
                   AND created_at < ?3
                 ORDER BY created_at ASC, COALESCE(history_sequence, rowid) ASC, id ASC",
            )?;
            let rows = stmt
                .query_map(params![session_id, start, end], cached_event_from_row)?
                .collect::<SqliteResult<Vec<_>>>()?;
            events.extend(rows);
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT id, session_id, event_type, function_name, thread_id,
                        args_json, result_json, content, created_at, meta_json, history_sequence
                 FROM events
                 WHERE session_id = ?1
                   AND created_at >= ?2
                 ORDER BY created_at ASC, COALESCE(history_sequence, rowid) ASC, id ASC",
            )?;
            let rows = stmt
                .query_map(params![session_id, start], cached_event_from_row)?
                .collect::<SqliteResult<Vec<_>>>()?;
            events.extend(rows);
        }
    }

    Ok(events)
}

fn load_events_by_ids(session_id: &str, ids: &[String]) -> SqliteResult<Vec<CachedEvent>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = get_connection()?;
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT id, session_id, event_type, function_name, thread_id,
                args_json, result_json, content, created_at, meta_json, history_sequence
         FROM events
         WHERE session_id = ? AND id IN ({placeholders})
         ORDER BY created_at ASC, COALESCE(history_sequence, rowid) ASC, id ASC"
    );
    let params = std::iter::once(session_id).chain(ids.iter().map(String::as_str));
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt
        .query_map(params_from_iter(params), cached_event_from_row)?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(rows)
}

pub fn load_turn_body_window(
    session_id: &str,
    turn_id: &str,
) -> SqliteResult<CachedTurnBodyWindow> {
    turn_index::ensure_turn_index_fresh(session_id)?;
    let conn = get_connection()?;
    let Some(summary) = turn_index::get_turn_summary(&conn, session_id, turn_id)? else {
        return Ok(CachedTurnBodyWindow {
            turn_id: turn_id.to_string(),
            events: Vec::new(),
        });
    };

    let next_started_at = summary
        .next_turn_id
        .as_deref()
        .and_then(|next_turn_id| {
            turn_index::get_turn_summary(&conn, session_id, next_turn_id)
                .ok()
                .flatten()
        })
        .map(|next_turn| next_turn.started_at);
    let events =
        load_events_for_turn_ranges(session_id, &[(summary.started_at.clone(), next_started_at)])?;

    Ok(CachedTurnBodyWindow {
        turn_id: turn_id.to_string(),
        events,
    })
}

pub fn load_initial_turn_window(
    session_id: &str,
    recent_turn_count: usize,
) -> SqliteResult<CachedInitialTurnWindow> {
    let turns = turn_index::load_turn_index(session_id)?;
    let recent_start = turns.len().saturating_sub(recent_turn_count);
    let recent_turn_ids = turns[recent_start..]
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect::<HashSet<_>>();

    let header_event_ids = turns[..recent_start]
        .iter()
        .flat_map(|turn| turn.user_event_ids.iter().cloned())
        .collect::<Vec<_>>();
    let recent_ranges = turns[recent_start..]
        .iter()
        .enumerate()
        .map(|(offset, turn)| {
            let turn_index = recent_start + offset;
            let next_started_at = turns
                .get(turn_index + 1)
                .map(|next_turn| next_turn.started_at.clone());
            (turn.started_at.clone(), next_started_at)
        })
        .collect::<Vec<_>>();

    let mut events = load_events_by_ids(session_id, &header_event_ids)?;
    events.extend(load_events_for_turn_ranges(session_id, &recent_ranges)?);
    events.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.history_sequence.cmp(&right.history_sequence))
            .then_with(|| left.id.cmp(&right.id))
    });
    events.retain(|event| {
        turns
            .iter()
            .find(|turn| turn.turn_id == event.id)
            .map(|turn| recent_turn_ids.contains(turn.turn_id.as_str()))
            .unwrap_or(true)
            || !recent_turn_ids.contains(event.id.as_str())
    });

    Ok(CachedInitialTurnWindow { turns, events })
}
