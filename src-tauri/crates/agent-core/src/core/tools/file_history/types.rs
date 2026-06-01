//! Public data types + tunable constants for the per-session file-copy
//! snapshot system. No I/O, no DB access — pure shape definitions.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Maximum number of snapshot manifests retained per session before the
/// oldest ones are evicted. Cap is enforced eagerly on every
/// [`super::cleanup::enforce_session_cap_after_save`] call and lazily
/// during background housekeeping.
pub const MAX_SNAPSHOTS_PER_SESSION: usize = 100;

/// Default retention for an entire session's file-history directory when
/// mtime-based pruning runs. Anything older than this is deleted
/// outright.
pub const DEFAULT_FILE_HISTORY_TTL_DAYS: u64 = 30;

/// A single file's backup entry within a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBackup {
    /// Absolute path of the original file.
    pub path: String,
    /// Content hash of the captured bytes (blake3, hex).
    /// - `Some(hash)` — file existed; restore writes these bytes back.
    /// - `None` and `untrackable == false` — file did not exist; restore deletes it.
    /// - `None` and `untrackable == true`  — non-regular-file (symlink-to-dir,
    ///   device node, …); restore skips it entirely.
    pub content_hash: Option<String>,
    /// File size in bytes at capture time. `None` if file did not exist or is
    /// untrackable.
    pub size: Option<u64>,
    /// True when the path exists but is not a regular file (e.g. a directory
    /// symlink). Restore will never touch untrackable entries.
    #[serde(default)]
    pub untrackable: bool,
}

/// A full snapshot manifest. One file per `make_snapshot` call (or per
/// incremental tracked file when chained via `track_edit`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileSnapshot {
    pub snapshot_id: String,
    pub created_at: String,
    /// Backups keyed by absolute path. BTreeMap for stable serialization.
    pub backups: BTreeMap<String, FileBackup>,
}

/// Result of a `rewind` operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RewindStats {
    pub restored: usize,
    pub deleted: usize,
    pub skipped_unchanged: usize,
    pub failed: usize,
    /// Snapshot ID of the redo snapshot captured before the rewind. `None` when
    /// there were no files to roll back (empty rewind with nothing to redo).
    pub redo_snapshot_id: Option<String>,
}

/// Aggregate diff stats across the captured files in a snapshot vs. the
/// current working tree.
#[cfg(test)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct DiffStats {
    pub files_changed: usize,
    pub files_added: usize,
    pub files_deleted: usize,
}

/// Stats returned by [`super::cleanup::enforce_session_cap_after_save`] /
/// [`super::cleanup::evict_old_manifests_for_session`].
#[derive(Debug, Clone, Default)]
pub struct EvictionStats {
    /// Number of manifest JSON files deleted from `snapshots/`.
    pub manifests_removed: usize,
    /// Number of `agent_snapshots` rows deleted from SQLite.
    pub db_rows_removed: i64,
    /// Number of backup blobs garbage-collected from `backups/`.
    pub blobs_removed: usize,
}

/// Stats returned by [`super::cleanup::prune_old_file_history`].
#[derive(Debug, Clone, Default)]
pub struct TtlPruneStats {
    /// Number of session directories removed from disk.
    pub sessions_removed: usize,
    /// Total `agent_snapshots` rows removed across all pruned sessions.
    pub db_rows_removed: i64,
}

/// Internal three-way outcome of restoring a single file. Crossed module
/// boundaries because both `rewind` (whole-snapshot) and `rewind_file`
/// (single-file) consume `restore_one`'s result.
pub(super) enum RestoreOutcome {
    Restored,
    Deleted,
    Unchanged,
}
