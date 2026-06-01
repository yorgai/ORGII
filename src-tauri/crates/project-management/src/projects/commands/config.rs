//! Per-project config: labels, milestones, members.
//!
//! Each command takes a project slug (the public identifier the frontend
//! already passes around in URLs and atoms) and resolves it to a stable
//! project_id once before delegating to IO. Centralizing the lookup here
//! keeps the IO layer purely identity-keyed and lets callers stay
//! slug-keyed without negotiating both forms.

use super::super::io;
use super::super::types::{LabelsFile, MembersFile, MilestonesFile};

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

/// Read every label defined for `project_slug`, sorted alphabetically.
#[tauri::command]
pub async fn project_read_labels(project_slug: String) -> Result<LabelsFile, String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::read_labels(&project_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Replace the entire label set for `project_slug` with `labels`. This
/// is a full upsert (insert + delete missing) executed in a single
/// transaction, mirroring the semantics the frontend already expects
/// from the legacy file-replace contract.
#[tauri::command]
pub async fn project_write_labels(project_slug: String, labels: LabelsFile) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::write_labels(&project_id, &labels)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

// ---------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------

/// Read every milestone defined for `project_slug`.
#[tauri::command]
pub async fn project_read_milestones(project_slug: String) -> Result<MilestonesFile, String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::read_milestones(&project_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Replace the entire milestone set for `project_slug`.
#[tauri::command]
pub async fn project_write_milestones(
    project_slug: String,
    milestones: MilestonesFile,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::write_milestones(&project_id, &milestones)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

// ---------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------

/// Read every member defined for `project_slug`.
#[tauri::command]
pub async fn project_read_members(project_slug: String) -> Result<MembersFile, String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::read_members(&project_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Replace the entire member set for `project_slug`.
#[tauri::command]
pub async fn project_write_members(
    project_slug: String,
    members: MembersFile,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let project_id = resolve_project_id(&project_slug)?;
        io::write_members(&project_id, &members)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/// Resolve `project_slug → project_id` via a single indexed read on
/// `projects.slug`. The error message preserves the slug so frontend
/// toasts can show the user which project failed.
fn resolve_project_id(project_slug: &str) -> Result<String, String> {
    Ok(io::read_project(project_slug)?.meta.id)
}
