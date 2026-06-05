//! E2E scenarios for the file-history / snapshot system.
//!
//! File deletion flows through the first-class `delete_file` tool. The snapshot
//! system must capture deleted files so they can be restored via rewind.

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;
use std::path::Path;

/// Verify that deleting a file creates a recoverable snapshot.
///
/// Steps:
///   1. Create a file in a fresh workspace directory.
///   2. Ask the agent to delete it via `delete_file` (not `run_shell`/`rm`).
///   3. Assert the file is gone AND a file-history snapshot exists on disk
///      with the deleted file tracked.
pub async fn delete_file_snapshot(cfg: &Config) -> bool {
    let session_id = format!("{}-delete-snapshot", cfg.session_prefix);
    let project = tmp_workspace_path("delete-snapshot");
    let _ = std::fs::create_dir_all(&project);

    let target = Path::new(&project).join("doomed.txt");
    let _ = std::fs::write(&target, "this file will be deleted by the agent");

    match harness::send_sde_message(
        cfg,
        &format!(
            "Delete the file at '{}' using the delete_file tool directly. \
             Do NOT use a shell command (no `rm`, no `run_shell`). After deleting, \
             confirm it no longer exists.",
            target.display()
        ),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Delete File Snapshot", &err),
        Ok(resp) => {
            let content_lower = resp.content.to_lowercase();
            let file_gone = !target.exists();
            let used_delete_path = harness::assert_sde_tool_used(&resp, "delete_file");

            // Verify the snapshot directory exists and contains a backup of the
            // deleted file. Layout (see `agent_core::tools::file_history`):
            //   ~/.orgii/file-history/<session_id>/snapshots/<snapshot_id>.json
            //   ~/.orgii/file-history/<session_id>/backups/<content_hash>
            let home = std::env::var("HOME").unwrap_or_default();
            let snapshots_dir = Path::new(&home)
                .join(".orgii")
                .join("file-history")
                .join(&session_id)
                .join("snapshots");
            let (snapshot_exists, manifest_tracks_file) =
                inspect_session_snapshots(&snapshots_dir, &target);

            harness::print_result(
                "Delete File Snapshot",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("File actually deleted", file_gone),
                    (
                        "Agent confirms deletion",
                        content_lower.contains("deleted")
                            || content_lower.contains("removed")
                            || content_lower.contains("gone")
                            || content_lower.contains("no longer exists"),
                    ),
                    ("Used delete_file", used_delete_path),
                    ("Snapshot directory exists", snapshot_exists),
                    ("Manifest tracks deleted file", manifest_tracks_file),
                ],
            )
        }
    }
}

pub async fn create_file_rewind_deletes_created_file(cfg: &Config) -> bool {
    let session_id = format!("{}-create-rewind", cfg.session_prefix);
    let project = tmp_workspace_path("create-rewind");
    let _ = std::fs::create_dir_all(&project);

    let target = Path::new(&project).join("codex-created-then-rewound.txt");
    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }

    match harness::send_sde_message(
        cfg,
        &format!(
            "Use the edit_file tool to create exactly this file: '{}'. The file content must be exactly 'CODEX_BACKEND_REWIND_MARKER'. Do NOT use a shell command. After creating it, confirm the file exists.",
            target.display()
        ),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Create File Rewind Deletes Created File", &err),
        Ok(resp) => {
            let created = target.exists();
            let used_edit_file = harness::assert_sde_tool_used(&resp, "edit_file");
            let content_ok = std::fs::read_to_string(&target)
                .map(|content| content == "CODEX_BACKEND_REWIND_MARKER")
                .unwrap_or(false);

            let snapshots = agent_core::persistence::session_snapshots::get_snapshots(&session_id)
                .unwrap_or_default();
            let earliest_created_at = snapshots.first().map(|(_, _, created_at)| created_at.clone());
            let rewind_stats = earliest_created_at
                .as_deref()
                .and_then(|created_at| {
                    agent_core::tools::file_history::rewind_to_message(&session_id, created_at).ok()
                });
            let rewound_deleted = !target.exists();
            let deleted_count = rewind_stats.as_ref().map(|stats| stats.deleted).unwrap_or(0);
            let failed_count = rewind_stats.as_ref().map(|stats| stats.failed).unwrap_or(1);

            harness::print_result(
                "Create File Rewind Deletes Created File",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("Used edit_file", used_edit_file),
                    ("File actually created", created),
                    ("Created file content matches marker", content_ok),
                    ("Snapshot row exists", earliest_created_at.is_some()),
                    ("Backend rewind deleted created file", rewound_deleted && deleted_count >= 1),
                    ("Backend rewind had no failures", failed_count == 0),
                ],
            )
        }
    }
}

/// Verify that the first-class `delete_file` tool creates a recoverable snapshot.
///
/// This pins that the restored builtin `delete_file` tool stays wired through
/// registration, policy, and file history snapshot guards.
pub async fn delete_file_tool_snapshot(cfg: &Config) -> bool {
    let session_id = format!("{}-delete-tool-snapshot", cfg.session_prefix);
    let project = tmp_workspace_path("delete-tool-snapshot");
    let _ = std::fs::create_dir_all(&project);

    let target = Path::new(&project).join("delete-me-directly.txt");
    let _ = std::fs::write(&target, "this file must be deleted by delete_file");

    match harness::send_sde_message(
        cfg,
        &format!(
            "Delete the file at '{}' using the delete_file tool directly. Do NOT use a shell command, and do NOT use rm. After deleting, confirm it no longer exists.",
            target.display()
        ),
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Delete File Tool Snapshot", &err),
        Ok(resp) => {
            let content_lower = resp.content.to_lowercase();
            let file_gone = !target.exists();
            let used_delete_file = harness::assert_sde_tool_used(&resp, "delete_file");

            let home = std::env::var("HOME").unwrap_or_default();
            let snapshots_dir = Path::new(&home)
                .join(".orgii")
                .join("file-history")
                .join(&session_id)
                .join("snapshots");
            let (snapshot_exists, manifest_tracks_file) =
                inspect_session_snapshots(&snapshots_dir, &target);

            harness::print_result(
                "Delete File Tool Snapshot",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("File actually deleted", file_gone),
                    (
                        "Agent confirms deletion",
                        content_lower.contains("deleted")
                            || content_lower.contains("removed")
                            || content_lower.contains("gone")
                            || content_lower.contains("no longer exists"),
                    ),
                    ("Used delete_file tool", used_delete_file),
                    ("Snapshot directory exists", snapshot_exists),
                    ("Manifest tracks deleted file", manifest_tracks_file),
                ],
            )
        }
    }
}

/// Scan `<snapshots_dir>/*.json` manifests and return
/// `(dir_exists, any_manifest_references_target)`.
fn inspect_session_snapshots(snapshots_dir: &Path, target: &Path) -> (bool, bool) {
    if !snapshots_dir.exists() {
        return (false, false);
    }
    let target_str = target.to_string_lossy().to_string();
    let mut tracks = false;
    if let Ok(entries) = std::fs::read_dir(snapshots_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            if let Ok(bytes) = std::fs::read(&path) {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    if text.contains(&target_str) {
                        tracks = true;
                        break;
                    }
                }
            }
        }
    }
    (true, tracks)
}
