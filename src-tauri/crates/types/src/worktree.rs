//! Pure data types describing git-worktree merge intent and outcome.
//!
//! The behaviour (spawning git, walking the worktree dir) lives in
//! `app::git::worktree`. These types live here so that
//! `agent_sessions` can reference them without depending on the `git`
//! module — that was the upward edge causing the
//! `git ↔ agent_sessions` cycle.

use serde::{Deserialize, Serialize};

/// Strategy a session uses when its worktree is being merged back into
/// the base branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    /// Run a real `git merge --no-ff` and let any conflicts surface.
    AutoMerge,
    /// Keep the work on its branch — the user will merge manually later.
    LeaveAsBranch,
    /// Fast-forward only; bail with `error` if a real merge would be needed.
    FastForward,
}

impl MergeStrategy {
    /// Parse the lower-case wire value sent by the frontend. Unknown
    /// values fall back to [`MergeStrategy::LeaveAsBranch`] so a stale
    /// or malformed setting never destroys work.
    pub fn parse(value: &str) -> Self {
        match value {
            "auto" => Self::AutoMerge,
            "leave" => Self::LeaveAsBranch,
            "ff" => Self::FastForward,
            _ => Self::LeaveAsBranch,
        }
    }
}

/// Outcome of a worktree merge attempt. `merged` is the contract bit;
/// the other fields exist to surface diagnostic info to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMergeResult {
    pub merged: bool,
    pub branch: String,
    pub base_branch: String,
    pub conflicts: Vec<String>,
    pub error: Option<String>,
}
