//! Session workspace mutator commands.
//!
//! Thin wrappers around `SessionWorkspace` mutators. The handlers live
//! behind both Tauri commands (IDE UI + channel slash commands wired via
//! the Gateway workspace tools) and debug HTTP endpoints
//! (E2E). The core responsibility split is:
//!
//! - Locate the live runtime via `state.get_session(&sid).await` and
//!   its `.get_runtime().await`. No runtime → session is dead or
//!   archived; reject with a clear error.
//! - Mutate the shared `SessionRuntime.workspace_state` under its
//!   `parking_lot::RwLock`. The same `Arc<RwLock<_>>` is already held
//!   by every file tool registered against this session, so the
//!   change is visible on the next tool call without rebuilding the
//!   registry (see `core/tools/impls/coding/files.rs`).
//! - Persist to `agent_sessions.workspace_additional_json` via
//!   [`save_workspace`] so the mutation survives process restarts
//!   (memory-vs-DB split-brain). DB write happens **after**
//!   the in-memory mutation has succeeded; if the DB write fails we
//!   log + return the error to the caller but leave the in-memory
//!   state as is — the caller can retry or accept the drift.
//!
//! Mutations covered this phase:
//!
//! - [`add_directory`]: inserts a new [`AdditionalDirectory`] with a
//!   caller-specified `DirectorySource` (`session` / `ideWorkspace`).
//!   [`SessionWorkspace::add_directory`] canonicalizes the path before
//!   keying — callers may pass any spelling.
//! - [`remove_directory`]: removes an entry (same canonicalization as
//!   add). Returns `false` if the path wasn't present so callers can
//!   distinguish "no-op" from "removed".
//! - [`list_workspaces`]: read-only snapshot of `workspace_root`,
//!   `working_dir`, and every `additional_directory` entry for a
//!   session. Used by slash-command output + IDE popover.
//! - [`enter_worktree`]: switch the current session's `working_dir`
//!   into a git worktree while preserving stable `workspace_root` identity.
//!
//! Successful add/remove mutations additionally emit
//! [`WORKSPACE_CHANGED_EVENT`] so the frontend mirror
//! (`useSessionWorkspaceSync`) refreshes without polling.

use std::path::PathBuf;

use tracing::warn;

use crate::session::persistence::{
    clear_worktree_metadata, get_session, save_workspace, save_worktree_metadata,
    update_worktree_merge_status,
};
use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::session::workspace::{AdditionalDirectory, DirectorySource};
use crate::state::AgentAppState;

/// Caller-facing snapshot of a single additional directory entry.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdditionalDirectoryView {
    pub path: PathBuf,
    pub source: DirectorySource,
}

/// Tauri event channel emitted whenever a session's workspace changes
/// (directory added/removed, runtime rebuilt). The frontend mirror
/// (`useSessionWorkspaceSync`) listens on this name — keep in sync with
/// `src/api/tauri/agent/sessionWorkspace.ts` (`WORKSPACE_CHANGED_EVENT`).
pub const WORKSPACE_CHANGED_EVENT: &str = "workspace:changed";

/// Payload of [`WORKSPACE_CHANGED_EVENT`]. All paths canonical;
/// camelCase wire shape pinned by the frontend `WorkspaceChangedPayload`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedPayload {
    pub session_id: String,
    pub workspace_root: PathBuf,
    pub working_dir: PathBuf,
    pub additional_directories: Vec<AdditionalDirectoryView>,
}

/// Emit [`WORKSPACE_CHANGED_EVENT`] for `workspace`. Best-effort: a
/// missing app handle (headless tests, gateway) or emit failure is
/// logged and ignored — the frontend falls back to its pull-based
/// snapshot on session remount.
pub fn emit_workspace_changed(
    app_handle: Option<&tauri::AppHandle>,
    session_id: &str,
    workspace: &crate::session::workspace::SessionWorkspace,
) {
    let Some(app) = app_handle else {
        return;
    };
    use tauri::Emitter;
    let payload = WorkspaceChangedPayload {
        session_id: session_id.to_string(),
        workspace_root: crate::session::workspace::canonicalize_or_lexical(
            &workspace.workspace_root,
        ),
        working_dir: crate::session::workspace::canonicalize_or_lexical(workspace.working_dir()),
        additional_directories: workspace
            .additional_directories
            .values()
            .map(|d| AdditionalDirectoryView {
                path: d.path.clone(),
                source: d.source,
            })
            .collect(),
    };
    if let Err(err) = app.emit(WORKSPACE_CHANGED_EVENT, &payload) {
        warn!(
            session_id = %session_id,
            error = %err,
            "[session-workspace] failed to emit workspace:changed",
        );
    }
}

/// Caller-facing snapshot of the full workspace for one session.
/// Stable shape — used by slash commands, IDE popovers, and E2E
/// assertions, so the field names must not change without coordination.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWorkspaceView {
    pub session_id: String,
    pub workspace_root: PathBuf,
    pub working_dir: PathBuf,
    pub is_worktree: bool,
    pub additional_directories: Vec<AdditionalDirectoryView>,
}

/// Error type for workspace mutators. Kept simple (`String`) because
/// every caller today renders the value as text (slash-command reply
/// body, HTTP JSON `error` field, Tauri command `Result<_, String>`).
pub type WorkspaceResult<T> = Result<T, String>;

/// Lookup the live `workspace_state` handle for a session. Returns a
/// descriptive error if the session has no runtime attached (not
/// initialised, archived, or unknown id).
async fn resolve_workspace_state(
    state: &AgentAppState,
    session_id: &str,
) -> WorkspaceResult<std::sync::Arc<parking_lot::RwLock<crate::session::workspace::SessionWorkspace>>>
{
    let session = state
        .get_session(session_id)
        .await
        .ok_or_else(|| format!("session '{}' not found", session_id))?;
    let runtime = session
        .get_runtime()
        .await
        .ok_or_else(|| format!("session '{}' has no runtime (not initialised)", session_id))?;
    Ok(std::sync::Arc::clone(&runtime.workspace_state))
}

async fn invalidate_workspace_prompt_cache(state: &AgentAppState, session_id: &str) {
    if let Some(session) = state.get_session(session_id).await {
        session
            .invalidate_prompt_cache(PromptCacheInvalidationReason::WorkspaceSnapshotChanged)
            .await;
    }
}

/// Persist the current in-memory workspace to the per-session DB row.
/// Logs + returns `Err` on failure; the in-memory mutation is NOT
/// rolled back because the caller can choose to retry the save
/// separately. Callers render the error to the user.
fn persist(
    session_id: &str,
    workspace: &crate::session::workspace::SessionWorkspace,
) -> WorkspaceResult<()> {
    save_workspace(session_id, workspace)
        .map(|_updated| ())
        .map_err(|err| {
            warn!(
                session_id = %session_id,
                error = %err,
                "[session-workspace] save_workspace failed after in-memory mutation",
            );
            format!("failed to persist workspace for '{}': {}", session_id, err)
        })
}

/// Add an additional directory to a session's workspace.
///
/// Returns `true` if the path was newly added, `false` if it was
/// already present (first-writer-wins for `source`, matching cc's
/// `Map` semantics on `additionalWorkingDirectories`).
///
/// The DB is updated regardless of the insert outcome — in the
/// already-present case the row is effectively a no-op upsert, which
/// is cheap and guarantees the DB always reflects the in-memory map.
pub async fn add_directory(
    state: &AgentAppState,
    session_id: &str,
    path: PathBuf,
    source: DirectorySource,
) -> WorkspaceResult<bool> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let inserted = {
        let mut ws = handle.write();
        ws.add_directory(AdditionalDirectory {
            path: path.clone(),
            source,
        })
    };
    // Persist outside the write lock so the DB call doesn't hold up
    // concurrent tool reads.
    let snapshot = handle.read().clone();
    persist(session_id, &snapshot)?;
    invalidate_workspace_prompt_cache(state, session_id).await;
    emit_workspace_changed(state.app_handle.as_ref(), session_id, &snapshot);
    Ok(inserted)
}

/// Remove an additional directory.
///
/// Returns `true` if an entry was removed, `false` if the path was
/// not present. Does NOT return the removed `AdditionalDirectory`
/// itself — callers that need the source for logging can call
/// [`list_workspaces`] beforehand.
pub async fn remove_directory(
    state: &AgentAppState,
    session_id: &str,
    path: &std::path::Path,
) -> WorkspaceResult<bool> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let removed = {
        let mut ws = handle.write();
        ws.remove_directory(path).is_some()
    };
    if removed {
        let snapshot = handle.read().clone();
        persist(session_id, &snapshot)?;
        invalidate_workspace_prompt_cache(state, session_id).await;
        emit_workspace_changed(state.app_handle.as_ref(), session_id, &snapshot);
    }
    Ok(removed)
}

/// Switch the live session into a git worktree and persist the new `working_dir`.
pub async fn enter_worktree(
    state: &AgentAppState,
    session_id: &str,
    branch: Option<String>,
) -> WorkspaceResult<SessionWorkspaceView> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let current = handle.read().clone();
    if current.is_worktree() {
        return list_workspaces(state, session_id).await;
    }

    let workspace_root = current.workspace_root.clone();
    let session_id_owned = session_id.to_string();
    let worktree_info = tokio::task::spawn_blocking({
        let workspace_root = workspace_root.clone();
        let session_id = session_id_owned.clone();
        move || {
            git::worktree::create_session_worktree(
                &workspace_root,
                &session_id,
                branch.as_deref(),
                super::common::worktree_max_count(),
            )
        }
    })
    .await
    .map_err(|err| format!("failed to create worktree for '{}': {}", session_id, err))??;

    // Validate base_branch BEFORE persisting so that if it is missing we can
    // remove the newly-created worktree and return without ever writing a dirty
    // working_dir to the DB. Previously this check came after persist, which
    // required an expensive rollback-persist that could itself fail.
    let base_branch = match worktree_info.base_branch.clone() {
        Some(b) => b,
        None => {
            let _ = tokio::task::spawn_blocking({
                let workspace_root = workspace_root.clone();
                let session_id = session_id_owned.clone();
                move || git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
            })
            .await;
            return Err("failed to resolve worktree base branch".to_string());
        }
    };

    let mut next = current.clone();
    next.working_dir = PathBuf::from(&worktree_info.path);

    // Persist workspace first; on failure roll back the physical worktree.
    if let Err(err) = persist(session_id, &next) {
        let _ = tokio::task::spawn_blocking({
            let workspace_root = workspace_root.clone();
            let session_id = session_id_owned.clone();
            move || git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
        })
        .await;
        return Err(err);
    }

    if let Err(err) = save_worktree_metadata(
        session_id,
        &worktree_info.branch,
        &base_branch,
        git::worktree::WorktreeMergeStatus::Pending,
    ) {
        let _ = tokio::task::spawn_blocking({
            let workspace_root = workspace_root.clone();
            let session_id = session_id_owned.clone();
            move || git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
        })
        .await;
        // Restore DB to original workspace; best-effort (log on failure).
        let _ = persist(session_id, &current);
        let _ = clear_worktree_metadata(session_id);
        return Err(format!("failed to persist worktree metadata: {}", err));
    }

    *handle.write() = next;
    invalidate_workspace_prompt_cache(state, session_id).await;
    list_workspaces(state, session_id).await
}

pub async fn apply_worktree(
    state: &AgentAppState,
    session_id: &str,
    strategy: Option<String>,
) -> WorkspaceResult<git::worktree::WorktreeMergeResult> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let current = handle.read().clone();
    if !current.is_worktree() {
        return Err("current session is not running in a worktree".to_string());
    }

    let record = tokio::task::spawn_blocking({
        let session_id = session_id.to_string();
        move || get_session(&session_id)
    })
    .await
    .map_err(|err| format!("failed to load session '{}': {}", session_id, err))?
    .map_err(|err| format!("failed to load session '{}': {}", session_id, err))?
    .ok_or_else(|| format!("session '{}' not found", session_id))?;

    let base_branch = record
        .base_branch
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "session has no recorded worktree base branch".to_string())?
        .to_string();
    if record
        .worktree_branch
        .as_deref()
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("session has no recorded worktree branch".to_string());
    }

    let merge_strategy = git::worktree::MergeStrategy::parse(strategy.as_deref().unwrap_or("auto"));
    let workspace_root = current.workspace_root.clone();
    let session_id_owned = session_id.to_string();
    let result = tokio::task::spawn_blocking({
        let workspace_root = workspace_root.clone();
        let session_id = session_id_owned.clone();
        move || {
            git::worktree::merge_session_worktree(
                &workspace_root,
                &session_id,
                &base_branch,
                merge_strategy,
            )
        }
    })
    .await
    .map_err(|err| format!("failed to merge worktree for '{}': {}", session_id, err))??;

    let status = if result.merged {
        git::worktree::WorktreeMergeStatus::Merged
    } else if !result.conflicts.is_empty() {
        git::worktree::WorktreeMergeStatus::Conflict
    } else if result.error.is_some() {
        git::worktree::WorktreeMergeStatus::Failed
    } else {
        git::worktree::WorktreeMergeStatus::Skipped
    };

    if result.merged {
        let reset_workspace =
            crate::session::workspace::SessionWorkspace::new(workspace_root.clone());
        // Persist the workspace reset and clear metadata BEFORE physically
        // removing the worktree. A crash between persist and removal leaves an
        // orphan worktree on disk (pruned at next startup) but the DB stays
        // consistent. The reverse order (remove first) could leave the DB
        // pointing at a non-existent path on a failed persist.
        persist(session_id, &reset_workspace)?;
        // update_worktree_merge_status and clear run in-process; if either
        // fails we still have a correct working_dir in DB — log and continue.
        if let Err(err) = update_worktree_merge_status(session_id, status) {
            warn!(
                session_id = %session_id,
                error = %err,
                "[session-workspace] failed to persist Merged status after successful merge",
            );
        }
        let _ = clear_worktree_metadata(session_id);
        *handle.write() = reset_workspace;
        // Physical removal is best-effort: pruner will catch leftovers.
        let remove_result = tokio::task::spawn_blocking({
            let workspace_root = workspace_root.clone();
            let session_id = session_id_owned.clone();
            move || git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
        })
        .await;
        if let Ok(Err(err)) = remove_result {
            warn!(
                session_id = %session_id_owned,
                error = %err,
                "[session-workspace] failed to remove worktree after merge; will be pruned at startup",
            );
        }
        invalidate_workspace_prompt_cache(state, session_id).await;
    } else {
        update_worktree_merge_status(session_id, status)
            .map_err(|err| format!("failed to persist worktree merge status: {}", err))?;
    }

    Ok(result)
}

pub async fn delete_worktree(
    state: &AgentAppState,
    session_id: &str,
) -> WorkspaceResult<SessionWorkspaceView> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let current = handle.read().clone();
    if !current.is_worktree() {
        return list_workspaces(state, session_id).await;
    }

    let workspace_root = current.workspace_root.clone();
    let session_id_owned = session_id.to_string();

    // Persist the workspace reset BEFORE physically removing the worktree.
    // This ensures the DB never points at a non-existent path: if persist
    // fails we abort early and the worktree remains intact; if persist
    // succeeds and the removal later fails the disk gets an orphan that the
    // startup pruner will clean up.
    let reset_workspace = crate::session::workspace::SessionWorkspace::new(workspace_root.clone());
    persist(session_id, &reset_workspace)?;
    clear_worktree_metadata(session_id)
        .map_err(|err| format!("failed to clear worktree metadata: {}", err))?;
    *handle.write() = reset_workspace;
    invalidate_workspace_prompt_cache(state, session_id).await;

    // Physical removal is best-effort after the DB is already consistent.
    let remove_result = tokio::task::spawn_blocking({
        let workspace_root = workspace_root.clone();
        let session_id = session_id_owned.clone();
        move || git::worktree::remove_session_worktree(&workspace_root, &session_id, true)
    })
    .await;
    if let Ok(Err(err)) = remove_result {
        warn!(
            session_id = %session_id_owned,
            error = %err,
            "[session-workspace] failed to remove worktree directory after delete; will be pruned at startup",
        );
    }

    list_workspaces(state, session_id).await
}

/// Read-only snapshot of the session's workspace. Shape is stable;
/// used by slash-command rendering + IDE popover + E2E.
pub async fn list_workspaces(
    state: &AgentAppState,
    session_id: &str,
) -> WorkspaceResult<SessionWorkspaceView> {
    let handle = resolve_workspace_state(state, session_id).await?;
    let ws = handle.read();
    let additional: Vec<AdditionalDirectoryView> = ws
        .additional_directories
        .values()
        .map(|d| AdditionalDirectoryView {
            path: d.path.clone(),
            source: d.source,
        })
        .collect();
    Ok(SessionWorkspaceView {
        session_id: session_id.to_string(),
        workspace_root: ws.workspace_root.clone(),
        working_dir: ws.working_dir().to_path_buf(),
        is_worktree: ws.is_worktree(),
        additional_directories: additional,
    })
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::workspace::SessionWorkspace;

    // A plain unit test on the mutator shape (no AgentAppState wiring
    // needed) — proves the view projection is stable + round-trips
    // every field we expose to callers. Integration coverage of the
    // full `add_directory` → `save_workspace` → `load_workspace` path
    // lives in E2E (`workspace-add-directory-persists`).
    #[test]
    fn session_workspace_view_projects_every_field() {
        let mut ws =
            SessionWorkspace::new_worktree(PathBuf::from("/proj"), PathBuf::from("/shadow/abc"));
        ws.add_directory(AdditionalDirectory {
            path: PathBuf::from("/peer"),
            source: DirectorySource::LocalSettings,
        });

        let view = SessionWorkspaceView {
            session_id: "sid".into(),
            workspace_root: ws.workspace_root.clone(),
            working_dir: ws.working_dir().to_path_buf(),
            is_worktree: ws.is_worktree(),
            additional_directories: ws
                .additional_directories
                .values()
                .map(|d| AdditionalDirectoryView {
                    path: d.path.clone(),
                    source: d.source,
                })
                .collect(),
        };

        assert_eq!(view.workspace_root, PathBuf::from("/proj"));
        assert_eq!(view.working_dir, PathBuf::from("/shadow/abc"));
        assert!(view.is_worktree);
        assert_eq!(view.additional_directories.len(), 1);
        assert_eq!(view.additional_directories[0].path, PathBuf::from("/peer"));
        assert_eq!(
            view.additional_directories[0].source,
            DirectorySource::LocalSettings
        );
    }
}
