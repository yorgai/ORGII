//! IoC slot for retrieving commit diffs from `git` / `api::git`.
//!
//! `commit_tracker` matches commit hunks against `node_provenance` rows but
//! does not own the git2-backed diff implementation. To keep
//! `project_management` independent of the `git` crate (and ultimately of
//! `app`), this module exposes a slot that the wire crate registers at
//! startup with the real `get_commit_diff`. The shape returned is the
//! minimal projection `commit_tracker` needs — just file paths and line
//! ranges — so we never have to hoist `CommitDiffResult` into a shared
//! location.

use std::path::Path;
use std::sync::OnceLock;

/// Hunk projection used by lineage matching.
#[derive(Debug, Clone)]
pub struct LineageHunk {
    pub new_start: u32,
    pub new_lines: u32,
}

/// File projection used by lineage matching.
#[derive(Debug, Clone)]
pub struct LineageFileDiff {
    pub file_path: String,
    pub binary: bool,
    pub hunks: Vec<LineageHunk>,
}

/// Result of a commit-diff lookup, projected for lineage matching.
#[derive(Debug, Clone, Default)]
pub struct LineageCommitDiff {
    pub files: Vec<LineageFileDiff>,
}

type CommitDiffFn = fn(&Path, &str) -> Result<LineageCommitDiff, String>;

static COMMIT_DIFF: OnceLock<CommitDiffFn> = OnceLock::new();

/// Wire-side: register the implementation. Called once at app startup.
pub fn register_commit_diff(implementation: CommitDiffFn) {
    let _ = COMMIT_DIFF.set(implementation);
}

/// Read-side: look up a commit's diff via the registered implementation.
///
/// Returns `Err` (not a panic) with a clear message when the slot was
/// never registered. Callers in `commit_tracker` already propagate the
/// `Result<_, String>` up to the Tauri command boundary, so a wiring
/// gap surfaces to the frontend as a normal error instead of crashing
/// the process. We log at `error!` so boot smoke catches it.
pub fn get_commit_diff(repo_path: &Path, commit_sha: &str) -> Result<LineageCommitDiff, String> {
    match COMMIT_DIFF.get() {
        Some(implementation) => implementation(repo_path, commit_sha),
        None => {
            tracing::error!(
                "project_management::lineage::git_bridge::get_commit_diff called \
                 before register_commit_diff(); git_api::lineage_bridge::register() \
                 must run during app::run startup"
            );
            Err("lineage::git_bridge: get_commit_diff slot not registered; \
                 git_api::lineage_bridge::register() must run during app::run startup"
                .to_string())
        }
    }
}
