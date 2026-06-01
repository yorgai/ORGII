//! Orchestrator-flavored read paths over `workitem_extras`.
//!
//! The orchestrator's runtime state (`current_phase`, `interrupted`,
//! `linked_sessions`, …) is persisted to `workitem_extras.extras_json`
//! by `update_work_item_atomic`. `workitem_extras` is the single
//! source of truth.
//!
//! These helpers expose narrow read shapes the orchestrator commands
//! actually need so we don't pay for a full `WorkItemFrontmatter`
//! deserialize on every status poll.

use rusqlite::{params, OptionalExtension};

use super::super::helpers::{conn, map_db};
use crate::projects::types::{LinkedSession, OrchestratorState};

/// One row's worth of orchestrator state, joined to the project slug
/// and work-item short-id so callers don't need a second lookup.
#[derive(Debug, Clone)]
pub struct InterruptedRow {
    pub project_slug: String,
    pub short_id: String,
    pub title: String,
    /// The phase that was running when the interrupt happened. Falls
    /// back to `current_phase` when `interrupted_phase` is unset (the
    /// "ungraceful exit" path).
    pub interrupted_phase: String,
}

/// Read just `orchestrator_state` for one work item.
///
/// Returns `Ok(None)` when the work item exists but has no orchestrator
/// state recorded (i.e. the workflow has never run). Returns
/// `Err(...)` when the work item doesn't exist at all — same contract
/// as `read_work_item`.
pub fn read_orchestrator_state(
    project_slug: &str,
    short_id: &str,
) -> Result<Option<OrchestratorState>, String> {
    let connection = conn()?;

    let extras_json: Option<String> = map_db(
        connection
            .query_row(
                "SELECT we.extras_json
                 FROM workitem_extras we
                 JOIN workitems wi ON wi.id = we.work_item_id
                 JOIN projects p ON p.id = wi.project_id
                 WHERE p.slug = ?1 AND wi.short_id = ?2",
                params![project_slug, short_id],
                |row| row.get::<_, String>(0),
            )
            .optional(),
    )?;

    let Some(json) = extras_json else {
        // Distinguish "work item missing" from "extras row missing": a
        // freshly-written work item always has an extras row (the write
        // path inserts both atomically), so missing-extras implies
        // missing-workitem.
        return Err(format!("Work item '{}' not found", short_id));
    };

    Ok(extract_orchestrator_state(&json))
}

/// Read just the `linked_sessions` vec for one work item.
///
/// Same not-found semantics as `read_orchestrator_state`. Returns
/// `Ok(vec![])` when the work item exists but has no sessions yet.
pub fn read_linked_sessions(
    project_slug: &str,
    short_id: &str,
) -> Result<Vec<LinkedSession>, String> {
    let connection = conn()?;

    let extras_json: Option<String> = map_db(
        connection
            .query_row(
                "SELECT we.extras_json
                 FROM workitem_extras we
                 JOIN workitems wi ON wi.id = we.work_item_id
                 JOIN projects p ON p.id = wi.project_id
                 WHERE p.slug = ?1 AND wi.short_id = ?2",
                params![project_slug, short_id],
                |row| row.get::<_, String>(0),
            )
            .optional(),
    )?;

    let Some(json) = extras_json else {
        return Err(format!("Work item '{}' not found", short_id));
    };

    Ok(extract_linked_sessions(&json))
}

/// Enumerate every work item whose orchestrator was interrupted.
///
/// Detection rule (matches the legacy `orchestrator_runs` query):
///   `orchestrator_state.interrupted == true` (graceful shutdown), OR
///   `orchestrator_state.current_phase IN ('coding','review')` (ungraceful
///   exit — we treat any active phase at boot as interrupted, since
///   the agent loop has no way to resume itself across a restart).
///
/// We use SQLite's built-in `json_extract` to push the filter into the
/// query so a project with thousands of completed work items doesn't
/// pay a JSON deserialize per row.
pub fn list_interrupted_work_items() -> Result<Vec<InterruptedRow>, String> {
    let connection = conn()?;

    let mut stmt = map_db(connection.prepare(
        "SELECT p.slug, wi.short_id, wi.title,
                COALESCE(
                    json_extract(we.extras_json, '$.orchestrator_state.interrupted_phase'),
                    json_extract(we.extras_json, '$.orchestrator_state.current_phase')
                )
         FROM workitem_extras we
         JOIN workitems wi ON wi.id = we.work_item_id
         JOIN projects p ON p.id = wi.project_id
         WHERE json_extract(we.extras_json, '$.orchestrator_state.interrupted') = 1
            OR json_extract(we.extras_json, '$.orchestrator_state.current_phase')
                   IN ('coding', 'review')",
    ))?;

    let rows = map_db(stmt.query_map([], |row| {
        Ok(InterruptedRow {
            project_slug: row.get::<_, String>(0)?,
            short_id: row.get::<_, String>(1)?,
            title: row.get::<_, String>(2)?,
            interrupted_phase: row
                .get::<_, Option<String>>(3)?
                .unwrap_or_else(|| "idle".to_string()),
        })
    }))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(map_db(row)?);
    }
    Ok(out)
}

/// Flip `orchestrator_state.interrupted` to `true` (and snapshot the
/// current phase into `interrupted_phase`) for every `(project_slug,
/// short_id)` whose current state has `interrupted == false`.
///
/// Returns the number of rows actually mutated. An empty input set is
/// a no-op that returns `Ok(0)` without opening a transaction.
///
/// Called from the Tauri ExitRequested handler. Each row is flipped in
/// its own short SQLite transaction (via `update_work_item_atomic`),
/// matching the legacy semantics where a partial failure just logs
/// and continues.
pub fn mark_work_items_interrupted(targets: &[(String, String)]) -> Result<usize, String> {
    if targets.is_empty() {
        return Ok(0);
    }

    let mut updated = 0usize;
    for (project_slug, short_id) in targets {
        // We use the atomic RMW path so the persistence stays consistent
        // with every other orchestrator write — if a future field gets
        // added to ExtrasPayload, we reserialize it here too.
        let result =
            super::atomic::update_work_item_atomic(project_slug, short_id, |frontmatter, _body| {
                let state = frontmatter
                    .orchestrator_state
                    .get_or_insert_with(Default::default);
                if state.interrupted {
                    return Ok::<bool, String>(false);
                }
                state.interrupted = true;
                if state.interrupted_phase.is_none() {
                    state.interrupted_phase = Some(state.current_phase.clone());
                }
                Ok::<bool, String>(true)
            });

        match result {
            Ok(true) => updated += 1,
            Ok(false) => {}
            Err(err) => {
                tracing::warn!(
                    "[orchestrator_view] mark_work_items_interrupted: {}/{} failed: {}",
                    project_slug,
                    short_id,
                    err
                );
            }
        }
    }

    Ok(updated)
}

// ---------------------------------------------------------------------
// Internal extractors
// ---------------------------------------------------------------------

fn extract_orchestrator_state(extras_json: &str) -> Option<OrchestratorState> {
    // Silent `None` here merges two distinct cases: "row is corrupt"
    // and "row legitimately has no orchestrator_state". The orchestrator
    // panel would render "no state" for a corrupt row, and the next
    // user click would write a fresh state, overwriting the corrupt
    // bytes. Warn so corruption surfaces. The two parse calls are kept
    // separate (top-level extras parse vs typed state parse) so the
    // log identifies which layer failed.
    let value: serde_json::Value = match serde_json::from_str(extras_json) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                error = %err,
                raw_len = extras_json.len(),
                "work_items::orchestrator_view: extras_json top-level parse failed; orchestrator state unavailable"
            );
            return None;
        }
    };
    let state_value = value.get("orchestrator_state")?.clone();
    if state_value.is_null() {
        return None;
    }
    match serde_json::from_value::<OrchestratorState>(state_value) {
        Ok(s) => Some(s),
        Err(err) => {
            tracing::warn!(
                error = %err,
                "work_items::orchestrator_view: orchestrator_state typed parse failed; treating as no-state"
            );
            None
        }
    }
}

fn extract_linked_sessions(extras_json: &str) -> Vec<LinkedSession> {
    // Same data-loss rationale as `extract_orchestrator_state`: a
    // silent empty Vec on corruption renders "no linked sessions"
    // and the next link operation would overwrite the corrupt row.
    let value: serde_json::Value = match serde_json::from_str(extras_json) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                error = %err,
                raw_len = extras_json.len(),
                "work_items::orchestrator_view: extras_json top-level parse failed; linked_sessions unavailable"
            );
            return Vec::new();
        }
    };
    let Some(arr) = value.get("linked_sessions") else {
        return Vec::new();
    };
    match serde_json::from_value::<Vec<LinkedSession>>(arr.clone()) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "work_items::orchestrator_view: linked_sessions typed parse failed; treating as empty"
            );
            Vec::new()
        }
    }
}

#[cfg(test)]
#[path = "orchestrator_view_tests.rs"]
mod tests;
