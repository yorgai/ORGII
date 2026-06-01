//! Shared utilities for session command handlers.
//!
//! Extracted from `mod.rs` to keep that file focused on `#[tauri::command]`
//! wrappers. Everything here is `pub(super)` — callers within
//! `state/commands/session/` import from `super::common`.

use serde::{Deserialize, Serialize};

/// Setting key for the maximum concurrent worktree count.
pub(super) const WORKTREE_MAX_COUNT_SETTING: &str = "git.worktree.maxCount";

/// Read the `git.worktree.maxCount` setting from user config.
///
/// Returns `None` when the setting is absent or cannot be read, which causes
/// callers to fall back to `DEFAULT_MAX_CONCURRENT_WORKTREES`.
pub(crate) fn worktree_max_count() -> Option<usize> {
    settings::file_io::read_settings()
        .ok()
        .and_then(|value| {
            value
                .get(WORKTREE_MAX_COUNT_SETTING)
                .and_then(|count| count.as_u64())
        })
        .map(|count| count as usize)
}

/// Session information returned by create/list operations.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub is_singleton: bool,
}
