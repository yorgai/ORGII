//! Persistence commands for session data (no Tauri state needed).

use crate::persistence::db_helpers as shared;
use crate::persistence::session_snapshots;
use crate::session::persistence as session_persistence;
use crate::session::{SessionListFilter, SessionStatus};
use crate::state::control_flow::CancelReason;
use crate::state::AgentAppState;
use crate::tools::file_history;
use core_types::workflow::{AgentRole, LinkedSession, LinkedSessionStatus, LinkedSessionType};

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

#[tauri::command]
pub async fn agent_link_session_to_work_item(
    app: tauri::AppHandle,
    session_id: String,
    project_slug: String,
    work_item_id: String,
    agent_role: Option<String>,
) -> Result<serde_json::Value, String> {
    let updated_record = tokio::task::spawn_blocking(move || {
        link_session_to_work_item_sync(
            &session_id,
            &project_slug,
            &work_item_id,
            agent_role.as_deref(),
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    {
        use tauri::Emitter;
        let ts = chrono::Utc::now().to_rfc3339();
        let _ = app.emit(
            project_management::projects::events::DATA_CHANGED_EVENT,
            &ts,
        );
    }

    shared::to_json_value(updated_record).map_err(|err| err.to_string())
}

fn link_session_to_work_item_sync(
    session_id: &str,
    project_slug: &str,
    work_item_id: &str,
    agent_role: Option<&str>,
) -> Result<session_persistence::UnifiedSessionRecord, String> {
    let session = session_persistence::get_session(session_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    if session.project_slug.as_deref() != Some(project_slug)
        || session.work_item_id.as_deref() != Some(work_item_id)
    {
        if let (Some(old_project_slug), Some(old_work_item_id)) = (
            session.project_slug.as_deref(),
            session.work_item_id.as_deref(),
        ) {
            if old_project_slug != project_slug || old_work_item_id != work_item_id {
                remove_linked_session_from_work_item(
                    old_project_slug,
                    old_work_item_id,
                    session_id,
                )?;
            }
        }
    }

    session_persistence::update_work_item_link(session_id, project_slug, work_item_id, agent_role)
        .map_err(|err| err.to_string())?
        .then_some(())
        .ok_or_else(|| format!("Session not found: {session_id}"))?;

    upsert_linked_session_on_work_item(project_slug, work_item_id, &session, agent_role)?;

    session_persistence::get_session(session_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| format!("Session not found after link: {session_id}"))
}

fn remove_linked_session_from_work_item(
    project_slug: &str,
    work_item_id: &str,
    session_id: &str,
) -> Result<(), String> {
    project_management::projects::io::update_work_item_atomic(
        project_slug,
        work_item_id,
        |frontmatter, _body| {
            let original_len = frontmatter.linked_sessions.len();
            frontmatter
                .linked_sessions
                .retain(|linked| linked.session_id != session_id);
            if frontmatter.linked_sessions.len() != original_len {
                frontmatter.updated_at = chrono::Utc::now().to_rfc3339();
            }
            Ok(())
        },
    )
    .map(|_| ())
}

fn upsert_linked_session_on_work_item(
    project_slug: &str,
    work_item_id: &str,
    session: &session_persistence::UnifiedSessionRecord,
    agent_role: Option<&str>,
) -> Result<(), String> {
    project_management::projects::io::update_work_item_atomic(
        project_slug,
        work_item_id,
        |frontmatter, _body| {
            let linked = linked_session_from_record(session, agent_role);
            match frontmatter
                .linked_sessions
                .iter_mut()
                .find(|candidate| candidate.session_id == session.session_id)
            {
                Some(existing) => {
                    existing.session_type = linked.session_type;
                    existing.agent_role = linked.agent_role;
                    existing.status = linked.status;
                    existing.completed_at = linked.completed_at;
                    existing.total_tokens = linked.total_tokens;
                    if existing.result_preview.is_none() {
                        existing.result_preview = linked.result_preview;
                    }
                }
                None => frontmatter.linked_sessions.push(linked),
            }
            frontmatter.updated_at = chrono::Utc::now().to_rfc3339();
            Ok(())
        },
    )
    .map(|_| ())
}

fn linked_session_from_record(
    session: &session_persistence::UnifiedSessionRecord,
    agent_role: Option<&str>,
) -> LinkedSession {
    let status = linked_session_status(&session.status);
    let completed_at = matches!(
        status,
        LinkedSessionStatus::Completed
            | LinkedSessionStatus::Failed
            | LinkedSessionStatus::Cancelled
    )
    .then(|| session.updated_at.clone());
    LinkedSession {
        session_id: session.session_id.clone(),
        session_type: linked_session_type(&session.session_type),
        agent_role: parse_agent_role(agent_role.or(session.agent_role.as_deref())),
        started_at: session.created_at.clone(),
        completed_at,
        status,
        cost_usd: 0.0,
        total_tokens: session.total_tokens.max(0) as u64,
        parent_session_id: session.parent_session_id.clone(),
        sub_agent_name: None,
        sub_agent_instance: None,
        result_preview: session
            .name
            .is_empty()
            .then(|| session.user_input.clone())
            .flatten()
            .or_else(|| Some(session.name.clone())),
    }
}

fn linked_session_status(raw: &str) -> LinkedSessionStatus {
    match SessionStatus::parse(raw) {
        Some(SessionStatus::Failed) => LinkedSessionStatus::Failed,
        Some(SessionStatus::Cancelled | SessionStatus::Abandoned | SessionStatus::Timeout) => {
            LinkedSessionStatus::Cancelled
        }
        Some(
            SessionStatus::Running | SessionStatus::WaitingForUser | SessionStatus::WaitingForFunds,
        ) => LinkedSessionStatus::Running,
        _ => LinkedSessionStatus::Completed,
    }
}

fn linked_session_type(session_type: &str) -> LinkedSessionType {
    match session_type {
        session_persistence::session_type::CODING
        | session_persistence::session_type::GENERIC
        | session_persistence::session_type::DESKTOP
        | session_persistence::session_type::SUBAGENT
        | session_persistence::session_type::ORG_MEMBER => LinkedSessionType::Native,
        _ => LinkedSessionType::Native,
    }
}

fn parse_agent_role(raw: Option<&str>) -> AgentRole {
    match raw.unwrap_or_default() {
        "review" => AgentRole::Review,
        "orchestrator" => AgentRole::Orchestrator,
        "custom" => AgentRole::Custom,
        "sub_agent" => AgentRole::SubAgent,
        _ => AgentRole::Coding,
    }
}
