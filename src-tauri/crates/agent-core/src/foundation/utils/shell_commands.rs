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
