//! Persistence commands for session data (no Tauri state needed).

use crate::persistence::db_helpers as shared;
use crate::persistence::session_snapshots;
use crate::session::persistence as session_persistence;
use crate::session::SessionListFilter;
use crate::state::control_flow::CancelReason;
use crate::state::AgentAppState;
use crate::tools::file_history;

/// Load conversation messages for a session.
#[tauri::command]
pub async fn agent_load_messages(session_id: String) -> Result<Vec<serde_json::Value>, String> {
    shared::spawn_blocking_cmd(move || {
        let messages = session_persistence::load_messages(&session_id)?;
        messages.into_iter().map(shared::to_json_value).collect()
    })
    .await
}

/// Get a single session record by ID.
#[tauri::command]
pub async fn agent_get_session(session_id: String) -> Result<Option<serde_json::Value>, String> {
    shared::spawn_blocking_cmd(move || {
        session_persistence::get_session(&session_id)?
            .map(shared::to_json_value)
            .transpose()
    })
    .await
}

/// List all sessions from both OS and SDE, merged into one array.
#[tauri::command]
pub async fn agent_list_all_sessions() -> Result<Vec<serde_json::Value>, String> {
    shared::spawn_blocking_cmd(move || {
        let filter = SessionListFilter::default();
        let records = session_persistence::list_sessions(&filter)?;
        records.into_iter().map(shared::to_json_value).collect()
    })
    .await
}

/// Delete a session and all related data.
#[tauri::command]
pub async fn agent_delete_session(session_id: String) -> Result<(), String> {
    shared::spawn_blocking_cmd(move || session_persistence::delete_session(&session_id)).await
}

/// Clear all messages for a session.
#[tauri::command]
pub async fn agent_clear_messages(session_id: String) -> Result<i64, String> {
    shared::spawn_blocking_cmd(move || session_persistence::clear_messages(&session_id)).await
}

/// Truncate messages at or after a timestamp.
///
/// When `revert_files` is true (default behavior for edit/regenerate flows),
/// also rewinds the per-session file-history so edited files are restored to
/// their pre-turn state. When false (e.g. "continue with changes"), file
/// contents are left as-is and only message rows are dropped.
#[tauri::command]
pub async fn agent_truncate_after_message(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    created_at: String,
    revert_files: Option<bool>,
) -> Result<i64, String> {
    if let Some(session) = state.get_session(&session_id).await {
        session.scheduler.invalidate_pending();
        session
            .cancel_active_turn(CancelReason::ModeSwitchAbort)
            .await;
    }

    let should_revert = revert_files.unwrap_or(true);
    tokio::task::spawn_blocking(move || -> Result<i64, String> {
        if should_revert {
            let stats = file_history::rewind_to_message(&session_id, &created_at)
                .map_err(|err| format!("file-history rewind failed: {err}"))?;
            tracing::info!(
                "[agent_truncate] file-history rewind: restored={} deleted={} skipped={} failed={}",
                stats.restored,
                stats.deleted,
                stats.skipped_unchanged,
                stats.failed,
            );
        }

        session_snapshots::truncate_snapshots_after(&session_id, &created_at)
            .map_err(|err| err.to_string())?;
        session_persistence::truncate_messages_after(&session_id, &created_at)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Check whether rewinding to a message would modify files on disk. Used by
/// the frontend to decide whether to show a "keep or revert changes" dialog
/// before regenerating / editing a past message.
#[tauri::command]
pub async fn agent_check_snapshot_changes(
    session_id: String,
    created_at: String,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        file_history::has_changes_after_message(&session_id, &created_at)
            .map_err(|e| format!("file-history check failed: {}", e))
    })
    .await
    .map_err(|err| format!("Task error: {}", err))?
}

/// Update session status.
#[tauri::command]
pub async fn agent_update_session_status(
    session_id: String,
    status: String,
) -> Result<bool, String> {
    // Reject unknown status strings instead of silently downgrading to
    // `Idle` — that previously made stuck-state rows invisible (a row
    // wedged in a malformed terminal state would silently look idle to
    // the lifecycle manager).
    let parsed = crate::session::SessionStatus::parse(&status)
        .ok_or_else(|| format!("Unknown session status: {status:?}"))?;
    shared::spawn_blocking_cmd(move || session_persistence::update_status(&session_id, parsed))
        .await
}

/// Return the `workspace_path` for a session. Used by the frontend to resolve
/// file paths for the WorkStation diff view when opening a session's changes
/// from the Group Chat feed.
#[tauri::command]
pub async fn agent_get_session_workspace_path(
    session_id: String,
) -> Result<Option<String>, String> {
    shared::spawn_blocking_cmd(move || {
        crate::persistence::session_snapshots::get_session_workspace_path(&session_id)
    })
    .await
}

/// Save (upsert) a session record.
#[tauri::command]
pub async fn agent_save_session(session: serde_json::Value) -> Result<(), String> {
    let record: session_persistence::UnifiedSessionRecord = serde_json::from_value(session)
        .map_err(|err| format!("Failed to deserialize session: {}", err))?;
    shared::spawn_blocking_cmd(move || session_persistence::upsert_session(&record)).await
}
