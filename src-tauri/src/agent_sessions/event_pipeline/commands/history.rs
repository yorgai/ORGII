//! Session History & Statistics Commands
//!
//! Query session history, group sessions, compute statistics, and
//! subagent/parent session queries.

use crate::agent_sessions::event_pipeline::history::{
    self, HistoryQuery, HistoryResult, SessionGroup, SessionRecord,
};
use crate::agent_sessions::event_pipeline::statistics::{self, SessionStatistics};
use agent_core::session::persistence::UnifiedSessionRecord;

/// Query session history with filtering, sorting, and pagination.
#[tauri::command]
pub async fn es_query_session_history(
    sessions: Vec<SessionRecord>,
    query: HistoryQuery,
) -> Result<HistoryResult, String> {
    Ok(history::query_sessions(&sessions, &query))
}

/// Get the N most recently updated sessions.
#[tauri::command]
pub async fn es_get_recent_sessions(
    sessions: Vec<SessionRecord>,
    limit: usize,
) -> Result<Vec<SessionRecord>, String> {
    Ok(history::get_recent_sessions(&sessions, limit))
}

/// Group sessions by a field (status, type, repo, date).
#[tauri::command]
pub async fn es_group_sessions(
    sessions: Vec<SessionRecord>,
    group_by: String,
) -> Result<Vec<SessionGroup>, String> {
    Ok(history::group_sessions(&sessions, &group_by))
}

/// Compute aggregate statistics across session records.
#[tauri::command]
pub async fn es_compute_session_statistics(
    sessions: Vec<SessionRecord>,
) -> Result<SessionStatistics, String> {
    Ok(statistics::compute_session_statistics(&sessions))
}

// ============================================================================
// Subagent / Parent Session Queries
// ============================================================================

/// Get all child sessions for a given parent session.
#[tauri::command]
pub async fn es_get_child_sessions(
    parent_session_id: String,
) -> Result<Vec<UnifiedSessionRecord>, String> {
    agent_core::session::persistence::get_child_sessions(&parent_session_id)
        .map_err(|e| format!("Failed to get child sessions: {}", e))
}

/// Get the parent session for a given child session.
#[tauri::command]
pub async fn es_get_parent_session(
    session_id: String,
) -> Result<Option<UnifiedSessionRecord>, String> {
    agent_core::session::persistence::get_parent_session(&session_id)
        .map_err(|e| format!("Failed to get parent session: {}", e))
}
