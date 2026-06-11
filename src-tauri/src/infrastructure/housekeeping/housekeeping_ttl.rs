//! TTL-based file pruning helpers for [`super::housekeeping`].
//!
//! All functions are `pub(super)` — only the housekeeping orchestrator
//! (`run_deferred_cleanup`) calls them.

use std::fs;
use std::time::{Duration, SystemTime};

use agent_core::tools::file_history;
use app_paths as paths;

/// Visit every session that currently has at least one `agent_snapshots`
/// row and run the per-session cap helper on it. Returns
/// `(sessions_touched, manifests_removed, blobs_removed)`.
pub(super) fn cap_all_surviving_sessions() -> std::io::Result<(usize, usize, usize)> {
    let session_ids = agent_core::persistence::session_snapshots::list_sessions_with_snapshots()
        .map_err(|err| std::io::Error::other(format!("DB list failed: {}", err)))?;

    let mut touched = 0;
    let mut manifests = 0;
    let mut blobs = 0;
    for sid in session_ids {
        match file_history::evict_old_manifests_for_session(&sid) {
            Ok(stats) => {
                if stats.manifests_removed > 0 || stats.blobs_removed > 0 {
                    touched += 1;
                    manifests += stats.manifests_removed;
                    blobs += stats.blobs_removed;
                }
            }
            Err(err) => tracing::warn!("[housekeeping] cap failed for session {}: {}", sid, err),
        }
    }
    Ok((touched, manifests, blobs))
}

/// Walk `~/.orgii/logs/` and delete any file whose mtime is older than
/// `max_age_days`. The active (un-rotated) log is protected by its mtime
/// being "now"; only rotated history files age out.
///
/// Directories inside `logs/` (if any are ever introduced) are skipped
/// entirely — retention is strictly per-file.
pub(super) fn prune_old_log_files(max_age_days: u64) -> std::io::Result<usize> {
    prune_old_files_in_dir(paths::logs_dir(), max_age_days)
}

/// Shared worker: delete every regular file directly in `dir` whose mtime is
/// older than `max_age_days`. Sub-directories are left alone so callers can
/// attach this to any flat file cache without worrying about recursion.
pub(super) fn prune_old_files_in_dir(
    dir: std::path::PathBuf,
    max_age_days: u64,
) -> std::io::Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut removed = 0;
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(mtime) = metadata.modified() else {
            continue;
        };
        if mtime >= cutoff {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(
                "[housekeeping] failed to remove aged file {}: {}",
                path.display(),
                err
            );
            continue;
        }
        removed += 1;
    }

    if removed > 0 {
        tracing::info!(
            "[housekeeping] removed {} file(s) under {} older than {} days",
            removed,
            dir.display(),
            max_age_days
        );
    }

    Ok(removed)
}

/// Recursive variant of [`prune_old_files_in_dir`]. Walks `dir` bottom-up,
/// deleting any regular file whose mtime is older than `max_age_days` and
/// then pruning any directory that became empty as a result.
///
/// Used for nested layouts like `~/.orgii/plans/<agent_id>/*.plan.md` where
/// the top level is a grouping layer rather than content.
pub(super) fn prune_old_files_recursive(
    dir: std::path::PathBuf,
    max_age_days: u64,
) -> std::io::Result<usize> {
    if !dir.exists() {
        return Ok(0);
    }
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut removed = 0;
    remove_old_files_recursive_inner(&dir, cutoff, &mut removed)?;

    if removed > 0 {
        tracing::info!(
            "[housekeeping] removed {} file(s) under {} older than {} days",
            removed,
            dir.display(),
            max_age_days
        );
    }

    Ok(removed)
}

pub(super) fn remove_old_files_recursive_inner(
    dir: &std::path::Path,
    cutoff: SystemTime,
    removed: &mut usize,
) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            remove_old_files_recursive_inner(&path, cutoff, removed)?;
            // Prune the directory if it became empty.
            if fs::read_dir(&path)?.next().is_none() {
                let _ = fs::remove_dir(&path);
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(mtime) = metadata.modified() else {
            continue;
        };
        if mtime >= cutoff {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(
                "[housekeeping] failed to remove aged file {}: {}",
                path.display(),
                err
            );
            continue;
        }
        *removed += 1;
    }
    Ok(())
}
