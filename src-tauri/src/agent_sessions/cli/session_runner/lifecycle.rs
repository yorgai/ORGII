//! Session lifecycle management — kill, cancel, cleanup.

use super::super::persistence;
use super::super::types::SessionStatus;
use super::helpers::RUNNING_SESSIONS;

#[cfg(unix)]
fn signal_process_tree(pid: i64, signal: libc::c_int) -> bool {
    let pid = pid as libc::pid_t;
    let group_result = unsafe { libc::kill(-pid, signal) };
    if group_result == 0 {
        return true;
    }

    unsafe { libc::kill(pid, signal) == 0 }
}

#[cfg(unix)]
fn process_tree_exists(pid: i64) -> bool {
    let pid = pid as libc::pid_t;
    unsafe { libc::kill(-pid, 0) == 0 || libc::kill(pid, 0) == 0 }
}

#[cfg(unix)]
pub async fn terminate_process_tree(pid: i64, label: &str) {
    let term_result = signal_process_tree(pid, libc::SIGTERM);
    if !term_result {
        return;
    }

    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
    if process_tree_exists(pid) {
        tracing::info!(
            "[CodeSession] {} PID/group {} still alive after SIGTERM grace period, sending SIGKILL",
            label,
            pid
        );
        signal_process_tree(pid, libc::SIGKILL);
    }
}

#[cfg(windows)]
pub async fn terminate_process_tree(pid: i64, _label: &str) {
    let _ = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .await;
}

/// Kill the running agent for a session: abort Tokio task, kill OS process, stop proxy.
///
/// This is the low-level cleanup function. It does NOT update the session status
/// in the database — callers are responsible for setting the appropriate final status
/// (e.g., Cancelled for user cancel, or nothing before a re-run).
pub async fn kill_running_agent(session_id: &str) -> bool {
    let had_running_task = {
        let mut sessions = RUNNING_SESSIONS.lock().await;
        if let Some(handle) = sessions.remove(session_id) {
            handle.abort();
            true
        } else {
            false
        }
    };

    if let Ok(Some(session)) = persistence::get_session(session_id) {
        if let Some(pid) = session.pid {
            terminate_process_tree(pid, session_id).await;
        }
    }

    integrations::proxy::server::stop_session_proxy(session_id).await;

    had_running_task
}

/// Cancel a running session by killing the CLI subprocess.
///
/// Does NOT release the proxy token — follow-up messages via
/// `cli_agent_message` always re-allocate a fresh token anyway.
/// The old token expires via the agent-proxy inactivity timeout or
/// is released on session deletion.
pub async fn cancel_session(session_id: &str) -> Result<bool, String> {
    // The previous `.ok().flatten()` collapsed a DB error and a
    // legitimate "session not found" into the same `None`. The
    // status_changed broadcast below would then ship without
    // `background` / `session_name` populated, and the UI would
    // silently render an "unknown session cancelled" toast. Warn
    // on the DB-error branch so the cause is visible while still
    // proceeding with the cancel (we don't want to fail the cancel
    // just because we couldn't decorate the broadcast).
    let session = match persistence::get_session(session_id) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(
                session_id = %session_id,
                error = %err,
                "cli::cancel_session: get_session DB error; broadcast will lack session metadata"
            );
            None
        }
    };

    let had_running = kill_running_agent(session_id).await;

    persistence::update_status(session_id, SessionStatus::Cancelled)
        .map_err(|e| format!("DB error: {}", e))?;

    let status_msg = serde_json::json!({
        "type": "code_session.status_changed",
        "session_id": session_id,
        "status": "cancelled",
        "background": session.as_ref().is_some_and(|s| s.background),
        "session_name": session.as_ref().map(|s| s.name.clone()),
    });
    crate::api::websocket_handler::broadcast(status_msg.to_string());

    tracing::info!(
        "[CodeSession] Session {} cancelled (had_running={})",
        session_id,
        had_running
    );

    Ok(had_running)
}

/// Clean up the persistent Cursor config directory for a session.
///
/// Called when a session is deleted. Removes `~/.orgii/cursor-config/{session_id}/`
/// which contains CLI config and chat session data used for --resume.
pub fn cleanup_cursor_config_dir(session_id: &str) {
    let config_dir = app_paths::cursor_config_dir(session_id);
    if config_dir.exists() {
        if let Err(err) = std::fs::remove_dir_all(&config_dir) {
            tracing::warn!(
                "[CodeSession] Failed to clean up cursor config dir for {}: {}",
                session_id,
                err
            );
        }
    }
}
