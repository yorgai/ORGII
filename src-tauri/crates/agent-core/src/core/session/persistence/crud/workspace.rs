//! `SessionWorkspace` <-> DB round-trip.
//!
//! These helpers are the ONLY supported read/write path for the workspace
//! model. They decode the JSON column, materialise a `SessionWorkspace`
//! against the row's `workspace_path` / `worktree_path`, and round-trip
//! mutations back atomically.
//!
//! Callers should NOT poke `workspace_additional_json` directly via
//! `UnifiedSessionRecord` — full-record upserts use a CASE-guarded
//! ON CONFLICT that preserves the existing JSON when the caller didn't
//! explicitly set it, but point mutations (add/remove dir) belong here.

use rusqlite::{params, Result as SqliteResult};

use database::db::get_connection;

use super::super::super::workspace::SessionWorkspace;
use super::ops::get_session;

pub fn save_worktree_metadata(
    session_id: &str,
    branch: &str,
    base_branch: &str,
    merge_status: git::worktree::WorktreeMergeStatus,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let updated = conn.execute(
        "UPDATE agent_sessions \
         SET worktree_branch = ?2, base_branch = ?3, merge_status = ?4 \
         WHERE session_id = ?1",
        params![session_id, branch, base_branch, merge_status.to_string()],
    )?;
    Ok(updated > 0)
}

pub fn update_worktree_merge_status(
    session_id: &str,
    merge_status: git::worktree::WorktreeMergeStatus,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let updated = conn.execute(
        "UPDATE agent_sessions SET merge_status = ?2 WHERE session_id = ?1",
        params![session_id, merge_status.to_string()],
    )?;
    Ok(updated > 0)
}

pub fn clear_worktree_metadata(session_id: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let updated = conn.execute(
        "UPDATE agent_sessions \
         SET worktree_branch = NULL, base_branch = NULL, merge_status = NULL \
         WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(updated > 0)
}

/// Load a [`SessionWorkspace`] for the given session.
///
/// Returns `Ok(None)` when the session exists but has no
/// `workspace_path` (e.g. a pure-channel OS session with no grounding);
/// workspace-bound behaviour keys off this being `Some`.
///
/// Returns `Ok(None)` when the session row itself does not exist.
/// A corrupted `workspace_additional_json` degrades gracefully to
/// empty + a tracing warning — workspace load is never allowed to
/// block session recovery.
///
/// PR-C wires this into `ToolDeps` construction
/// so freshly-spawned runtimes pick up `additional_directories`
/// persisted by earlier mutator calls (`/add-dir`, workspace set
/// commands). Callers: `integration::process_message`,
/// `init::helpers::build_session_runtime`.
pub fn load_workspace(session_id: &str) -> SqliteResult<Option<SessionWorkspace>> {
    let Some(record) = get_session(session_id)? else {
        return Ok(None);
    };
    let Some(workspace_path) = record.workspace_path else {
        return Ok(None);
    };

    let workspace_root = std::path::PathBuf::from(workspace_path);
    let working_dir = record
        .worktree_path
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| workspace_root.clone());

    let additional_directories = serde_json::from_str(&record.workspace_additional_json)
        .unwrap_or_else(|err| {
            tracing::warn!(
                session_id = %session_id,
                error = %err,
                json_len = record.workspace_additional_json.len(),
                "[session-workspace] workspace_additional_json malformed — defaulting to empty map"
            );
            std::collections::BTreeMap::new()
        });

    Ok(Some(SessionWorkspace {
        workspace_root,
        working_dir,
        additional_directories,
    }))
}

/// Persist a [`SessionWorkspace`] for the given session.
///
/// This writes `workspace_path`, `worktree_path`, and
/// `workspace_additional_json` in a single `UPDATE`. It is a point
/// mutation — it does NOT create a new row and returns
/// `Ok(false)` if the session row does not exist (callers are
/// expected to `upsert_session` first for new rows).
///
/// `worktree_path` is set to `NULL` for non-worktree sessions
/// (`workspace_root == working_dir`) so downstream code that uses
/// `worktree_path.is_some()` as the "is worktree?" predicate keeps
/// working during the compat window.
///
/// Called by `state::commands::session::workspace::persist` after every
/// `add_directory` / `remove_directory` mutator so the in-memory
/// `SessionWorkspace` (shared via `Arc<RwLock<_>>`) and the persisted
/// `workspace_additional_json` stay in sync (memory-vs-DB split-brain).
pub fn save_workspace(session_id: &str, workspace: &SessionWorkspace) -> SqliteResult<bool> {
    let conn = get_connection()?;

    let workspace_path = workspace.user_visible().to_string_lossy().into_owned();
    let worktree_path: Option<String> = if workspace.is_worktree() {
        Some(workspace.working_dir().to_string_lossy().into_owned())
    } else {
        None
    };
    let json = serde_json::to_string(&workspace.additional_directories).map_err(|err| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("serialise workspace_additional_json: {err}"),
        )))
    })?;

    // Does not bump `updated_at` — workspace dir add/remove is config,
    // not conversation activity. See the invariant note in
    // `crud/ops.rs`.
    let updated = conn.execute(
        "UPDATE agent_sessions \
         SET workspace_path = ?2, worktree_path = ?3, \
             workspace_additional_json = ?4 \
         WHERE session_id = ?1",
        params![session_id, workspace_path, worktree_path, json],
    )?;
    Ok(updated > 0)
}
