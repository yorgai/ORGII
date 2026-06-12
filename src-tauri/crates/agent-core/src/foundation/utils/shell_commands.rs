//! Tauri commands for agent shell process management.
//!
//! Provides the `agent_kill_shell_process` command for the frontend Stop button
//! and `agent_list_running_shell_jobs` for reconciliation after hot reloads.

use crate::tools::impls::coding::exec::registry;
use tracing::info;

/// Kill an agent shell process by PID.
///
/// This is the Tauri command invoked when the user clicks Stop in the chat
/// TerminalBlock. Only processes spawned by the agent are killable; the
/// frontend should only send PIDs received from `agent:shell_process_started`.
#[tauri::command]
pub async fn agent_kill_shell_process(pid: u32) -> Result<String, String> {
    info!("[agent_kill_shell_process] Killing PID {}", pid);
    registry::terminate_shell_process_tree(pid).await
}

/// List all currently running agent shell jobs (across all sessions).
///
/// Thin wrapper around `registry::list_running_shell_jobs()`. The frontend
/// calls this on startup to reseed `shellProcessMapAtom` with processes
/// that survived a hot reload / page refresh.
#[tauri::command]
pub fn agent_list_running_shell_jobs() -> Vec<registry::RunningShellJob> {
    registry::list_running_shell_jobs()
}

/// List all currently running background subagents (across all sessions).
///
/// Subagent counterpart of `agent_list_running_shell_jobs`, consumed by the
/// same reconciliation hook to reseed the ActiveProcesses pin bar after a
/// hot reload / page refresh.
#[tauri::command]
pub fn agent_list_running_subagent_jobs() -> Vec<registry::RunningSubagentJob> {
    registry::list_running_subagent_jobs()
}

/// Kill a background subagent by its job-registry handle.
///
/// Invoked from the ActiveProcesses pin bar's stop button. Cooperative-first
/// (sets the job's own cancel flag, 10s watchdog before hard abort) — see
/// `registry::kill_subagent`.
#[tauri::command]
pub fn agent_kill_subagent_job(handle: String) -> Result<(), String> {
    info!("[agent_kill_subagent_job] Killing subagent '{}'", handle);
    registry::kill_subagent(&handle)
}

/// Debug-only: drive the REAL background-subagent registration path without
/// an LLM turn.
///
/// Calls the production `registry::register_subagent`, which broadcasts
/// `agent:subagent_job_changed` through the real bus → IPC channel →
/// frontend handler chain. Used by the WDIO wire-path spec so the only
/// substituted link in the e2e chain is the LLM's decision to launch a
/// worker — everything downstream (registry, broadcast, channel dispatch,
/// atom, pin bar, kill round-trip) is live production code.
#[tauri::command]
pub fn debug_seed_subagent_job(
    session_id: String,
    handle: String,
    agent_name: String,
    subagent_type: Option<String>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("debug_seed_subagent_job is only available in debug builds".into());
    }
    info!(
        "[debug_seed_subagent_job] Registering wire-path fixture '{}' for session {}",
        handle, session_id
    );
    let (_tx, _cancel_flag) = registry::register_subagent(
        handle,
        subagent_type.unwrap_or_else(|| "delegate".into()),
        agent_name,
        session_id,
    );
    Ok(())
}
