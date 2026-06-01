//! Path helpers + manifest I/O. All other modules go through these to read
//! or write a `FileSnapshot` JSON file under
//! `~/.orgii/file-history/<session_id>/`.

use std::fs;
use std::io;
use std::path::PathBuf;

use app_paths as paths;

use super::types::FileSnapshot;

pub(super) fn session_root(session_id: &str) -> PathBuf {
    paths::file_history_dir(session_id)
}

pub(super) fn backups_dir(session_id: &str) -> PathBuf {
    session_root(session_id).join("backups")
}

pub(super) fn snapshots_dir(session_id: &str) -> PathBuf {
    session_root(session_id).join("snapshots")
}

pub(super) fn snapshot_file(session_id: &str, snapshot_id: &str) -> PathBuf {
    snapshots_dir(session_id).join(format!("{}.json", snapshot_id))
}

pub(super) fn backup_file(session_id: &str, content_hash: &str) -> PathBuf {
    backups_dir(session_id).join(content_hash)
}

pub(super) fn ensure_dirs(session_id: &str) -> io::Result<()> {
    fs::create_dir_all(backups_dir(session_id))?;
    fs::create_dir_all(snapshots_dir(session_id))?;
    Ok(())
}

pub(super) fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub(super) fn new_snapshot_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(super) fn write_snapshot(session_id: &str, snap: &FileSnapshot) -> io::Result<()> {
    ensure_dirs(session_id)?;
    let path = snapshot_file(session_id, &snap.snapshot_id);
    let json = serde_json::to_string_pretty(snap)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    fs::write(&path, json)
}

pub(super) fn read_snapshot(session_id: &str, snapshot_id: &str) -> io::Result<FileSnapshot> {
    let path = snapshot_file(session_id, snapshot_id);
    let bytes = fs::read(&path)?;
    serde_json::from_slice(&bytes).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
}

/// Read only the `created_at` field from a snapshot manifest without loading
/// all backup entries. Returns the ISO-8601 timestamp string.
pub fn read_snapshot_created_at(session_id: &str, snapshot_id: &str) -> io::Result<String> {
    let snap = read_snapshot(session_id, snapshot_id)?;
    Ok(snap.created_at)
}
