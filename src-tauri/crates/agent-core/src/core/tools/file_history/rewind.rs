//! Rewind / restore API. Walks captured snapshots newest-first and restores
//! each file's pre-edit bytes (or deletes files that did not exist when the
//! snapshot was taken).

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::capture::make_tool_snapshot;
use super::paths::{backup_file, hash_bytes, read_snapshot};
use super::types::{FileBackup, RestoreOutcome, RewindStats};

/// Sentinel `tool_call_id` value written on redo snapshots so the frontend
/// can identify them. The prefix format (`redo:`) is intentionally distinct
/// from any real tool call ID (which are UUIDs).
pub const REDO_SNAPSHOT_TOOL_CALL_ID: &str = "redo:rewind";

/// Restore every file in EVERY snapshot whose `created_at >= target_created_at`
/// to its captured bytes, walking newest-first. This is the "rewind the
/// session to message X" operation: each tool-call snapshot reverses one
/// edit, and applying them in reverse order recovers the pre-edit state.
///
/// **Redo snapshot:** Before performing any restore, the current on-disk state
/// of all affected files is captured into a new "redo" snapshot. This allows
/// callers to re-apply the reverted changes by rewinding to the redo snapshot.
/// The redo snapshot ID is returned in `RewindStats.redo_snapshot_id`.
///
/// The DB is the source of truth for which snapshots belong to a session
/// (table `agent_snapshots`). Each row's `hash` column holds the
/// `snapshot_id` of a manifest under
/// `~/.orgii/file-history/<session_id>/snapshots/`.
///
/// Returns aggregated stats. Snapshots whose manifest is missing are
/// counted as `failed` and skipped; we do NOT abort, since a partial
/// rewind is still better than nothing.
pub fn rewind_to_message(session_id: &str, target_created_at: &str) -> io::Result<RewindStats> {
    let snapshot_ids =
        crate::persistence::session_snapshots::get_snapshots_after(session_id, target_created_at)
            .map_err(|err| io::Error::other(format!("DB error fetching snapshots: {}", err)))?;

    // Collect the union of all file paths that will be affected by this rewind.
    // We need this before rewinding so we can snapshot the current disk state.
    let mut all_paths: BTreeSet<PathBuf> = BTreeSet::new();
    for sid in &snapshot_ids {
        match read_snapshot(session_id, sid) {
            Ok(snap) => {
                all_paths.extend(snap.backups.into_keys().map(PathBuf::from));
            }
            Err(err) => {
                tracing::warn!(
                    "[file_history] failed to read snapshot {} for redo pre-capture: {}",
                    sid,
                    err
                );
            }
        }
    }

    // Before rewinding, capture the current on-disk state as a redo snapshot.
    // This lets the user (or LLM tool) re-apply the changes that were just undone.
    let redo_snapshot_id = if !all_paths.is_empty() {
        let paths_vec: Vec<PathBuf> = all_paths.into_iter().collect();
        match make_tool_snapshot(session_id, &paths_vec) {
            Ok(redo_id) => {
                // Register in DB with sentinel tool_call_id so frontend can identify it.
                let save_result = crate::core::session::persistence::save_snapshot(
                    session_id,
                    REDO_SNAPSHOT_TOOL_CALL_ID,
                    &redo_id,
                );
                if let Err(err) = save_result {
                    tracing::warn!("[file_history] failed to save redo snapshot to DB: {}", err);
                    None
                } else {
                    Some(redo_id)
                }
            }
            Err(err) => {
                tracing::warn!("[file_history] failed to create redo snapshot: {}", err);
                None
            }
        }
    } else {
        None
    };

    let mut total = RewindStats {
        redo_snapshot_id,
        ..Default::default()
    };

    for snapshot_id in snapshot_ids.into_iter().rev() {
        match restore_snapshot(session_id, &snapshot_id) {
            Ok(stats) => {
                total.restored += stats.restored;
                total.deleted += stats.deleted;
                total.skipped_unchanged += stats.skipped_unchanged;
                total.failed += stats.failed;
            }
            Err(err) => {
                tracing::warn!(
                    "[file_history] rewind snapshot {} failed: {}",
                    snapshot_id,
                    err
                );
                total.failed += 1;
            }
        }
    }
    Ok(total)
}

/// Restore every file in the snapshot to its captured bytes (or delete it if
/// the captured state was "did not exist"). Files NOT in the snapshot are
/// untouched — this is the key property that makes multi-session safe.
pub fn restore_snapshot(session_id: &str, snapshot_id: &str) -> io::Result<RewindStats> {
    let snap = read_snapshot(session_id, snapshot_id)?;
    let mut stats = RewindStats::default();

    for backup in snap.backups.values() {
        let path = Path::new(&backup.path);
        match restore_one(session_id, backup, path) {
            Ok(RestoreOutcome::Restored) => stats.restored += 1,
            Ok(RestoreOutcome::Deleted) => stats.deleted += 1,
            Ok(RestoreOutcome::Unchanged) => stats.skipped_unchanged += 1,
            Err(err) => {
                tracing::warn!("[file_history] restore failed for {}: {}", backup.path, err);
                stats.failed += 1;
            }
        }
    }
    Ok(stats)
}

pub fn rewind_file_to_message(
    session_id: &str,
    target_created_at: &str,
    abs_path: &Path,
) -> io::Result<RewindStats> {
    let snapshot_ids =
        crate::persistence::session_snapshots::get_snapshots_after(session_id, target_created_at)
            .map_err(|err| io::Error::other(format!("DB error fetching snapshots: {}", err)))?;
    let mut stats = RewindStats::default();
    for snapshot_id in snapshot_ids.into_iter().rev() {
        match restore_file_from_snapshot(session_id, &snapshot_id, abs_path) {
            Ok(Some(RestoreOutcome::Restored)) => stats.restored += 1,
            Ok(Some(RestoreOutcome::Deleted)) => stats.deleted += 1,
            Ok(Some(RestoreOutcome::Unchanged)) => stats.skipped_unchanged += 1,
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(
                    "[file_history] rewind file {} from snapshot {} failed: {}",
                    abs_path.display(),
                    snapshot_id,
                    err
                );
                stats.failed += 1;
            }
        }
    }
    Ok(stats)
}

/// Restore a single file within a given snapshot, leaving everything else
/// untouched. Returns true if the file was actually restored or deleted,
/// false if it was unchanged or not tracked in that snapshot.
pub fn rewind_file(session_id: &str, snapshot_id: &str, abs_path: &Path) -> io::Result<bool> {
    match restore_file_from_snapshot(session_id, snapshot_id, abs_path)? {
        Some(RestoreOutcome::Restored | RestoreOutcome::Deleted) => Ok(true),
        Some(RestoreOutcome::Unchanged) | None => Ok(false),
    }
}

fn restore_file_from_snapshot(
    session_id: &str,
    snapshot_id: &str,
    abs_path: &Path,
) -> io::Result<Option<RestoreOutcome>> {
    let snap = read_snapshot(session_id, snapshot_id)?;
    let key = abs_path.to_string_lossy().to_string();
    let Some(backup) = snap.backups.get(&key) else {
        return Ok(None);
    };
    restore_one(session_id, backup, abs_path).map(Some)
}

fn restore_one(session_id: &str, backup: &FileBackup, target: &Path) -> io::Result<RestoreOutcome> {
    // Non-regular files (symlinks-to-dir, device nodes, …) were never
    // captured — skip them silently so we don't accidentally delete them.
    if backup.untrackable {
        return Ok(RestoreOutcome::Unchanged);
    }
    match &backup.content_hash {
        None => {
            // Captured state: file did not exist. Delete current file if it
            // exists, otherwise no-op.
            if target.exists() {
                if target.is_file() {
                    fs::remove_file(target)?;
                    return Ok(RestoreOutcome::Deleted);
                }
                // Don't touch directories or other non-regular paths.
                return Ok(RestoreOutcome::Unchanged);
            }
            Ok(RestoreOutcome::Unchanged)
        }
        Some(hash) => {
            // Captured state: file existed with these bytes. Skip if current
            // bytes already match.
            if target.is_file() {
                let current = fs::read(target)?;
                if hash_bytes(&current) == *hash {
                    return Ok(RestoreOutcome::Unchanged);
                }
            }
            let backup_path = backup_file(session_id, hash);
            let bytes = fs::read(&backup_path).map_err(|err| {
                io::Error::new(
                    err.kind(),
                    format!("missing backup blob {} for {}: {}", hash, backup.path, err),
                )
            })?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(target, bytes)?;
            Ok(RestoreOutcome::Restored)
        }
    }
}
