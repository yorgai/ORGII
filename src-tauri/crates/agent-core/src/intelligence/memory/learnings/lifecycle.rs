//! Status-machine transitions for L3 learning rows and the
//! `consolidation_runs` ledger (one row per pass).
//!
//! Read paths (load_pending / load_active_candidates / count_pending /
//! last_consolidation_at) live here too because the consolidation engine
//! uses them in lockstep with the writes below.
//!
//! Browser/UI list and aggregate queries live in `super::stats`.

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqliteResult};
use tracing::{info, warn};
use uuid::Uuid;

use super::crud::{load_learning_by_id, row_to_learning};
use super::schema::{compute_content_hash, SELECT_COLS};
use super::types::Learning;

/// Load all `status = 'pending'` learnings for a scope, oldest first.
/// Used by the consolidation engine to batch raw inserts.
pub fn load_pending_learnings(conn: &Connection, agent_scope: &str) -> SqliteResult<Vec<Learning>> {
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM learnings
         WHERE agent_scope = ?1
           AND status = 'pending'
         ORDER BY created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![agent_scope], row_to_learning)?;
    rows.collect()
}

/// Load the only-`active` candidate pool that consolidation considers when
/// deciding ADD/UPDATE/DELETE/NONE against a pending row. This intentionally
/// excludes `pending` rows — a pending row is never both "the thing we're
/// deciding about" AND "a candidate to merge into".
pub fn load_active_candidates(conn: &Connection, agent_scope: &str) -> SqliteResult<Vec<Learning>> {
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM learnings
         WHERE agent_scope = ?1
           AND status = 'active'
         ORDER BY importance DESC, reinforcement_count DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![agent_scope], row_to_learning)?;
    rows.collect()
}

/// Count pending rows across all scopes. Powers the `forced`
/// trigger (pending count > 50) and the status card.
pub fn count_pending_learnings(conn: &Connection) -> SqliteResult<u64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learnings
         WHERE status = 'pending'",
        [],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

/// Per-scope pending count. Cheap query used by the session-start `lazy`
/// trigger to short-circuit when there's nothing to do.
pub fn count_pending_for_scope(conn: &Connection, agent_scope: &str) -> SqliteResult<u64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learnings
         WHERE agent_scope = ?1 AND status = 'pending'",
        params![agent_scope],
        |row| row.get(0),
    )?;
    Ok(count.max(0) as u64)
}

/// Latest consolidation `finished_at` for an agent scope, or `None` if the
/// scope has never been consolidated.
pub fn last_consolidation_at(conn: &Connection, agent_scope: &str) -> SqliteResult<Option<String>> {
    // The previous `.ok()` here swallowed every error variant
    // including transient DB errors — making `Ok(None)` mean
    // either "never consolidated" OR "couldn't read DB", with
    // the consolidation scheduler unable to tell them apart.
    // `OptionalExtension::optional()` distinguishes
    // `QueryReturnedNoRows` (legitimate `None`) from real DB
    // errors (propagated) so the caller can fail loudly.
    use rusqlite::OptionalExtension;
    let row: Option<String> = conn
        .query_row(
            "SELECT finished_at FROM consolidation_runs
             WHERE agent_scope = ?1
             ORDER BY finished_at DESC LIMIT 1",
            params![agent_scope],
            |row| row.get(0),
        )
        .optional()?;
    Ok(row)
}

/// Transition a pending row to `active`. Idempotent — if the row is already
/// active, this is a no-op. Fails loudly for deprecated/merged rows so the
/// caller notices the status-machine violation.
pub fn promote_pending_to_active(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let now = Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE learnings
         SET status = 'active', updated_at = ?1
         WHERE id = ?2 AND status = 'pending'",
        params![now, learning_id],
    )?;
    if rows == 0 {
        warn!(
            "[learnings] promote_pending_to_active noop for '{}' (not pending)",
            learning_id
        );
    }
    Ok(())
}

/// Transition any live row to `merged`. Used by consolidation when a pending
/// row is absorbed into (or found semantically equivalent to) an existing
/// active row. `merged` rows stay queryable for audit but are hidden from
/// `load_active_learnings`.
pub fn mark_merged(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE learnings
         SET status = 'merged', updated_at = ?1
         WHERE id = ?2 AND status IN ('pending', 'active')",
        params![now, learning_id],
    )?;
    Ok(())
}

/// Permanently abandon a pending learning after a failed consolidation attempt.
/// The row stays queryable for audit, but it leaves the `pending` queue and will
/// never be picked up by `load_pending_learnings` again.
pub fn abandon_pending(conn: &Connection, learning_id: &str) -> SqliteResult<bool> {
    let now = Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE learnings
         SET status = 'abandoned', updated_at = ?1
         WHERE id = ?2 AND status = 'pending'",
        params![now, learning_id],
    )?;
    if rows == 0 {
        warn!(
            "[learnings] abandon_pending noop for '{}' (not pending)",
            learning_id
        );
        return Ok(false);
    }
    Ok(true)
}

/// Feedback loop — mark a learning as just-recalled. Updates
/// `last_recalled_at` (and `updated_at`) so the §4.1 decay formula treats
/// the learning as "fresh". Deliberately does NOT bump
/// `reinforcement_count`; that counter tracks learning events (sightings
/// at extract time), not injections. Conflating them would let a single
/// long-running session inflate a learning's score indefinitely.
///
/// Called from `inject_learnings_into_prompt` via `tokio::spawn`, so
/// failures here must not block the prompt build.
pub fn touch_recall(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE learnings
         SET last_recalled_at = ?1, updated_at = ?1
         WHERE id = ?2 AND status NOT IN ('deprecated', 'abandoned')",
        params![now, learning_id],
    )?;
    Ok(())
}

/// Summary of a consolidation run — one row in `consolidation_runs`. All
/// counters default to 0 so callers can construct incrementally.
#[derive(Debug, Default, Clone)]
pub struct ConsolidationRunRecord {
    pub agent_scope: String,
    pub account_id: Option<String>,
    /// One of `"idle" | "lazy" | "forced" | "manual"`. Kept as &'static str
    /// at call sites via `ConsolidationTrigger::as_str()`.
    pub trigger: String,
    /// One of `"embedding" | "manifest"`.
    pub mode: String,
    pub pending_input: u32,
    pub added: u32,
    pub updated: u32,
    pub deleted: u32,
    pub none_count: u32,
    pub abandoned: u32,
    pub reinforced: u32,
    pub error: Option<String>,
    pub started_at: String,
    pub finished_at: String,
}

/// Persist a `consolidation_runs` row. The caller supplies `started_at` at
/// the top of the pass and calls this at the end with `finished_at`.
pub fn record_consolidation_run(
    conn: &Connection,
    run: &ConsolidationRunRecord,
) -> SqliteResult<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO consolidation_runs (
            id, agent_scope, account_id, trigger, mode,
            pending_input, added, updated, deleted, none_count, abandoned, reinforced,
            error, started_at, finished_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            id,
            run.agent_scope,
            run.account_id,
            run.trigger,
            run.mode,
            run.pending_input,
            run.added,
            run.updated,
            run.deleted,
            run.none_count,
            run.abandoned,
            run.reinforced,
            run.error,
            run.started_at,
            run.finished_at,
        ],
    )?;
    Ok(id)
}

/// Deprecate a learning (soft delete). Sets `status='deprecated'` and tags
/// the row with `evolution_type='deprecated'` so DAG traversals can show it
/// as a tombstone.
pub fn deprecate_learning(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE learnings
         SET evolution_type = 'deprecated',
             status = 'deprecated',
             updated_at = ?1
         WHERE id = ?2",
        params![now, learning_id],
    )?;
    info!("[learnings] Deprecated '{}'", learning_id);
    Ok(())
}

/// Reverse a deprecation — `deprecated` → `active`. Restores the row's
/// `evolution_type` away from `deprecated`; leaves everything else alone.
///
/// Only meaningful as the reverse of `deprecate_learning`; any other
/// `→ active` transition goes through `promote_pending_to_active` (from
/// `pending`) or is a no-op (already active).
pub fn reactivate_learning(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let now = Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE learnings
         SET status = 'active',
             evolution_type = CASE WHEN evolution_type = 'deprecated' THEN 'original' ELSE evolution_type END,
             updated_at = ?1
         WHERE id = ?2 AND status = 'deprecated'",
        params![now, learning_id],
    )?;
    if rows == 0 {
        warn!(
            "[learnings] reactivate_learning noop for '{}' (not deprecated)",
            learning_id
        );
    }
    Ok(())
}

/// Update the user-editable body fields (`takeaway`, `content`) of
/// an existing learning. Does not change status — edits apply to any live row.
/// Recomputes `content_hash` so future write-path dedup still works. Touches
/// `updated_at` but deliberately leaves `reinforcement_count` and
/// `last_recalled_at` alone — a hand edit is not a sighting and not a recall.
pub fn update_learning_body(
    conn: &Connection,
    learning_id: &str,
    takeaway: Option<&str>,
    content: &str,
) -> SqliteResult<()> {
    let existing = load_learning_by_id(conn, learning_id)?;
    let Some(existing) = existing else {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    };
    let new_hash = compute_content_hash(content, existing.category);
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE learnings
         SET content = ?1,
             takeaway = ?2,
             content_hash = ?3,
             updated_at = ?4
         WHERE id = ?5",
        params![content, takeaway, new_hash, now, learning_id],
    )?;
    Ok(())
}

/// Hard delete a learning row. Used only from the Learnings
/// Browser for user-created noise. Callers must validate authorization
/// (there is no owner check at the SQL layer).
pub fn delete_learning(conn: &Connection, learning_id: &str) -> SqliteResult<()> {
    let rows = conn.execute("DELETE FROM learnings WHERE id = ?1", params![learning_id])?;
    if rows == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    info!("[learnings] Hard-deleted '{}'", learning_id);
    Ok(())
}
