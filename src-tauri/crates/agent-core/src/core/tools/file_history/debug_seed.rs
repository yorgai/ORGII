//! Debug-only seed helpers exposed via `/agent/test/housekeeping/*`
//! endpoints. Bypasses the normal capture path so housekeeping E2E tests
//! can deterministically populate manifests, DB rows, and aged session
//! directories without triggering the very code under test
//! (`enforce_session_cap_after_save`).
//!
//! The whole module is gated on `debug_assertions` via the `#[cfg]` on the
//! `mod debug_seed;` declaration in `mod.rs`.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use rusqlite::params;

use super::paths::{
    backups_dir, ensure_dirs, new_snapshot_id, now_iso, session_root, write_snapshot,
};
use super::types::{FileBackup, FileSnapshot};

/// Seed `count` synthetic manifests for `session_id` WITHOUT going through
/// `save_snapshot` (which would trigger `enforce_session_cap_after_save` and
/// break the test by running the very code under test). Writes both the
/// manifest JSON on disk and a matching `agent_snapshots` row directly.
///
/// `created_at_offsets_secs` controls the row timestamp so E2E seeds can
/// deterministically order which manifests are "oldest". Index `i` in the
/// slice maps to row `i`; if the slice is shorter than `count`, the final
/// value is reused.
///
/// Also writes `count` distinct dummy backup blobs (named after unique
/// content hashes) so the blob-GC path has something to count. Returns the
/// list of generated `snapshot_id`s.
pub fn debug_seed_manifests(
    session_id: &str,
    count: usize,
    created_at_offsets_secs: &[i64],
) -> io::Result<Vec<String>> {
    ensure_dirs(session_id)?;

    let mut ids = Vec::with_capacity(count);
    let base = chrono::Utc::now();
    for i in 0..count {
        let snapshot_id = new_snapshot_id();
        let content_hash = format!("debug-seed-{}-{}", session_id, i);

        let blob_path = backups_dir(session_id).join(&content_hash);
        fs::write(&blob_path, format!("seed-{}", i).as_bytes())?;

        let mut backups = BTreeMap::new();
        backups.insert(
            format!("/debug/seed-{}.txt", i),
            FileBackup {
                path: format!("/debug/seed-{}.txt", i),
                content_hash: Some(content_hash),
                size: Some(7),
                untrackable: false,
            },
        );

        let snap = FileSnapshot {
            snapshot_id: snapshot_id.clone(),
            created_at: now_iso(),
            backups,
        };
        write_snapshot(session_id, &snap)?;

        let offset = created_at_offsets_secs
            .get(i)
            .copied()
            .unwrap_or_else(|| created_at_offsets_secs.last().copied().unwrap_or(0));
        let created_at = base + chrono::Duration::seconds(offset);

        let conn = database::db::get_connection()
            .map_err(|err| io::Error::other(format!("DB open failed: {}", err)))?;
        conn.execute(
            "INSERT INTO agent_snapshots (id, session_id, tool_call_id, hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                uuid::Uuid::new_v4().to_string(),
                session_id,
                format!("debug-seed-tc-{}", i),
                snapshot_id,
                created_at.to_rfc3339(),
            ],
        )
        .map_err(|err| io::Error::other(format!("DB insert failed: {}", err)))?;

        ids.push(snapshot_id);
    }
    Ok(ids)
}

/// Seed an entire **aged** session directory for TTL-prune tests. Creates a
/// minimal `~/.orgii/file-history/<session_id>/` tree (empty `snapshots/` and
/// `backups/`), one DB row so `agent_snapshots` has something to prune, and
/// then backdates the directory mtime by `age_days`. Returns the path that
/// was seeded.
///
/// Caller is responsible for choosing a `session_id` that cannot collide
/// with a live session (typically `debug-e2e-aged-<uuid>`).
pub fn debug_seed_aged_session(session_id: &str, age_days: u64) -> io::Result<PathBuf> {
    ensure_dirs(session_id)?;

    let conn = database::db::get_connection()
        .map_err(|err| io::Error::other(format!("DB open failed: {}", err)))?;
    conn.execute(
        "INSERT INTO agent_snapshots (id, session_id, tool_call_id, hash, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            session_id,
            "debug-aged-tc",
            new_snapshot_id(),
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|err| io::Error::other(format!("DB insert failed: {}", err)))?;

    let dir = session_root(session_id);
    let target = SystemTime::now()
        .checked_sub(Duration::from_secs(age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let handle = fs::File::options().read(true).open(&dir)?;
    handle.set_modified(target)?;
    drop(handle);

    Ok(dir)
}
