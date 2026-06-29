//! Diff / change-detection helpers that compare captured snapshots against
//! the current on-disk state. Pure read-side.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::paths::{
    backup_file, hash_bytes, latest_snapshot_id_before, list_snapshot_ids_at_or_after,
    read_snapshot, snapshots_dir,
};
use super::types::{FileBackup, FileSnapshot};

#[cfg(test)]
use super::types::DiffStats;

/// Returns true if any tracked file in the snapshot differs from its current
/// on-disk state. Used internally by `has_changes_after_message`, which is
/// the public entry point exposed to the frontend rewind-confirmation flow.
pub(super) fn has_any_changes(session_id: &str, snapshot_id: &str) -> io::Result<bool> {
    let snap = read_snapshot(session_id, snapshot_id)?;
    for backup in snap.backups.values() {
        if file_differs(session_id, backup)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn rewind_snapshot_ids(
    session_id: &str,
    target_created_at: &str,
) -> io::Result<Vec<String>> {
    let db_snapshot_ids =
        crate::persistence::session_snapshots::get_snapshots_after(session_id, target_created_at)
            .map_err(|err| io::Error::other(format!("DB error fetching snapshots: {}", err)))?;
    let redo_snapshot_ids = crate::persistence::session_snapshots::get_snapshot_ids_by_tool_call_id(
        session_id,
        super::rewind::REDO_SNAPSHOT_TOOL_CALL_ID,
    )
    .map_err(|err| io::Error::other(format!("DB error fetching redo snapshots: {}", err)))?
    .into_iter()
    .collect::<BTreeSet<_>>();
    let pre_message_snapshot_id =
        crate::persistence::session_snapshots::get_latest_snapshot_before_by_tool_call_id(
            session_id,
            "__pre_message__",
            target_created_at,
        )
        .map_err(|err| {
            io::Error::other(format!("DB error fetching pre-message snapshot: {}", err))
        })?;
    let manifest_anchor_snapshot_id = latest_snapshot_id_before(session_id, target_created_at)?;
    let manifest_snapshot_ids = list_snapshot_ids_at_or_after(session_id, target_created_at)?;

    let mut seen = BTreeSet::new();
    let mut snapshots = BTreeMap::new();
    for snapshot_id in db_snapshot_ids
        .into_iter()
        .chain(pre_message_snapshot_id)
        .chain(manifest_anchor_snapshot_id)
        .chain(manifest_snapshot_ids)
    {
        if redo_snapshot_ids.contains(&snapshot_id) {
            continue;
        }
        if !seen.insert(snapshot_id.clone()) {
            continue;
        }
        match read_snapshot(session_id, &snapshot_id) {
            Ok(snapshot) => {
                snapshots.insert(
                    (snapshot.created_at.clone(), snapshot.snapshot_id.clone()),
                    snapshot.snapshot_id,
                );
            }
            Err(err) => {
                tracing::warn!(
                    session_id,
                    snapshot_id,
                    error = %err,
                    "file_history snapshot unreadable while resolving rewind order; skipping"
                );
            }
        }
    }

    Ok(snapshots.into_values().collect())
}

/// Returns true if any file captured in any snapshot for this session at or
/// after `target_created_at` would actually be modified by `rewind_to_message`.
/// Used by the "regenerate / edit user message" confirmation dialog: if no
/// captured files differ from disk, no prompt is needed.
pub fn has_changes_after_message(session_id: &str, target_created_at: &str) -> io::Result<bool> {
    for snapshot_id in rewind_snapshot_ids(session_id, target_created_at)? {
        if has_any_changes(session_id, &snapshot_id).unwrap_or(false) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Generate a unified-diff patch string for every file that changed during
/// a session, comparing the earliest captured pre-edit bytes against the
/// current on-disk content.
///
/// The output is a standard unified diff (same format as `git diff`), with one
/// `diff --git` header per file. If no file-history snapshots exist for the
/// session (e.g. the session never edited any files), an empty string is
/// returned.
pub fn session_unified_diff(session_id: &str) -> io::Result<String> {
    use similar::{ChangeTag, TextDiff};

    let mut first_backup: std::collections::BTreeMap<String, super::types::FileBackup> =
        std::collections::BTreeMap::new();
    let snap_dir = snapshots_dir(session_id);
    if !snap_dir.exists() {
        return Ok(String::new());
    }

    let mut manifests: Vec<std::path::PathBuf> = fs::read_dir(&snap_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    manifests.sort();

    for manifest_path in manifests {
        let bytes = match fs::read(&manifest_path) {
            Ok(b) => b,
            Err(err) => {
                tracing::warn!(
                    manifest = %manifest_path.display(),
                    error = %err,
                    "file_history manifest unreadable; skipping"
                );
                continue;
            }
        };
        let snap: super::types::FileSnapshot = match serde_json::from_slice(&bytes) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    manifest = %manifest_path.display(),
                    error = %err,
                    "file_history manifest JSON parse failed; skipping"
                );
                continue;
            }
        };
        for (path, backup) in snap.backups {
            first_backup.entry(path).or_insert(backup);
        }
    }

    let mut output = String::new();
    for (path_str, backup) in first_backup {
        let path = Path::new(&path_str);
        let original = match &backup.content_hash {
            None => String::new(),
            Some(hash) => {
                let backup_path = backup_file(session_id, hash);
                fs::read_to_string(&backup_path).unwrap_or_else(|err| {
                    tracing::warn!(
                        backup_path = %backup_path.display(),
                        error = %err,
                        "file_history backup unreadable; treating as empty"
                    );
                    String::new()
                })
            }
        };
        let current = if path.is_file() {
            fs::read_to_string(path).unwrap_or_else(|err| {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "file_history target unreadable; treating as empty"
                );
                String::new()
            })
        } else {
            String::new()
        };

        if original == current {
            continue;
        }

        let label_a = format!("a/{}", path_str);
        let label_b = format!("b/{}", path_str);
        output.push_str(&format!(
            "diff --git {} {}\n--- {}\n+++ {}\n",
            label_a, label_b, label_a, label_b
        ));

        let diff = TextDiff::from_lines(&original, &current);
        for group in diff.grouped_ops(3) {
            // Write the hunk header.
            let (old_start, old_count, new_start, new_count) = {
                let first = &group[0];
                let last = &group[group.len() - 1];
                let old_start = first.old_range().start + 1;
                let old_end = last.old_range().end;
                let new_start = first.new_range().start + 1;
                let new_end = last.new_range().end;
                (
                    old_start,
                    old_end.saturating_sub(old_start.saturating_sub(1)),
                    new_start,
                    new_end.saturating_sub(new_start.saturating_sub(1)),
                )
            };
            output.push_str(&format!(
                "@@ -{},{} +{},{} @@\n",
                old_start, old_count, new_start, new_count
            ));

            for op in &group {
                for change in diff.iter_changes(op) {
                    let prefix = match change.tag() {
                        ChangeTag::Delete => "-",
                        ChangeTag::Insert => "+",
                        ChangeTag::Equal => " ",
                    };
                    output.push_str(prefix);
                    output.push_str(change.as_str().unwrap_or(""));
                    if !change.as_str().unwrap_or("").ends_with('\n') {
                        output.push('\n');
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Per-file numstat (+lines / -lines) for the full file-history of a session,
/// comparing the *earliest captured pre-edit bytes* of every tracked file
/// against its current on-disk bytes. Diffs each file's v1 backup against
/// its live contents.
///
/// Returns a map keyed by absolute path → `(additions, deletions)`.
pub fn session_numstat(session_id: &str) -> io::Result<BTreeMap<String, (u64, u64)>> {
    use similar::{ChangeTag, TextDiff};

    let mut first_backup: BTreeMap<String, FileBackup> = BTreeMap::new();
    let snap_dir = snapshots_dir(session_id);
    if !snap_dir.exists() {
        return Ok(BTreeMap::new());
    }

    // Walk every snapshot manifest and record the *first* backup seen per
    // absolute path (i.e. the earliest pre-edit state captured for that
    // file across this session's entire history).
    let mut manifests: Vec<PathBuf> = fs::read_dir(&snap_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "json").unwrap_or(false))
        .collect();
    manifests.sort();

    for manifest_path in manifests {
        // Silently skipping a corrupt or unreadable manifest would
        // hide undo history from the per-session file-history UI: the
        // file would appear unchanged even though pre-edit bytes
        // exist on disk. Match the warn-and-skip pattern already used
        // for backup/target read failures below so a partial loss is
        // visible in logs.
        let bytes = match fs::read(&manifest_path) {
            Ok(b) => b,
            Err(err) => {
                tracing::warn!(
                    manifest = %manifest_path.display(),
                    error = %err,
                    "file_history manifest unreadable; skipping"
                );
                continue;
            }
        };
        let snap: FileSnapshot = match serde_json::from_slice(&bytes) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    manifest = %manifest_path.display(),
                    error = %err,
                    "file_history manifest JSON parse failed; skipping"
                );
                continue;
            }
        };
        for (path, backup) in snap.backups {
            first_backup.entry(path).or_insert(backup);
        }
    }

    let mut out: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for (path_str, backup) in first_backup {
        let path = Path::new(&path_str);
        let original = match &backup.content_hash {
            None => String::new(),
            Some(hash) => {
                let backup_path = backup_file(session_id, hash);
                fs::read_to_string(&backup_path).unwrap_or_else(|err| {
                    tracing::warn!(
                        backup_path = %backup_path.display(),
                        error = %err,
                        "file_history backup unreadable; treating as empty for diff"
                    );
                    String::new()
                })
            }
        };
        let current = if path.is_file() {
            fs::read_to_string(path).unwrap_or_else(|err| {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "file_history target unreadable; treating as empty for diff"
                );
                String::new()
            })
        } else {
            String::new()
        };
        if original == current {
            continue;
        }
        let diff = TextDiff::from_lines(&original, &current);
        let mut add: u64 = 0;
        let mut del: u64 = 0;
        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Insert => add += 1,
                ChangeTag::Delete => del += 1,
                ChangeTag::Equal => {}
            }
        }
        out.insert(path_str, (add, del));
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) fn get_diff_stats(session_id: &str, snapshot_id: &str) -> io::Result<DiffStats> {
    let snap = read_snapshot(session_id, snapshot_id)?;
    let mut stats = DiffStats::default();
    for backup in snap.backups.values() {
        if backup.untrackable {
            continue;
        }
        let path = Path::new(&backup.path);
        let exists_now = path.is_file();
        let existed_then = backup.content_hash.is_some();

        match (existed_then, exists_now) {
            (false, false) => {} // no-op
            (false, true) => stats.files_added += 1,
            (true, false) => stats.files_deleted += 1,
            (true, true) => {
                if file_differs(session_id, backup)? {
                    stats.files_changed += 1;
                }
            }
        }
    }
    Ok(stats)
}

pub(super) fn file_differs(_session_id: &str, backup: &FileBackup) -> io::Result<bool> {
    // Untrackable entries (non-regular files) are never considered changed —
    // we couldn't capture their content, so we can't diff them either.
    if backup.untrackable {
        return Ok(false);
    }
    let path = Path::new(&backup.path);
    let exists_now = path.is_file();
    match (&backup.content_hash, exists_now) {
        (None, false) => Ok(false),
        (None, true) => Ok(true),
        (Some(_), false) => Ok(true),
        (Some(captured_hash), true) => {
            let bytes = fs::read(path)?;
            Ok(hash_bytes(&bytes) != *captured_hash)
        }
    }
}
