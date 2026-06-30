//! Code session runner — split into focused submodules.
//!
//! Spawns a CLI agent subprocess, pipes stdout through the appropriate parser,
//! stores ActivityChunks, and broadcasts them via WebSocket.
//!
//! Submodules:
//! - `helpers`        — shared state, emit_chunk, image persistence
//! - `command`        — CLI command building and parser factory
//! - `session`        — core run_session function
//! - `lifecycle`      — kill, cancel, cleanup
//! - `proxy_release`  — market proxy token release
//! - `cursor_usage`   — Cursor Dashboard API token tracking
//! - `context_bridge` — prior-conversation injection for CLI sessions
//! - `oauth_setup`    — OAuth auth file writing and retry detection
//! - `plan_approval`  — plan detection and approval card registration
//! - `token_sync`     — post-run token sync back to key vault

mod command;
mod context_bridge;
mod cursor_usage;
mod helpers;
mod lifecycle;
mod oauth_setup;
mod plan_approval;
mod proxy_release;
mod session;
mod token_sync;

pub use helpers::{flush_cli_streams_for_session, RUNNING_SESSIONS};
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
