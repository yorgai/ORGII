//! Turn-summary caching for Cursor IDE sessions.
//!
//! Summaries are derived from bubble order + content and cached in our own
//! SQLite DB. The cache key is a fingerprint of the composer's shape so stale
//! entries are automatically skipped on the next read.

use rusqlite::params;

use database::db::get_connection;

use super::helpers::{duration_between_iso_ms, normalize_created_at, preview_text};
use super::models::{CursorIdeTurnSummary, OrderedBubble, RawComposerHeader, StableFingerprint};

const CURSOR_BUBBLE_TYPE_USER: i64 = 1;

pub(super) fn build_cursor_ide_turn_summaries(
    order: &[RawComposerHeader],
    bubbles: &[OrderedBubble],
) -> Vec<CursorIdeTurnSummary> {
    use std::collections::HashMap;

    let bubbles_by_id: HashMap<String, OrderedBubble> = bubbles
        .iter()
        .map(|bubble| (bubble.bubble_id.clone(), bubble.clone()))
        .collect();
    let mut summaries = Vec::new();

    for (index, header) in order.iter().enumerate() {
        if header.bubble_type != CURSOR_BUBBLE_TYPE_USER || header.bubble_id.is_empty() {
            continue;
        }

        let next_user_index = order
            .iter()
            .enumerate()
            .skip(index + 1)
            .find(|(_, candidate)| candidate.bubble_type == CURSOR_BUBBLE_TYPE_USER)
            .map(|(candidate_index, _)| candidate_index)
            .unwrap_or(order.len());
        let turn_headers = &order[index..next_user_index];
        let next_turn_id = order
            .get(next_user_index)
            .map(|candidate| candidate.bubble_id.clone())
            .filter(|id| !id.is_empty());
        let started_at = turn_headers
            .iter()
            .find_map(|candidate| bubbles_by_id.get(&candidate.bubble_id))
            .map(|bubble| normalize_created_at(&bubble.raw.created_at))
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let ended_at = turn_headers
            .iter()
            .rev()
            .find_map(|candidate| bubbles_by_id.get(&candidate.bubble_id))
            .map(|bubble| normalize_created_at(&bubble.raw.created_at));
        let duration_ms = ended_at
            .as_deref()
            .and_then(|end| duration_between_iso_ms(&started_at, end));
        let user_preview = bubbles_by_id
            .get(&header.bubble_id)
            .map(|bubble| preview_text(&bubble.raw.text))
            .unwrap_or_default();
        let body_event_count = turn_headers.len().saturating_sub(1);

        summaries.push(CursorIdeTurnSummary {
            turn_id: header.bubble_id.clone(),
            next_turn_id,
            turn_index: summaries.len(),
            started_at,
            ended_at,
            duration_ms,
            user_preview,
            event_count: turn_headers.len(),
            body_event_count,
        });
    }

    summaries
}

pub(super) fn cursor_ide_summary_source_fingerprint(
    composer_created_at: i64,
    composer_last_updated_at: i64,
    source_updated_at: i64,
    order: &[RawComposerHeader],
) -> String {
    let mut hasher = StableFingerprint::new();
    hasher.write_str("cursor-ide-turn-summary-v2");
    hasher.write_i64(composer_created_at);
    hasher.write_i64(composer_last_updated_at);
    hasher.write_i64(source_updated_at);
    hasher.write_usize(order.len());
    if let Some(first) = order.first() {
        hasher.write_str(&first.bubble_id);
        hasher.write_i64(first.bubble_type);
    }
    if let Some(last) = order.last() {
        hasher.write_str(&last.bubble_id);
        hasher.write_i64(last.bubble_type);
    }

    for header in order {
        hasher.write_str(&header.bubble_id);
        hasher.write_i64(header.bubble_type);
    }

    hasher.finish_hex()
}

pub(super) fn load_cached_cursor_ide_turn_summaries(
    session_id: &str,
    source_updated_at: i64,
    source_bubble_count: usize,
    source_fingerprint: &str,
) -> Result<Option<Vec<CursorIdeTurnSummary>>, String> {
    let conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;
    let mut stmt = conn
        .prepare(
            "SELECT turn_id, next_turn_id, turn_index, started_at, ended_at, duration_ms,
                    user_preview, event_count, body_event_count
             FROM cursor_ide_turn_summaries
             WHERE session_id = ?1
               AND source_updated_at = ?2
               AND source_bubble_count = ?3
               AND source_fingerprint = ?4
             ORDER BY turn_index ASC",
        )
        .map_err(|err| format!("Failed to prepare Cursor IDE summary cache read: {}", err))?;
    let rows = stmt
        .query_map(
            params![
                session_id,
                source_updated_at,
                source_bubble_count as i64,
                source_fingerprint,
            ],
            |row| {
                let turn_index: i64 = row.get(2)?;
                let event_count: i64 = row.get(7)?;
                let body_event_count: i64 = row.get(8)?;
                Ok(CursorIdeTurnSummary {
                    turn_id: row.get(0)?,
                    next_turn_id: row.get(1)?,
                    turn_index: turn_index.max(0) as usize,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    duration_ms: row.get(5)?,
                    user_preview: row.get(6)?,
                    event_count: event_count.max(0) as usize,
                    body_event_count: body_event_count.max(0) as usize,
                })
            },
        )
        .map_err(|err| format!("Failed to read Cursor IDE summary cache: {}", err))?;

    let summaries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to decode Cursor IDE summary cache: {}", err))?;

    if summaries.is_empty() {
        Ok(None)
    } else {
        Ok(Some(summaries))
    }
}

pub(super) fn upsert_cursor_ide_turn_summaries(
    session_id: &str,
    composer_id: &str,
    source_updated_at: i64,
    source_bubble_count: usize,
    source_fingerprint: &str,
    summaries: &[CursorIdeTurnSummary],
) -> Result<(), String> {
    let mut conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;
    let tx = conn.transaction().map_err(|err| {
        format!(
            "Failed to start Cursor IDE summary cache transaction: {}",
            err
        )
    })?;
    tx.execute(
        "DELETE FROM cursor_ide_turn_summaries WHERE session_id = ?1",
        [session_id],
    )
    .map_err(|err| format!("Failed to clear stale Cursor IDE summaries: {}", err))?;

    let updated_at = chrono::Utc::now().to_rfc3339();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO cursor_ide_turn_summaries
                    (session_id, composer_id, turn_id, next_turn_id, turn_index, started_at,
                     ended_at, duration_ms, user_preview, event_count, body_event_count,
                     source_updated_at, source_bubble_count, source_fingerprint, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            )
            .map_err(|err| format!("Failed to prepare Cursor IDE summary cache write: {}", err))?;
        for summary in summaries {
            stmt.execute(params![
                session_id,
                composer_id,
                summary.turn_id.as_str(),
                summary.next_turn_id.as_deref(),
                summary.turn_index as i64,
                summary.started_at.as_str(),
                summary.ended_at.as_deref(),
                summary.duration_ms,
                summary.user_preview.as_str(),
                summary.event_count as i64,
                summary.body_event_count as i64,
                source_updated_at,
                source_bubble_count as i64,
                source_fingerprint,
                updated_at.as_str(),
            ])
            .map_err(|err| format!("Failed to write Cursor IDE summary cache: {}", err))?;
        }
    }

    tx.commit()
        .map_err(|err| format!("Failed to commit Cursor IDE summary cache: {}", err))?;
    Ok(())
}
