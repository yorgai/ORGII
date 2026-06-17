use std::collections::BTreeSet;

use chrono::Utc;
use core_types::extracted::{ExtractedData, ExtractedEditData, GitArtifactKind};
use database::db::get_connection;
use orgtrack_core::canonical::SOURCE_ORGII_RUST_AGENTS;
use rusqlite::{params, Connection, OptionalExtension};

use crate::agent_sessions::event_pipeline::types::{EventDisplayStatus, SessionEvent};

const IMPACT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionImpactStats {
    pub files_changed: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub touched_files: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct ImpactDelta {
    touched_files: BTreeSet<String>,
    lines_added: i64,
    lines_removed: i64,
    commit_shas: BTreeSet<String>,
    workspace_path: Option<String>,
    event_ids: BTreeSet<String>,
    last_event_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct StoredImpact {
    touched_files: BTreeSet<String>,
    commit_shas: BTreeSet<String>,
    lines_added: i64,
    lines_removed: i64,
    workspace_path: Option<String>,
}

pub fn record_session_events_async(session_id: String, events: Vec<SessionEvent>) {
    if events.is_empty() {
        return;
    }
    tokio::task::spawn_blocking(move || {
        if let Err(err) = record_session_events(&session_id, &events) {
            tracing::warn!(session_id = %session_id, error = %err, "[orgtrack_impact] failed to record live impact");
        }
    });
}

pub fn get_session_impact(session_id: &str) -> Result<Option<SessionImpactStats>, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    ensure_tables(&conn).map_err(|err| err.to_string())?;
    get_session_impact_from_conn(&conn, session_id).map_err(|err| err.to_string())
}

fn record_session_events(session_id: &str, events: &[SessionEvent]) -> Result<(), String> {
    let mut conn = get_connection().map_err(|err| err.to_string())?;
    ensure_tables(&conn).map_err(|err| err.to_string())?;
    let tx = conn.transaction().map_err(|err| err.to_string())?;

    let fresh_events = filter_unindexed_events(&tx, events).map_err(|err| err.to_string())?;
    let delta = impact_delta_from_events(&fresh_events);
    if delta.event_ids.is_empty() {
        tx.commit().map_err(|err| err.to_string())?;
        return Ok(());
    }

    for event_id in &delta.event_ids {
        tx.execute(
            "INSERT OR IGNORE INTO orgtrack_session_impact_events
             (event_id, session_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                event_id,
                session_id,
                SOURCE_ORGII_RUST_AGENTS,
                delta.last_event_at.as_deref().unwrap_or_default(),
            ],
        )
        .map_err(|err| err.to_string())?;
    }

    let stored = get_stored_impact_from_conn(&tx, session_id).map_err(|err| err.to_string())?;
    let mut touched_files = stored.touched_files;
    touched_files.extend(delta.touched_files.iter().cloned());
    let mut commit_shas = stored.commit_shas;
    commit_shas.extend(delta.commit_shas.iter().cloned());
    let workspace_path = delta.workspace_path.or(stored.workspace_path);
    let touched_files_json =
        serde_json::to_string(&touched_files.iter().cloned().collect::<Vec<_>>())
            .map_err(|err| err.to_string())?;
    let commit_shas_json = serde_json::to_string(&commit_shas.iter().cloned().collect::<Vec<_>>())
        .map_err(|err| err.to_string())?;
    let updated_at = Utc::now().to_rfc3339();

    tx.execute(
        "INSERT INTO orgtrack_session_impacts
         (session_id, source, workspace_path, files_changed, lines_added, lines_removed,
          touched_files_json, commit_shas_json, last_event_at, schema_version, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(session_id) DO UPDATE SET
           source = excluded.source,
           workspace_path = excluded.workspace_path,
           files_changed = excluded.files_changed,
           lines_added = excluded.lines_added,
           lines_removed = excluded.lines_removed,
           touched_files_json = excluded.touched_files_json,
           commit_shas_json = excluded.commit_shas_json,
           last_event_at = excluded.last_event_at,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at",
        params![
            session_id,
            SOURCE_ORGII_RUST_AGENTS,
            workspace_path,
            touched_files.len() as i64,
            stored.lines_added + delta.lines_added,
            stored.lines_removed + delta.lines_removed,
            touched_files_json,
            commit_shas_json,
            delta.last_event_at,
            IMPACT_SCHEMA_VERSION,
            updated_at,
        ],
    )
    .map_err(|err| err.to_string())?;

    tx.commit().map_err(|err| err.to_string())
}

fn filter_unindexed_events(
    conn: &Connection,
    events: &[SessionEvent],
) -> rusqlite::Result<Vec<SessionEvent>> {
    let mut fresh_events = Vec::new();
    for event in events {
        let exists = conn
            .query_row(
                "SELECT 1 FROM orgtrack_session_impact_events WHERE event_id = ?1 LIMIT 1",
                params![&event.id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            fresh_events.push(event.clone());
        }
    }
    Ok(fresh_events)
}

fn impact_delta_from_events(events: &[SessionEvent]) -> ImpactDelta {
    let mut delta = ImpactDelta::default();
    for event in events {
        if event.display_status != EventDisplayStatus::Completed {
            continue;
        }
        delta.last_event_at = Some(event.created_at.clone());
        if delta.workspace_path.is_none() {
            delta.workspace_path = event.repo_path.clone();
        }
        match event.extracted.as_ref() {
            Some(ExtractedData::Edit(edit)) => {
                collect_edit_delta(&mut delta, edit);
                if !delta.touched_files.is_empty() {
                    delta.event_ids.insert(event.id.clone());
                }
            }
            Some(ExtractedData::Shell(shell)) => {
                if let Some(artifacts) = shell.git_artifacts.as_ref() {
                    for artifact in artifacts {
                        if artifact.kind == GitArtifactKind::Commit {
                            if let Some(sha) = artifact.sha.as_ref().filter(|sha| !sha.is_empty()) {
                                delta.commit_shas.insert(sha.clone());
                            }
                        }
                    }
                    if !delta.commit_shas.is_empty() {
                        delta.event_ids.insert(event.id.clone());
                    }
                }
            }
            _ => {}
        }
    }
    delta
}

fn collect_edit_delta(delta: &mut ImpactDelta, edit: &ExtractedEditData) {
    if edit.apply_patch_segments.is_empty() {
        add_edit_segment(delta, edit);
        return;
    }
    for segment in &edit.apply_patch_segments {
        add_edit_segment(delta, segment);
    }
}

fn add_edit_segment(delta: &mut ImpactDelta, edit: &ExtractedEditData) {
    if edit.file_path.trim().is_empty() {
        return;
    }
    delta.touched_files.insert(edit.file_path.clone());
    delta.lines_added += edit.lines_added.unwrap_or(0) as i64;
    delta.lines_removed += edit.lines_removed.unwrap_or(0) as i64;
}

fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS orgtrack_session_impacts (
            session_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            workspace_path TEXT,
            files_changed INTEGER NOT NULL DEFAULT 0,
            lines_added INTEGER NOT NULL DEFAULT 0,
            lines_removed INTEGER NOT NULL DEFAULT 0,
            touched_files_json TEXT NOT NULL DEFAULT '[]',
            commit_shas_json TEXT NOT NULL DEFAULT '[]',
            last_event_at TEXT,
            schema_version INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS orgtrack_session_impact_events (
            event_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_orgtrack_session_impact_events_session
            ON orgtrack_session_impact_events(session_id);
         CREATE TABLE IF NOT EXISTS orgtrack_session_impact_backfills (
            session_id TEXT PRIMARY KEY,
            event_count INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT NOT NULL
         );",
    )
}

fn get_session_impact_from_conn(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<SessionImpactStats>> {
    get_stored_impact_from_conn(conn, session_id).map(|impact| {
        if impact.touched_files.is_empty() && impact.lines_added == 0 && impact.lines_removed == 0 {
            None
        } else {
            Some(SessionImpactStats {
                files_changed: impact.touched_files.len() as i64,
                lines_added: impact.lines_added,
                lines_removed: impact.lines_removed,
                touched_files: impact.touched_files.into_iter().collect(),
            })
        }
    })
}

fn get_stored_impact_from_conn(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<StoredImpact> {
    conn.query_row(
        "SELECT workspace_path, lines_added, lines_removed, touched_files_json, commit_shas_json
         FROM orgtrack_session_impacts WHERE session_id = ?1",
        params![session_id],
        |row| {
            let workspace_path: Option<String> = row.get(0)?;
            let lines_added: i64 = row.get(1)?;
            let lines_removed: i64 = row.get(2)?;
            let touched_files_json: String = row.get(3)?;
            let commit_shas_json: String = row.get(4)?;
            Ok(StoredImpact {
                workspace_path,
                lines_added,
                lines_removed,
                touched_files: parse_string_set(&touched_files_json),
                commit_shas: parse_string_set(&commit_shas_json),
            })
        },
    )
    .optional()
    .map(|value| value.unwrap_or_default())
}

fn parse_string_set(raw: &str) -> BTreeSet<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .unwrap_or_default()
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect()
}
