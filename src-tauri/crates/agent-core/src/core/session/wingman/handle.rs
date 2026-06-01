//! `WingmanHandle` + `WingmanSessionState` — the live state attached to an
//! `AgentSession` while a Wingman observation loop is running.

use tokio::sync::Mutex as TokioMutex;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::warn;

/// Live handle for a running Wingman loop.
///
/// Dropped when `wingman_stop` is called, which signals cancellation and
/// waits for the task to exit.
pub struct WingmanHandle {
    /// The user's stated mission / intent for this Wingman session.
    pub mission: String,
    /// Cancellation token — set when `stop()` is called.
    pub(super) cancel: CancellationToken,
    /// Background task handle.
    pub(super) task: JoinHandle<()>,
}

impl WingmanHandle {
    /// Stop the Wingman loop and wait for it to exit.
    pub async fn stop(self) {
        self.cancel.cancel();
        if let Err(err) = self.task.await {
            warn!("[wingman] Background task panicked on stop: {:?}", err);
        }
    }

    /// Whether this handle is still running.
    pub fn is_running(&self) -> bool {
        !self.task.is_finished()
    }
}

/// Per-session Wingman state, stored inside `AgentSession`.
pub struct WingmanSessionState {
    /// Active handle — `None` when stopped.
    pub handle: TokioMutex<Option<WingmanHandle>>,
}

impl WingmanSessionState {
    pub fn new() -> Self {
        Self {
            handle: TokioMutex::new(None),
        }
    }
}

impl Default for WingmanSessionState {
    fn default() -> Self {
        Self::new()
    }
}
