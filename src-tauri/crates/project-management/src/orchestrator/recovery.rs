//! Recovery — scan for interrupted workflows on app startup.
//!
//! Boot-time detection only: walks `workitem_extras` (the single source of
//! truth for orchestrator runtime state) using SQLite `json_extract` so we
//! don't pay a per-row deserialize on the boot path. The shutdown-side
//! sweep (`mark_all_interrupted_sync`) was hoisted to
//! `agent_core::coordination::work_item_recovery` because it has to query
//! `UnifiedSessionRecord` from the agent runtime.

use crate::projects::io::orchestrator_view;

/// A work item that was interrupted and needs recovery.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptedItem {
    pub project_slug: String,
    pub short_id: String,
    pub title: String,
    pub interrupted_phase: String,
}

/// Scan all work items for interrupted orchestrator workflows.
///
/// Detection: `orchestrator_state.interrupted == true` (primary), or
/// `orchestrator_state.current_phase IN ('coding', 'review')` (fallback
/// for ungraceful exits — any phase still active at boot can't resume
/// itself, so we surface it for user attention).
pub fn scan_interrupted_items() -> Result<Vec<InterruptedItem>, String> {
    let rows = orchestrator_view::list_interrupted_work_items()?;

    Ok(rows
        .into_iter()
        .map(|row| InterruptedItem {
            project_slug: row.project_slug,
            short_id: row.short_id,
            title: row.title,
            interrupted_phase: row.interrupted_phase,
        })
        .collect())
}
