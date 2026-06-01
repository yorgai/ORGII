//! Eviction, blob GC, orphan-session pruning, and TTL-based cleanup. The
//! filesystem and DB are kept in sync — every manifest deletion is paired
//! with the matching `agent_snapshots` row deletion.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::time::{Duration, SystemTime};

use app_paths as paths;

use super::paths::{backups_dir, session_root, snapshots_dir};
use super::types::{EvictionStats, FileSnapshot, TtlPruneStats, MAX_SNAPSHOTS_PER_SESSION};

/// Remove the entire file-history directory for a session. Called from
/// session-delete and from `prune_orphan_sessions`.
pub fn remove_session(session_id: &str) -> io::Result<()> {
    let dir = session_root(session_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// Walk `~/.orgii/file-history/` and remove any session directory whose ID is
/// not present in `live_session_ids`. Called once at app startup.
pub fn prune_orphan_sessions(live_session_ids: &[String]) -> io::Result<usize> {
    let root = paths::file_history_root();
    if !root.exists() {
        return Ok(0);
    }
    let live: HashSet<&str> = live_session_ids.iter().map(|s| s.as_str()).collect();

    let mut removed = 0;
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !live.contains(name) {
            if let Err(err) = fs::remove_dir_all(&path) {
                tracing::warn!(
                    "[file_history] failed to prune orphan session {}: {}",
                    name,
                    err
                );
            } else {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// Evict the oldest manifests for a single session so that at most
/// `MAX_SNAPSHOTS_PER_SESSION` remain. Deletes both the filesystem manifests
/// and the matching `agent_snapshots` rows, then runs a single blob GC pass
/// to drop any content-addressed backup blobs no longer referenced by a
/// surviving manifest.
///
/// This is idempotent: if the session is already at or below the cap, nothing
/// happens beyond the single `count_snapshots_for_session` DB query.
pub fn evict_old_manifests_for_session(session_id: &str) -> io::Result<EvictionStats> {
    let mut stats = EvictionStats::default();

    let current = crate::persistence::session_snapshots::count_snapshots_for_session(session_id)
        .map_err(|err| io::Error::other(format!("DB count failed: {}", err)))?;

    let cap = MAX_SNAPSHOTS_PER_SESSION as i64;
    if current <= cap {
        return Ok(stats);
    }

    let excess = current - cap;
    let victims =
        crate::persistence::session_snapshots::get_oldest_snapshot_ids(session_id, excess)
            .map_err(|err| io::Error::other(format!("DB oldest-snapshot query failed: {}", err)))?;

    let snapshots_dir = snapshots_dir(session_id);
    for snapshot_id in &victims {
        let manifest = snapshots_dir.join(format!("{}.json", snapshot_id));
        if manifest.exists() {
            if let Err(err) = fs::remove_file(&manifest) {
                tracing::warn!(
                    "[file_history] failed to evict manifest {}: {}",
                    manifest.display(),
                    err
                );
            } else {
                stats.manifests_removed += 1;
            }
        }
    }

    stats.db_rows_removed =
        crate::persistence::session_snapshots::delete_snapshots_by_ids(session_id, &victims)
            .map_err(|err| io::Error::other(format!("DB delete failed: {}", err)))?;

    stats.blobs_removed = gc_unreferenced_blobs(session_id)?;

    if stats.manifests_removed > 0 || stats.db_rows_removed > 0 || stats.blobs_removed > 0 {
        tracing::info!(
            "[file_history] session {} capped: -{} manifests, -{} db rows, -{} blobs",
            session_id,
            stats.manifests_removed,
            stats.db_rows_removed,
            stats.blobs_removed
        );
    }

    Ok(stats)
}

/// Walk every surviving manifest for a session and delete any backup blob
/// in `backups/` whose content hash is not referenced. Safe to call at any
/// time — content hashing makes this a pure GC over unreachable entries.
pub fn discard_tool_call_snapshots(
    session_id: &str,
    tool_call_id: &str,
) -> io::Result<EvictionStats> {
    let mut stats = EvictionStats::default();
    let snapshot_ids = crate::persistence::session_snapshots::get_snapshot_ids_by_tool_call_id(
        session_id,
        tool_call_id,
    )
    .map_err(|err| io::Error::other(format!("DB tool-call snapshot query failed: {}", err)))?;

    if snapshot_ids.is_empty() {
        return Ok(stats);
    }

    let snapshots_dir = snapshots_dir(session_id);
    for snapshot_id in &snapshot_ids {
        let manifest = snapshots_dir.join(format!("{}.json", snapshot_id));
        if manifest.exists() {
            fs::remove_file(&manifest)?;
            stats.manifests_removed += 1;
        }
    }

    stats.db_rows_removed =
        crate::persistence::session_snapshots::delete_snapshots_by_ids(session_id, &snapshot_ids)
            .map_err(|err| io::Error::other(format!("DB delete failed: {}", err)))?;
    stats.blobs_removed = gc_unreferenced_blobs(session_id)?;

    Ok(stats)
}

pub fn gc_unreferenced_blobs(session_id: &str) -> io::Result<usize> {
    let snap_dir = snapshots_dir(session_id);
    let backups = backups_dir(session_id);
    if !backups.exists() {
        return Ok(0);
    }

    let mut referenced: HashSet<String> = HashSet::new();
    if snap_dir.exists() {
        for entry in fs::read_dir(&snap_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Ok(snap): Result<FileSnapshot, _> = serde_json::from_slice(&bytes) else {
                continue;
            };
            for backup in snap.backups.values() {
                if let Some(hash) = &backup.content_hash {
                    referenced.insert(hash.clone());
                }
            }
        }
    }

    let mut removed = 0;
    for entry in fs::read_dir(&backups)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !referenced.contains(name) {
            if let Err(err) = fs::remove_file(&path) {
                tracing::warn!(
                    "[file_history] failed to GC blob {}: {}",
                    path.display(),
                    err
                );
            } else {
                removed += 1;
            }
        }
    }

    Ok(removed)
}

/// Hook called from `save_snapshot` after a new row is inserted into
/// `agent_snapshots`. Enforces the per-session manifest cap and runs blob GC.
/// Failures are logged but never bubbled up — snapshotting must stay on the
/// hot path regardless of housekeeping errors.
pub fn enforce_session_cap_after_save(session_id: &str) {
    match evict_old_manifests_for_session(session_id) {
        Ok(_) => {}
        Err(err) => tracing::warn!(
            "[file_history] enforce cap for session {} failed: {}",
            session_id,
            err
        ),
    }
}

/// Walk `~/.orgii/file-history/` and delete every session directory whose
/// most recent modification is older than `max_age_days`. Mirrors Claude
/// Code's `cleanupOldFileHistoryBackups` in `utils/cleanup.ts`. The DB rows
/// in `agent_snapshots` are removed for every pruned session so the index
/// stays in sync with the filesystem.
///
/// Directories with no resolvable mtime are skipped (conservative).
pub fn prune_old_file_history(max_age_days: u64) -> io::Result<TtlPruneStats> {
    let root = paths::file_history_root();
    if !root.exists() {
        return Ok(TtlPruneStats::default());
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(max_age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut stats = TtlPruneStats::default();
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(session_id) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(mtime) = metadata.modified() else {
            continue;
        };
        if mtime >= cutoff {
            continue;
        }

        if let Err(err) = fs::remove_dir_all(&path) {
            tracing::warn!(
                "[file_history] failed to prune aged session {}: {}",
                session_id,
                err
            );
            continue;
        }
        stats.sessions_removed += 1;

        match crate::persistence::session_snapshots::delete_all_snapshots_for_session(session_id) {
            Ok(n) => stats.db_rows_removed += n,
            Err(err) => tracing::warn!(
                "[file_history] failed to drop DB rows for aged session {}: {}",
                session_id,
                err
            ),
        }
    }

    if stats.sessions_removed > 0 {
        tracing::info!(
            "[file_history] TTL prune ({} days) removed {} session dir(s), {} db row(s)",
            max_age_days,
            stats.sessions_removed,
            stats.db_rows_removed
        );
    }

    Ok(stats)
}
