//! Wire-side adapter for `project_management::lineage::git_bridge`.
//!
//! `commit_tracker` matches commit hunks against `node_provenance`, but it
//! cannot depend on `api::git` (which lives in `app`) because doing so would
//! pin `project_management` to `app`. Instead, `lineage::git_bridge` exposes
//! an `OnceLock<fn>` slot that this adapter populates at app boot with the
//! real `git2`-backed `get_commit_diff`.
//!
//! See `project_management::lineage::git_bridge` for the projection types and
//! the consumption side.

use std::path::Path;

use crate::commands::diff::get_commit_diff;
use project_management::lineage::git_bridge::{
    register_commit_diff, LineageCommitDiff, LineageFileDiff, LineageHunk,
};

/// Wire adapter: convert `CommitDiffResult` into the lineage projection.
fn commit_diff_for_lineage(
    repo_path: &Path,
    commit_sha: &str,
) -> Result<LineageCommitDiff, String> {
    let diff = get_commit_diff(repo_path, commit_sha, None, 0)?;
    Ok(LineageCommitDiff {
        files: diff
            .files
            .into_iter()
            .map(|file| LineageFileDiff {
                file_path: file.file_path,
                binary: file.binary,
                hunks: file
                    .hunks
                    .into_iter()
                    .map(|hunk| LineageHunk {
                        new_start: hunk.new_start,
                        new_lines: hunk.new_lines,
                    })
                    .collect(),
            })
            .collect(),
    })
}

/// Called from `app::run()` at startup.
pub fn register() {
    register_commit_diff(commit_diff_for_lineage);
}
