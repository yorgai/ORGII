//! Filesystem tools — `read_file`, `list_dir`, and `delete_file`.
//!
//! Thin wrappers over shared file infrastructure. When `ActionRouter` is
//! present and in `work_station` mode, calls are routed through the frontend
//! ActionSystem instead of direct backend filesystem access.
//!
//! `edit_file` lives in [`super::edit_file`] (supports both create/overwrite
//! and search-replace).

mod delete_file;
mod list_dir;
mod read_file;

pub use delete_file::DeleteFileTool;
pub use list_dir::ListDirTool;
pub use read_file::ReadFileTool;

use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;

use crate::session::workspace::SessionWorkspace;
use crate::tools::traits::ToolError;

/// Shared handle to a session's live `SessionWorkspace`. Held as an
/// `Arc<RwLock<_>>` so `/add-dir` mutator commands land in file tools without
/// rebuilding the tool registry; tools snapshot `additional_directories` into
/// a `Vec<PathBuf>` on each call.
pub(super) type WorkspaceStateHandle = Arc<RwLock<SessionWorkspace>>;

/// Merge the static additional dirs (e.g. scratchpad) with the live
/// `additional_directories` from `workspace_state` into a single `Vec<PathBuf>`
/// suitable for the existing `tool_infra::file` API.
///
/// Callers pass the result as `&[PathBuf]` — no further locking needed because
/// we clone the paths out of the guard before returning.
pub(super) fn merge_additional_dirs(
    static_dirs: &[PathBuf],
    workspace_state: Option<&WorkspaceStateHandle>,
) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = static_dirs.to_vec();
    if let Some(state) = workspace_state {
        let ws = state.read();
        for (path, _) in ws.additional_directories.iter() {
            out.push(path.clone());
        }
    }
    out
}

/// Sandbox root shared between a tool instance and its `set_active_repo`
/// updates. We use a fast synchronous `parking_lot::RwLock` because every tool
/// call only needs a short-lived read without crossing an `.await`.
///
/// A `None` inner value means "no sandbox" — in that case `set_active_repo`
/// is a no-op, preserving the caller's original decision to run unrestricted.
#[derive(Clone, Default)]
pub(super) struct ActiveAllowedDir(Arc<RwLock<Option<PathBuf>>>);

impl ActiveAllowedDir {
    pub(super) fn new(initial: Option<PathBuf>) -> Self {
        Self(Arc::new(RwLock::new(initial)))
    }

    pub(super) fn snapshot(&self) -> Option<PathBuf> {
        self.0.read().clone()
    }

    /// Update the sandbox root when the user switches the active IDE repo.
    /// No-op when the tool was created without a sandbox (`None`) — going from
    /// unrestricted to restricted mid-session would silently tighten
    /// permissions, which is not what the caller asked for.
    pub(super) fn update_if_restricted(&self, new_root: PathBuf) {
        let mut guard = self.0.write();
        if guard.is_some() {
            *guard = Some(new_root);
        }
    }
}

/// Map `tool_service` String errors to `ToolError`.
pub(super) fn map_err(err: String) -> ToolError {
    if err.contains("outside the allowed directory") || err.contains("null byte") {
        ToolError::PermissionDenied(err)
    } else {
        ToolError::ExecutionFailed(err)
    }
}
