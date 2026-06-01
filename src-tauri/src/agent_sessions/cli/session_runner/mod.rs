//! Code session runner — split into focused submodules.
//!
//! Spawns a CLI agent subprocess, pipes stdout through the appropriate parser,
//! stores ActivityChunks, and broadcasts them via WebSocket.
//!
//! Submodules:
//! - `helpers`       — shared state, emit_chunk, image persistence
//! - `command`       — CLI command building and parser factory
//! - `session`       — core run_session function
//! - `lifecycle`     — kill, cancel, cleanup
//! - `proxy_release` — market proxy token release
//! - `cursor_usage`  — Cursor Dashboard API token tracking

mod command;
mod cursor_usage;
mod helpers;
mod lifecycle;
mod proxy_release;
mod session;

pub use helpers::RUNNING_SESSIONS;
pub use lifecycle::{
    cancel_session, cleanup_cursor_config_dir, kill_running_agent, terminate_process_tree,
};
pub use proxy_release::release_proxy_token_for_session_pub;
pub use session::run_session;

#[cfg(test)]
#[path = "../tests/runner_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/runner_command_tests.rs"]
mod command_tests;
