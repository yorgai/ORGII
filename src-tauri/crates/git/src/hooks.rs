//! Inversion-of-control hooks the `git` crate uses to notify the rest of the
//! app. Set once at startup from `app::lib`; absent in tests (no-op).
//!
//! Keeps the crate a true leaf — implementations of `api::websocket_handler`,
//! `agent_core::automation::bridge`, and `dev_record::collector` are
//! registered by `app::lib::run` rather than imported directly.

use std::sync::OnceLock;

/// Broadcast a git event over the WebSocket layer (JSON-encoded message body).
pub type WebsocketBroadcast = Box<dyn Fn(String) + Send + Sync>;

/// Record a file change for coding-activity telemetry.
///
/// Args mirror `dev_record::collector::record_file_change`:
/// `(project, file_path, lines_added, lines_removed)`. The `git` watch layer
/// always passes `0, 0` for line deltas — they are computed downstream from
/// the actual git diff, not from the inotify event.
pub type RecordFileChange = Box<dyn Fn(Option<String>, String, i32, i32) + Send + Sync>;

/// Forward a git watch event onto the automation bus.
///
/// Mirrors the fields of `agent_core::automation::GitBroadcastEvent` —
/// kept as an owned struct local to this module so `git` does not depend on
/// `agent_core`. The bridge converts it back to the automation enum.
#[derive(Debug, Clone)]
pub struct GitWatchEvent {
    /// The git operation type (e.g. "commit", "push", "pull", "checkout").
    pub operation: String,
    /// Repository ID.
    pub repo_id: String,
    /// Change type from the watcher (e.g. "files", "git_meta", "branch", "remote").
    pub change_type: String,
}

pub type SendGitEvent = Box<dyn Fn(GitWatchEvent) + Send + Sync>;

static WS_BROADCAST: OnceLock<WebsocketBroadcast> = OnceLock::new();
static FILE_CHANGE: OnceLock<RecordFileChange> = OnceLock::new();
static GIT_EVENT: OnceLock<SendGitEvent> = OnceLock::new();

pub fn register_websocket_broadcast(f: WebsocketBroadcast) {
    if WS_BROADCAST.set(f).is_err() {
        tracing::warn!("git::hooks: websocket_broadcast already registered");
    }
}

pub fn register_file_change(f: RecordFileChange) {
    if FILE_CHANGE.set(f).is_err() {
        tracing::warn!("git::hooks: file_change already registered");
    }
}

pub fn register_git_event(f: SendGitEvent) {
    if GIT_EVENT.set(f).is_err() {
        tracing::warn!("git::hooks: git_event already registered");
    }
}

pub(crate) fn websocket_broadcast(msg: String) {
    if let Some(f) = WS_BROADCAST.get() {
        f(msg);
    }
}

pub(crate) fn record_file_change(
    project: Option<String>,
    file_path: String,
    lines_added: i32,
    lines_removed: i32,
) {
    if let Some(f) = FILE_CHANGE.get() {
        f(project, file_path, lines_added, lines_removed);
    }
}

pub(crate) fn send_git_event(ev: GitWatchEvent) {
    if let Some(f) = GIT_EVENT.get() {
        f(ev);
    }
}
