//! Mark every running SDE-agent session as interrupted on graceful shutdown.
//!
//! This lives in `agent_core` (not `project_management`) because it has to
//! reach into `UnifiedSessionRecord` — agent_core's own runtime row layout
//! — to find which sessions are still running. It then writes back to the
//! projects DB through the public `project_management::orchestrator_view`
//! API, so the projects table stays the single source of truth for
//! work-item runtime state.
//!
//! Called synchronously from Tauri's `ExitRequested` handler in
//! `lib.rs::run()`. The companion `scan_interrupted_items` (boot-side
//! detection) stays in `project_management::orchestrator::recovery` since
//! it is a pure projects-DB scan with no agent_core types involved.

use std::collections::HashSet;

use core_types::session::SessionListFilter;

use project_management::projects::io::orchestrator_view;

/// Flip `orchestrator_state.interrupted` on every running SDE work item.
///
/// Collects every running SDE session via
/// `agent_core::session::persistence::list_sessions`, resolves each to its
/// `(project_slug, short_id)` pair, deduplicates, and writes a single
/// batched update through `orchestrator_view::mark_work_items_interrupted`.
/// Sessions missing either field are skipped — they have no work item to
/// flip. Errors are logged, not propagated; the shutdown handler must not
/// block on this best-effort sweep.
pub fn mark_all_interrupted_sync() {
    use crate::session::persistence as session_persistence;

    let filter = SessionListFilter {
        type_name: Some("sde".to_string()),
        ..Default::default()
    };
    let sessions = match session_persistence::list_sessions(&filter) {
        Ok(s) => s,
        Err(_) => return,
    };

    let mut targets: HashSet<(String, String)> = HashSet::new();
    for session in sessions.iter().filter(|s| s.status == "running") {
        if let (Some(slug), Some(short_id)) =
            (session.project_slug.clone(), session.work_item_id.clone())
        {
            targets.insert((slug, short_id));
        }
    }

    if targets.is_empty() {
        return;
    }

    let targets_vec: Vec<(String, String)> = targets.into_iter().collect();
    match orchestrator_view::mark_work_items_interrupted(&targets_vec) {
        Ok(updated) if updated > 0 => {
            tracing::info!(
                "[work_item_recovery] Marked {} active run(s) interrupted",
                updated
            );
        }
        Ok(_) => {}
        Err(err) => {
            tracing::warn!(
                "[work_item_recovery] mark_work_items_interrupted failed: {}",
                err
            );
        }
    }
}
