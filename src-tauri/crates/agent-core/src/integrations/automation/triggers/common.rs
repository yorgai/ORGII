//! Shared types used across all automation trigger listeners.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Message sent from a trigger listener to the engine evaluator.
#[derive(Debug, Clone)]
pub struct TriggerEvent {
    /// The rule ID that should be evaluated.
    pub rule_id: String,
}

/// Git event broadcast from the git watch system into ATC.
#[derive(Debug, Clone)]
pub struct GitBroadcastEvent {
    /// The git operation type (e.g. "commit", "push", "pull", "checkout").
    pub operation: String,
    /// Repository ID.
    pub repo_id: String,
    /// Change type from the watcher (e.g. "files", "git_meta", "branch", "remote").
    pub change_type: String,
}
/// Shared resources that trigger spawners may need.
/// Passed by reference from the engine so triggers can subscribe to broadcasts.
pub struct TriggerContext {
    /// Git event broadcast receiver (subscribe via `.subscribe()`).
    pub git_event_tx: broadcast::Sender<GitBroadcastEvent>,
    /// Channel message broadcast receiver (subscribe via `.subscribe()`).
    pub channel_msg_tx: broadcast::Sender<crate::bus::InboundMessage>,
}

/// Handle to a running trigger listener (for cleanup).
pub struct TriggerHandle {
    pub rule_id: String,
    pub(super) running: Arc<AtomicBool>,
    pub(super) handle: Option<tokio::task::JoinHandle<()>>,
}

impl TriggerHandle {
    /// Stop this trigger listener.
    pub fn stop(&mut self) {
        self.running
            .store(false, std::sync::atomic::Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}
