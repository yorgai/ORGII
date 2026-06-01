/**
 * Git Commands Module
 *
 * Organized into submodules by functionality:
 * - branch: Branch operations
 * - commit: Commit operations
 * - remote: Remote operations (push, pull, fetch)
 * - staging: Staging/unstaging files
 * - stash: Stash operations
 * - merge: Merge, rebase, cherry-pick, revert
 * - diff: Diff and file content operations
 * - streaming: Real-time SSE streaming for git operations
 * - utils: Shared utilities
 */
pub mod ai;
pub mod branch;
pub mod commit;
pub mod cursor_chat;
pub mod diff;
pub mod merge;
pub mod remote;
pub mod staging;
pub mod stash;
pub mod streaming;
pub mod tasks;
pub mod utils;

// Re-export all public functions for convenience
pub use branch::*;
pub use commit::*;
pub use diff::*;
pub use merge::*;
pub use remote::*;
pub use staging::*;
pub use stash::*;
pub use streaming::*;
pub use utils::*;
