//! Trigger policies for the background consolidation tick.
//!
//! - **Lazy**: per-scope, fires when a scope has pending rows AND its last
//!   consolidation is >24h old. Cheap — called per-scope on the tick.
//! - **Forced**: global, fires when the pending queue exceeds 50 rows.
//! - **Idle**: global, fires when no `agent_sessions.updated_at` is within
//!   the last 5 minutes.
//!
//! Test fixture scopes (`e2e-*`) bypass the tick entirely so they don't
//! produce failing `consolidation_runs` rows every 60s when seeded by the
//! E2E harness.

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};

use crate::intelligence::memory::learnings;

/// Condition for the "lazy" trigger: has the scope been idle for more than
/// 24h AND does it have pending rows? Called at session-start so the
/// decision is made on the hot path but is O(1).
pub(super) fn lazy_trigger_ready(conn: &Connection, scope: &str) -> bool {
    let Ok(pending) = learnings::count_pending_for_scope(conn, scope) else {
        return false;
    };
    if pending == 0 {
        return false;
    }
    // Distinguish "never consolidated" (Ok(None) → fire trigger)
    // from "DB error reading the consolidation_runs table"
    // (Err → log + don't fire). The previous `.ok().flatten()`
    // collapsed both into "fire", which would re-run consolidation
    // every session-start when sqlite was transiently unhealthy.
    let last = match learnings::last_consolidation_at(conn, scope) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                scope = %scope,
                error = %err,
                "consolidation::triggers::lazy: last_consolidation_at DB error; skipping trigger"
            );
            return false;
        }
    };
    let Some(last_at) = last else {
        return true;
    };
    let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(&last_at) else {
        return true;
    };
    let hours = (Utc::now() - last_dt.with_timezone(&Utc)).num_hours();
    hours >= 24
}

/// Condition for the "forced" trigger: pending queue is larger than 50
/// rows globally. Single scalar SELECT.
pub(super) fn forced_trigger_ready(conn: &Connection) -> bool {
    learnings::count_pending_learnings(conn)
        .map(|n| n > 50)
        .unwrap_or(false)
}

/// Cheap idle proxy: the most-recent `agent_sessions.updated_at` across the
/// DB is older than 5 minutes. Used by the background tick as a substitute
/// for real per-window activity tracking.
pub(super) fn idle_trigger_ready(conn: &Connection) -> bool {
    // Distinguish `QueryReturnedNoRows` (legitimate "no sessions yet" →
    // idle, fire trigger) from a transient DB error. The previous
    // `.ok().flatten()` collapsed both into `None` → idle, which would
    // cause the background tick to start a consolidation pass while
    // sqlite was actually unhealthy (lock contention, schema mismatch).
    // Conservative on DB error: warn + return `false` so the tick skips
    // this round instead of stomping on a degraded DB.
    let latest: Option<Option<String>> = match conn
        .query_row(
            "SELECT updated_at FROM agent_sessions ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                error = %err,
                "consolidation::triggers::idle: agent_sessions read failed; skipping idle trigger this tick"
            );
            return false;
        }
    };
    let Some(ts) = latest.flatten() else {
        return true;
    };
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&ts) else {
        return false;
    };
    let minutes = (Utc::now() - dt.with_timezone(&Utc)).num_minutes();
    minutes >= 5
}

/// Returns true when `agent_scope` is reserved for the Rust E2E harness
/// (`src-tauri/crates/e2e-test/src/learning.rs` seeds `e2e-filtered`,
/// `e2e-delete-protection`, etc.).
///
/// The background consolidation tick skips these scopes: seeded rows often
/// have no `source_session_id` / session `model`, so `resolve_batch_provider_info`
/// fails and would append a failing `consolidation_runs` row every 60s forever.
pub(super) fn is_e2e_learnings_test_scope(agent_scope: &str) -> bool {
    agent_scope.starts_with("e2e-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intelligence::memory::consolidation::tests_support::{pending, setup_conn};
    use crate::intelligence::memory::learnings::{insert_learning, LearningStatus};

    #[test]
    fn is_e2e_learnings_test_scope_matches_harness_prefixes() {
        assert!(is_e2e_learnings_test_scope("e2e-filtered"));
        assert!(is_e2e_learnings_test_scope("e2e-delete-protection"));
        assert!(!is_e2e_learnings_test_scope("agent:builtin:sde"));
        assert!(!is_e2e_learnings_test_scope("_global"));
    }

    #[test]
    fn forced_trigger_fires_over_fifty_pending() {
        let conn = setup_conn();
        for idx in 0..51 {
            let p = pending("agent:t", &format!("p{}", idx));
            insert_learning(&conn, &p).unwrap();
        }
        assert!(forced_trigger_ready(&conn));
    }

    #[test]
    fn forced_trigger_quiet_below_fifty() {
        let conn = setup_conn();
        for idx in 0..10 {
            let p = pending("agent:t", &format!("p{}", idx));
            insert_learning(&conn, &p).unwrap();
        }
        assert!(!forced_trigger_ready(&conn));
    }

    #[test]
    fn lazy_trigger_fires_for_scope_never_consolidated() {
        let conn = setup_conn();
        let p = pending("agent:t", "p");
        insert_learning(&conn, &p).unwrap();
        assert!(lazy_trigger_ready(&conn, "agent:t"));
    }

    #[test]
    fn lazy_trigger_quiet_without_pending() {
        let conn = setup_conn();
        let mut l = pending("agent:t", "x");
        l.status = LearningStatus::Active;
        insert_learning(&conn, &l).unwrap();
        assert!(!lazy_trigger_ready(&conn, "agent:t"));
    }

    #[test]
    fn idle_trigger_true_when_no_sessions() {
        let conn = setup_conn();
        assert!(idle_trigger_ready(&conn));
    }

    #[test]
    fn idle_trigger_false_when_recent_session() {
        let conn = setup_conn();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO agent_sessions (session_id, updated_at) VALUES (?1, ?2)",
            rusqlite::params!["s1", now],
        )
        .unwrap();
        assert!(!idle_trigger_ready(&conn));
    }
}
