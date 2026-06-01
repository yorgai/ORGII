//! Init / path-resolution commands.
//!
//! Project init/detect commands are intentionally absent:
//! - The project store is global and creates rows on demand via
//!   `project_write_project`, so there's nothing to bootstrap in a repo.
//! - Detection is just store availability; any list call returns projects.
//!
//! What remains here is the workspace path helper that the Project
//! Manager sidebar still needs to render the fixed Personal Workspace
//! entry — independent of the project store, but logically grouped
//! with init-style discovery commands.

/// Return the OS Agent personal workspace path
/// (`~/.orgii/personal/workspace/`).
///
/// Used by the Project Manager sidebar to render a fixed "Personal
/// Workspace" entry above the user's projects. The path is stable
/// across runs; we resolve it on every call instead of caching so a
/// `ORGII_HOME` override (used by tests + portable installs) takes
/// effect without a restart.
#[tauri::command]
pub async fn project_personal_workspace() -> Result<String, String> {
    let workspace = app_paths::personal_workspace();
    Ok(workspace.to_string_lossy().to_string())
}
