//! Diff and File Content Operations (using git2)
//!
//! Provides structured diff access with hunks, lines, and proper status detection.
//! Uses libgit2 for reliable parsing instead of CLI output.
//!
//! # Submodules
//!
//! - `file_content` — Read file content at a specific ref
//! - `diff_ops` — Core diff operations (single file, batch, staged)
//! - `commit` — Commit diff operations
//! - `blame` — Git blame operations
//! - `numstat` — Per-file stats without full content
//! - `summary` — Diff stats only

pub mod blame;
pub mod commit;
pub mod diff_ops;
pub mod file_content;
pub mod numstat;
pub mod ref_utils;
pub mod summary;

// Re-export all public items
pub use blame::get_blame;
pub use commit::get_commit_diff;
pub use diff_ops::{
    get_batch_file_diffs, get_file_diff, get_file_diff_with_rename, get_staged_diff,
    get_staged_file_diff,
};
pub use file_content::get_file_content;
pub use numstat::{get_diff_numstat, get_diff_numstat_combined, CombinedDiffNumstatResult};
pub use summary::get_diff_summary;

#[cfg(test)]
#[path = "../tests/diff_tests.rs"]
mod tests;
