//! Snapshot creation + per-file capture into the session backup pool.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::paths::{
    backup_file, ensure_dirs, hash_bytes, new_snapshot_id, now_iso, read_snapshot, write_snapshot,
};
use super::types::{FileBackup, FileSnapshot};

/// Capture a single file into the session's backup pool, returning the
/// FileBackup descriptor. If the file does not exist, returns a backup with
/// `content_hash = None` (meaning "restore should delete this file").
pub(super) fn capture_file(session_id: &str, abs_path: &Path) -> io::Result<FileBackup> {
    let path_str = abs_path.to_string_lossy().to_string();

    if !abs_path.exists() {
        return Ok(FileBackup {
            path: path_str,
            content_hash: None,
            size: None,
            untrackable: false,
        });
    }

    if !abs_path.is_file() {
        // Non-regular path (directory, symlink-to-dir, device node, …).
        // Mark as untrackable so restore skips it — unlike a genuinely
        // absent file, we must NOT delete or overwrite this entry.
        return Ok(FileBackup {
            path: path_str,
            content_hash: None,
            size: None,
            untrackable: true,
        });
    }

    let bytes = fs::read(abs_path)?;
    let size = bytes.len() as u64;
    let hash = hash_bytes(&bytes);

    let target = backup_file(session_id, &hash);
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, &bytes)?;
    }

    Ok(FileBackup {
        path: path_str,
        content_hash: Some(hash),
        size: Some(size),
        untrackable: false,
    })
}

/// Create an empty snapshot for a session and return its ID. Files can be
/// added to it later via [`track_edit`] (per-tool-call) or you can construct
/// a full snapshot up front via [`make_tool_snapshot`].
pub fn make_snapshot(session_id: &str) -> io::Result<String> {
    ensure_dirs(session_id)?;
    let snap = FileSnapshot {
        snapshot_id: new_snapshot_id(),
        created_at: now_iso(),
        backups: BTreeMap::new(),
    };
    write_snapshot(session_id, &snap)?;
    Ok(snap.snapshot_id)
}

/// Convenience helper: create a snapshot AND capture a list of files into it
/// in one call. Used by `event_handler.rs` to snapshot the pre-edit state of
/// every file a single tool call is about to modify.
///
/// Returns the new snapshot ID. Callers must provide at least one path; an
/// empty path list means there is nothing rewindable to capture.
pub fn make_tool_snapshot(session_id: &str, files: &[PathBuf]) -> io::Result<String> {
    if files.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "cannot create a tool snapshot without file paths",
        ));
    }

    let snapshot_id = make_snapshot(session_id)?;
    for file in files {
        track_edit(session_id, &snapshot_id, file)?;
    }
    Ok(snapshot_id)
}

/// Add a single file to an existing snapshot using caller-supplied bytes
/// instead of reading from disk. Used by the CLI session snapshot path where
/// the CLI agent has already written the file before we receive the chunk.
///
/// The backup stores `bytes` as the pre-edit content (e.g. git HEAD version).
/// If the file is already tracked in this snapshot the call is a no-op.
pub fn track_edit_from_bytes(
    session_id: &str,
    snapshot_id: &str,
    abs_path: &Path,
    bytes: &[u8],
) -> io::Result<()> {
    ensure_dirs(session_id)?;
    let mut snap = read_snapshot(session_id, snapshot_id)?;
    let key = abs_path.to_string_lossy().to_string();
    if snap.backups.contains_key(&key) {
        return Ok(());
    }
    let hash = hash_bytes(bytes);
    let target = backup_file(session_id, &hash);
    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, bytes)?;
    }
    snap.backups.insert(
        key.clone(),
        FileBackup {
            path: key,
            content_hash: Some(hash),
            size: Some(bytes.len() as u64),
            untrackable: false,
        },
    );
    write_snapshot(session_id, &snap)?;
    Ok(())
}

/// Record a "file did not exist" entry in an existing snapshot. When the
/// snapshot is rewound, `restore_one` will delete the file if it exists on
/// disk. Used by the CLI session snapshot path for agent-created files that
/// have no git HEAD version.
///
/// No-op if the file is already tracked in this snapshot.
pub fn track_new_file(session_id: &str, snapshot_id: &str, abs_path: &Path) -> io::Result<()> {
    ensure_dirs(session_id)?;
    let mut snap = read_snapshot(session_id, snapshot_id)?;
    let key = abs_path.to_string_lossy().to_string();
    if snap.backups.contains_key(&key) {
        return Ok(());
    }
    snap.backups.insert(
        key.clone(),
        FileBackup {
            path: key,
            content_hash: None,
            size: None,
            untrackable: false,
        },
    );
    write_snapshot(session_id, &snap)?;
    Ok(())
}

/// Add a single file to an existing snapshot, capturing its current bytes
/// into the backup pool. If the file is already tracked in this snapshot,
/// it is *not* overwritten — the first capture wins (so the snapshot
/// faithfully represents pre-edit state).
pub(super) fn track_edit(session_id: &str, snapshot_id: &str, abs_path: &Path) -> io::Result<()> {
    ensure_dirs(session_id)?;
    let mut snap = read_snapshot(session_id, snapshot_id)?;
    let key = abs_path.to_string_lossy().to_string();
    if snap.backups.contains_key(&key) {
        return Ok(());
    }
    let backup = capture_file(session_id, abs_path)?;
    snap.backups.insert(key, backup);
    write_snapshot(session_id, &snap)?;
    Ok(())
}
