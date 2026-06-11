//! Orphan-eviction helpers for [`super::housekeeping`].
//!
//! All functions are `pub(super)` — only the housekeeping orchestrator
//! (`run_deferred_cleanup`) calls them.

use std::fs;

use app_paths as paths;

/// Fetch every session_id currently present in both the `agent_sessions`
/// table (Rust-native agents) and the `code_sessions` table (CLI agents).
///
/// Agent worktrees are created exclusively for CLI agent sessions
/// (`code_sessions`), so omitting that table would cause every active
/// CLI worktree to be classified as orphaned and evicted prematurely.
///
/// Used by the orphan sweep to decide whether a per-session directory
/// still has a live owner. Returns an empty set if neither table exists
/// (fresh install / DB migration in progress) — callers treat `Err` as
/// "skip sweep".
pub(super) fn list_known_session_ids() -> Result<std::collections::HashSet<String>, String> {
    let conn =
        session_persistence::get_connection().map_err(|err| format!("get_connection: {}", err))?;

    let mut known = std::collections::HashSet::new();

    // Rust-native agent sessions
    let mut stmt = conn
        .prepare("SELECT session_id FROM agent_sessions")
        .map_err(|err| format!("prepare agent_sessions: {}", err))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("query_map agent_sessions: {}", err))?;
    for row in rows {
        match row {
            Ok(id) => {
                known.insert(id);
            }
            Err(err) => tracing::warn!("[housekeeping] agent_sessions row decode failed: {}", err),
        }
    }

    // CLI agent sessions — worktrees are only created for these
    let cli_table_exists: bool = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='code_sessions'")
        .and_then(|mut s| s.query_row([], |row| row.get::<_, i64>(0)))
        .map(|n| n > 0)
        .unwrap_or(false);

    if cli_table_exists {
        let mut cli_stmt = conn
            .prepare("SELECT session_id FROM code_sessions")
            .map_err(|err| format!("prepare code_sessions: {}", err))?;
        let cli_rows = cli_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| format!("query_map code_sessions: {}", err))?;
        for row in cli_rows {
            match row {
                Ok(id) => {
                    known.insert(id);
                }
                Err(err) => {
                    tracing::warn!("[housekeeping] code_sessions row decode failed: {}", err)
                }
            }
        }
    }

    Ok(known)
}

/// Evict every subdirectory of `root` whose name is a session_id that no
/// longer exists in `known_session_ids`. Files directly under `root`
/// (if any) are untouched.
pub(super) fn evict_orphan_session_dirs(
    root: std::path::PathBuf,
    known_session_ids: &std::collections::HashSet<String>,
) -> std::io::Result<usize> {
    if !root.exists() {
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(&root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if known_session_ids.contains(name) {
            continue;
        }
        if let Err(err) = fs::remove_dir_all(&path) {
            tracing::warn!(
                "[housekeeping] failed to evict orphan session dir {}: {}",
                path.display(),
                err
            );
            continue;
        }
        removed += 1;
    }

    if removed > 0 {
        tracing::info!(
            "[housekeeping] evicted {} orphan session dir(s) under {}",
            removed,
            root.display()
        );
    }

    Ok(removed)
}

/// Walk `~/.orgii/agent-worktrees/<repo_hash>/<session_id>/` two levels
/// deep and remove every `session_id` directory whose id is not in
/// `known_session_ids`.
///
/// Unlike the flat `cursor-config/<sid>/` layout, worktrees are grouped
/// by repo hash one level above the session id, which is why we can't
/// reuse `evict_orphan_session_dirs` directly. Empty repo-hash parents
/// are *not* pruned because `git worktree` expects the directory to
/// survive across session lifetimes.
pub(super) fn evict_orphan_agent_worktrees(
    root: std::path::PathBuf,
    known_session_ids: &std::collections::HashSet<String>,
) -> std::io::Result<usize> {
    if !root.exists() {
        return Ok(0);
    }

    let mut removed = 0;
    for repo_entry in fs::read_dir(&root)? {
        let repo_entry = repo_entry?;
        let repo_path = repo_entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        for sid_entry in fs::read_dir(&repo_path)? {
            let sid_entry = sid_entry?;
            let sid_path = sid_entry.path();
            if !sid_path.is_dir() {
                continue;
            }
            let Some(name) = sid_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if known_session_ids.contains(name) {
                continue;
            }
            if let Err(err) = fs::remove_dir_all(&sid_path) {
                tracing::warn!(
                    "[housekeeping] failed to evict orphan worktree {}: {}",
                    sid_path.display(),
                    err
                );
                continue;
            }
            removed += 1;
        }
    }

    if removed > 0 {
        tracing::info!(
            "[housekeeping] evicted {} orphan agent-worktree dir(s) under {}",
            removed,
            root.display()
        );
    }

    Ok(removed)
}

/// Delete files under `~/.orgii/session-images/` whose `file_name()` is
/// not referenced by any row in `agent_messages.images` (a JSON array
/// of absolute paths). Image filenames are content-addressed hashes so
/// once no message points to them they are irreclaimably dead.
///
/// Returns the number of files actually removed.
pub(super) fn evict_orphan_session_images() -> std::io::Result<usize> {
    let images_dir = paths::session_images_dir();
    if !images_dir.exists() {
        return Ok(0);
    }

    // Collect every image filename still referenced by a surviving message.
    let referenced = match live_session_image_filenames() {
        Ok(set) => set,
        Err(err) => {
            tracing::warn!(
                "[housekeeping] could not enumerate live image refs: {}; skipping",
                err
            );
            return Ok(0);
        }
    };

    let mut removed = 0;
    for entry in fs::read_dir(&images_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if referenced.contains(name) {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            tracing::warn!(
                "[housekeeping] failed to remove orphan session image {}: {}",
                path.display(),
                err
            );
            continue;
        }
        removed += 1;
    }

    if removed > 0 {
        tracing::info!(
            "[housekeeping] evicted {} orphan session-image file(s) under {}",
            removed,
            images_dir.display()
        );
    }

    Ok(removed)
}

/// Collect the `file_name()` of every path currently stored in
/// `agent_messages.images` (a JSON-array column). We compare filenames
/// rather than full paths because the column may store paths rooted at
/// the previous install location (e.g. user moved `~/.orgii/`); the
/// filename is a content hash and therefore stable across moves.
pub(super) fn live_session_image_filenames() -> Result<std::collections::HashSet<String>, String> {
    let conn =
        session_persistence::get_connection().map_err(|err| format!("get_connection: {}", err))?;
    let mut stmt = conn
        .prepare("SELECT images FROM agent_messages WHERE images IS NOT NULL")
        .map_err(|err| format!("prepare: {}", err))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("query_map: {}", err))?;

    let mut names = std::collections::HashSet::new();
    for row in rows.flatten() {
        let Ok(image_paths) = serde_json::from_str::<Vec<String>>(&row) else {
            continue;
        };
        for p in image_paths {
            if p.starts_with("data:") {
                continue;
            }
            if let Some(name) = std::path::Path::new(&p)
                .file_name()
                .and_then(|n| n.to_str())
            {
                names.insert(name.to_string());
            }
        }
    }
    Ok(names)
}

/// Delete `gateway_bindings` rows whose `target_session_id` is not in
/// `known_session_ids`.
///
/// # Memory-vs-DB tradeoff
///
/// [`BindingStore`] holds an in-memory cache keyed by `session_key`.
/// Housekeeping runs from `spawn_blocking` with no handle to the async
/// `AgentAppState` (and no `tokio::Runtime` context to acquire the
/// store's `RwLock`), so we delete straight from SQLite here.
///
/// This is **intentionally permitted** because:
/// 1. The row we evict points at a session already removed from
///    `agent_sessions` — `Tier-0` routing for it would fail anyway.
/// 2. If the in-memory cache still has the orphan entry, the next
///    inbound hit resolves to a missing target session → handler
///    falls back to Tier-1 LLM routing (graceful degradation, no
///    data corruption, no cross-session leak).
/// 3. [`BindingStore::load_from_db`] rehydrates from SQLite at every
///    gateway startup, so at worst the stale cache entry survives
///    until the next process restart.
///
/// [`BindingStore`]: agent_core::integrations::gateway::binding::BindingStore
/// [`BindingStore::load_from_db`]: agent_core::integrations::gateway::binding::BindingStore::load_from_db
pub(super) fn evict_orphan_gateway_bindings(
    known_session_ids: &std::collections::HashSet<String>,
) -> Result<usize, String> {
    let conn =
        session_persistence::get_connection().map_err(|err| format!("get_connection: {}", err))?;

    // Only consider the table present — first bootable gateway migration
    // creates it. When absent we simply report zero evictions.
    let has_table: bool = conn
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='gateway_bindings'",
        )
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i64>(0)))
        .map(|n| n > 0)
        .unwrap_or(false);
    if !has_table {
        return Ok(0);
    }

    let mut stmt = conn
        .prepare("SELECT session_key, target_session_id FROM gateway_bindings")
        .map_err(|err| format!("prepare: {}", err))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("query_map: {}", err))?;

    let orphans: Vec<String> = rows
        .flatten()
        .filter_map(|(key, target)| {
            if known_session_ids.contains(&target) {
                None
            } else {
                Some(key)
            }
        })
        .collect();

    for key in &orphans {
        if let Err(err) = conn.execute("DELETE FROM gateway_bindings WHERE session_key = ?1", [key])
        {
            tracing::warn!(
                "[housekeeping] failed to delete orphan gateway_binding {}: {}",
                key,
                err
            );
        }
    }

    if !orphans.is_empty() {
        tracing::info!(
            "[housekeeping] evicted {} orphan gateway_binding row(s)",
            orphans.len()
        );
    }

    Ok(orphans.len())
}
