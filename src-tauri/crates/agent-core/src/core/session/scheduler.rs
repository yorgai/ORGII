//! Per-session dialog scheduler — non-blocking message queue.
//!
//! ## Problem
//!
//! Without a scheduler, `sde_session_message` holds `processing_lock` for the
//! entire duration of an LLM turn (potentially minutes).  Any subsequent Tauri
//! command call either:
//! - Blocks the calling thread until the lock is released, or
//! - Times out and returns an error to the frontend.
//!
//! ## Solution
//!
//! Each `AgentSession` owns a `DialogScheduler`.  When a new message arrives:
//!
//! 1. The Tauri command enqueues a `ScheduledMessage` and **immediately returns**
//!    `{ "status": "queued", "queuePosition": N }` to the frontend.
//! 2. The scheduler's background worker processes messages one at a time,
//!    executing the full turn pipeline (init → process → finalize).
//! 3. Results are broadcast as `agent:complete` / `agent:error` events — the
//!    same events the frontend already listens to.
//!
//! ## Ordering guarantee
//!
//! Messages are processed **FIFO** within a session.  Cross-session ordering
//! is independent.
//!
//! ## Cancellation
//!
//! Call `AgentSession::cancel_active_turn()` to signal the running turn via
//! the shared `cancel_flag`.  To discard all pending messages, drop and
//! recreate the scheduler (session eviction handles this automatically).
//!
//! ## Lazy initialization
//!
//! The worker task is spawned on the **first enqueue**, not at construction.
//! This avoids requiring a Tokio runtime when `AgentSession::new()` is called
//! from synchronous Tauri state initialization code.

use futures::FutureExt;
use std::any::Any;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tracing::{error, info, warn};

use super::turn::streaming::{
    broadcast_agent_error_structured, classify_streaming_error_message, StreamingError,
};
use crate::bus::broadcast_event;

// ============================================
// Scheduled Message
// ============================================

/// Boxed async callback type for scheduler messages.
pub type ExecuteFn = Box<
    dyn FnOnce() -> futures::future::BoxFuture<'static, Result<String, String>> + Send + 'static,
>;

/// A single message waiting to be processed by the scheduler worker.
pub struct ScheduledMessage {
    /// Stable ID for this queued item (different from `turn_id`, which is
    /// assigned only when the message actually starts executing).
    pub message_id: String,
    /// Generation captured at enqueue time. Rewind/edit-resend invalidates
    /// queued stale generations so old user intent cannot write back later.
    pub generation: u64,
    /// Client-supplied idempotency key for suppressing duplicate sends.
    pub client_message_id: Option<String>,
    /// Canonical user-intent id. Stays stable across the IPC boundary and
    /// is written into the persisted user_message event so the turn
    /// indexer can collapse synthetic + backend rows that share the same
    /// id. Empty only on the rare turn paths that intentionally skip
    /// user-message persistence (resume with empty content).
    pub turn_intent_id: String,
    /// The user content to process.
    pub content: String,
    /// Opaque processing callback.  Boxed future factory so the scheduler
    /// does not need to know about `TurnInput` / session internals.
    pub execute: ExecuteFn,
}

fn panic_payload_to_string(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<String>() {
        return message.clone();
    }
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        return (*message).to_string();
    }
    "non-string panic payload".to_string()
}

impl std::fmt::Debug for ScheduledMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScheduledMessage")
            .field("message_id", &self.message_id)
            .field("content_len", &self.content.len())
            .finish()
    }
}

// ============================================
// Queue Status (serializable for Tauri events)
// ============================================

/// Current queue state, broadcast as `agent:queue_status`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub session_id: String,
    /// Number of messages waiting (not including the one currently running).
    pub pending_count: usize,
    /// Whether a message is currently being processed.
    pub is_processing: bool,
}

// ============================================
// Enqueue Result
// ============================================

/// Returned to the Tauri command caller after a successful enqueue.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueResult {
    pub message_id: String,
    /// Zero-based position in the queue (0 = next to run).
    pub queue_position: usize,
    #[serde(default)]
    pub duplicate: bool,
}

// ============================================
// DialogScheduler
// ============================================

/// Inner state initialized lazily on first enqueue.
struct SchedulerInner {
    tx: mpsc::Sender<ScheduledMessage>,
}

/// Per-session FIFO message queue with a single background worker.
///
/// Created once per `AgentSession` and kept alive for the session lifetime.
/// The worker task shuts down when the sender half is dropped (i.e. when the
/// session is removed from the registry).
///
/// **Lazy initialization**: The background worker is only spawned on the first
/// call to `enqueue()`. This allows `AgentSession::new()` to be called from
/// synchronous code (like Tauri state initialization) without requiring a
/// Tokio runtime.
pub struct DialogScheduler {
    /// Session this scheduler belongs to.
    session_id: String,
    /// Channel capacity.
    capacity: usize,
    /// Lazily initialized sender. `None` until first `enqueue()`.
    inner: TokioMutex<Option<SchedulerInner>>,
    /// Approximate pending count (best-effort; not a strong guarantee).
    pending: Arc<AtomicUsize>,
    /// Monotonic queue generation. Incrementing this invalidates messages
    /// enqueued under older generations without needing to recreate the worker.
    generation: Arc<AtomicU64>,
    /// Whether the worker is currently executing a message.
    processing: Arc<std::sync::atomic::AtomicBool>,
    client_message_ids: Arc<TokioMutex<HashSet<String>>>,
}

impl DialogScheduler {
    /// Create a new scheduler. The background worker is **not** started yet;
    /// it will be spawned lazily on the first call to `enqueue()`.
    ///
    /// `capacity` is the maximum number of queued-but-not-yet-started messages.
    /// Once full, `enqueue` returns an error so the caller can surface
    /// "session queue full" to the user.
    pub fn new(session_id: impl Into<String>, capacity: usize) -> Self {
        Self {
            session_id: session_id.into(),
            capacity,
            inner: TokioMutex::new(None),
            pending: Arc::new(AtomicUsize::new(0)),
            generation: Arc::new(AtomicU64::new(0)),
            processing: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            client_message_ids: Arc::new(TokioMutex::new(HashSet::new())),
        }
    }
    /// Ensure the worker is spawned and return a reference to the sender.
    async fn ensure_initialized(&self) -> mpsc::Sender<ScheduledMessage> {
        let mut guard = self.inner.lock().await;
        if let Some(inner) = guard.as_ref() {
            return inner.tx.clone();
        }

        // First enqueue — spawn the worker now
        let (tx, rx) = mpsc::channel::<ScheduledMessage>(self.capacity);

        let worker = WorkerTask {
            session_id: self.session_id.clone(),
            rx,
            pending: Arc::clone(&self.pending),
            generation: Arc::clone(&self.generation),
            processing: Arc::clone(&self.processing),
            client_message_ids: Arc::clone(&self.client_message_ids),
        };
        tokio::spawn(worker.run());

        info!(
            "[scheduler] Worker spawned for session={} (capacity={})",
            self.session_id, self.capacity
        );

        *guard = Some(SchedulerInner { tx: tx.clone() });
        tx
    }

    /// Enqueue a message for processing.
    ///
    /// Returns immediately with the queue position, or an error if the queue
    /// is full (`TrySendError::Full`) or closed (`TrySendError::Closed`).
    ///
    /// **Note**: This method is `async` because lazy initialization requires
    /// holding a lock to spawn the worker on first use.
    pub async fn enqueue(&self, mut msg: ScheduledMessage) -> Result<EnqueueResult, String> {
        let tx = self.ensure_initialized().await;

        let message_id = msg.message_id.clone();
        if let Some(client_message_id) = msg.client_message_id.as_ref() {
            let mut ids = self.client_message_ids.lock().await;
            if !ids.insert(client_message_id.clone()) {
                return Ok(EnqueueResult {
                    message_id,
                    queue_position: 0,
                    duplicate: true,
                });
            }
        }

        msg.generation = self.generation.load(Ordering::Acquire);
        let queue_position = self.pending.fetch_add(1, Ordering::Relaxed);

        match tx.try_send(msg) {
            Ok(()) => {
                let result = EnqueueResult {
                    message_id,
                    queue_position,
                    duplicate: false,
                };
                self.broadcast_queue_status();
                Ok(result)
            }
            Err(mpsc::error::TrySendError::Full(rejected)) => {
                self.pending.fetch_sub(1, Ordering::Relaxed);
                if let Some(client_message_id) = rejected.client_message_id.as_ref() {
                    self.client_message_ids
                        .lock()
                        .await
                        .remove(client_message_id);
                }
                Err(format!(
                    "Session queue is full — message rejected (content_len={})",
                    rejected.content.len()
                ))
            }
            Err(mpsc::error::TrySendError::Closed(rejected)) => {
                self.pending.fetch_sub(1, Ordering::Relaxed);
                if let Some(client_message_id) = rejected.client_message_id.as_ref() {
                    self.client_message_ids
                        .lock()
                        .await
                        .remove(client_message_id);
                }
                Err("Session scheduler has shut down".to_string())
            }
        }
    }

    /// Current number of pending messages (not including any running turn).
    pub fn pending_count(&self) -> usize {
        self.pending.load(Ordering::Relaxed)
    }

    /// Invalidate all queued messages that have not started yet.
    pub fn invalidate_pending(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.pending.store(0, Ordering::Release);
        if let Ok(mut ids) = self.client_message_ids.try_lock() {
            ids.clear();
        }
        // Lifecycle: every still-queued / optimistic intent for this
        // session walks to `stale`. The worker drops queued-but-stale
        // messages on its next `recv` (see WorkerTask::run); the durable
        // log here ensures the turn indexer also stops grouping events
        // under those ids.
        crate::foundation::session_bridge::mark_pending_turn_intents_stale(&self.session_id);
        self.broadcast_queue_status();
    }

    /// Whether a message is currently being executed.
    pub fn is_processing(&self) -> bool {
        self.processing.load(Ordering::Relaxed)
    }

    /// Snapshot of the current queue state.
    pub fn status(&self) -> QueueStatus {
        QueueStatus {
            session_id: self.session_id.clone(),
            pending_count: self.pending_count(),
            is_processing: self.is_processing(),
        }
    }

    fn broadcast_queue_status(&self) {
        broadcast_event(
            "agent:queue_status",
            serde_json::to_value(self.status()).expect("QueueStatus serialization is infallible"),
        );
    }
}

// ============================================
// Worker Task
// ============================================

struct WorkerTask {
    session_id: String,
    rx: mpsc::Receiver<ScheduledMessage>,
    pending: Arc<AtomicUsize>,
    generation: Arc<AtomicU64>,
    processing: Arc<std::sync::atomic::AtomicBool>,
    client_message_ids: Arc<TokioMutex<HashSet<String>>>,
}

impl WorkerTask {
    async fn run(mut self) {
        info!("[scheduler] Worker started for session {}", self.session_id);

        while let Some(msg) = self.rx.recv().await {
            let current_generation = self.generation.load(Ordering::Acquire);
            if msg.generation != current_generation {
                info!(
                    "[scheduler] Skipping stale message {} for session {} (message_generation={}, current_generation={})",
                    msg.message_id, self.session_id, msg.generation, current_generation
                );
                // Lifecycle: invalidate_pending may have already marked
                // this intent stale; double-write is harmless because
                // the state machine treats it as a same-state update.
                // Cover the case where invalidate_pending ran while this
                // particular message was already past the channel boundary.
                crate::foundation::session_bridge::update_turn_intent_status(
                    &self.session_id,
                    &msg.turn_intent_id,
                    crate::foundation::session_bridge::TurnIntentBridgeStatus::Stale,
                );
                if let Some(client_message_id) = msg.client_message_id.as_ref() {
                    self.client_message_ids
                        .lock()
                        .await
                        .remove(client_message_id);
                }
                self.broadcast_idle_status();
                continue;
            }

            let _ = self
                .pending
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                    count.checked_sub(1)
                });

            self.processing.store(true, Ordering::Relaxed);

            info!(
                "[scheduler] Processing message {} for session {}",
                msg.message_id, self.session_id
            );

            // Lifecycle: queued → running.
            crate::foundation::session_bridge::update_turn_intent_status(
                &self.session_id,
                &msg.turn_intent_id,
                crate::foundation::session_bridge::TurnIntentBridgeStatus::Running,
            );

            // Broadcast "now processing" status
            broadcast_event(
                "agent:queue_status",
                serde_json::json!({
                    "sessionId": self.session_id,
                    "pendingCount": self.pending.load(Ordering::Relaxed),
                    "isProcessing": true,
                    "currentMessageId": msg.message_id,
                }),
            );

            let client_message_id = msg.client_message_id.clone();
            let turn_intent_id = msg.turn_intent_id.clone();
            let execute_future = (msg.execute)();
            let result = std::panic::AssertUnwindSafe(execute_future)
                .catch_unwind()
                .await
                .unwrap_or_else(|panic_payload| {
                    let panic_message = panic_payload_to_string(panic_payload.as_ref());
                    error!(
                        "[scheduler] Turn executor panicked for session {} message {}: {}",
                        self.session_id, msg.message_id, panic_message
                    );
                    Err(format!(
                        "Turn executor panicked unexpectedly: {}",
                        panic_message
                    ))
                });

            match result {
                Ok(_content) => {
                    info!(
                        "[scheduler] Message {} completed for session {}",
                        msg.message_id, self.session_id
                    );
                    // Lifecycle: running → completed.
                    crate::foundation::session_bridge::update_turn_intent_status(
                        &self.session_id,
                        &turn_intent_id,
                        crate::foundation::session_bridge::TurnIntentBridgeStatus::Completed,
                    );
                    // agent:complete is already broadcast by processor; we
                    // only broadcast the updated queue status here.
                }
                Err(ref err) => {
                    warn!(
                        "[scheduler] Message {} failed for session {}: {}",
                        msg.message_id, self.session_id, err
                    );
                    // Lifecycle: running → failed. Cancelled turns walk
                    // here too (the executor returns Err on user stop); a
                    // future commit can distinguish via the cancel_flag
                    // probe if we need a separate `cancelled` bucket on
                    // the round renderer.
                    crate::foundation::session_bridge::update_turn_intent_status(
                        &self.session_id,
                        &turn_intent_id,
                        crate::foundation::session_bridge::TurnIntentBridgeStatus::Failed,
                    );
                    let error_code = classify_streaming_error_message(err);
                    let streaming_error = StreamingError::new(err.clone(), error_code)
                        .with_details(serde_json::json!({
                            "messageId": msg.message_id
                        }));
                    broadcast_agent_error_structured(&self.session_id, &streaming_error);
                }
            }

            if let Some(client_message_id) = client_message_id.as_ref() {
                self.client_message_ids
                    .lock()
                    .await
                    .remove(client_message_id);
            }
            self.processing.store(false, Ordering::Relaxed);
            self.broadcast_idle_status();
        }

        info!("[scheduler] Worker stopped for session {}", self.session_id);
    }

    fn broadcast_idle_status(&self) {
        broadcast_event(
            "agent:queue_status",
            serde_json::json!({
                "sessionId": self.session_id,
                "pendingCount": self.pending.load(Ordering::Relaxed),
                "isProcessing": false,
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn invalidated_pending_message_is_skipped() {
        let scheduler = DialogScheduler::new("session-a", 8);
        let release_running = Arc::new(tokio::sync::Notify::new());
        let running_released = Arc::clone(&release_running);
        let stale_executed = Arc::new(AtomicUsize::new(0));

        scheduler
            .enqueue(ScheduledMessage {
                message_id: "running-before-rewind".to_string(),
                generation: 0,
                client_message_id: None,
                turn_intent_id: String::new(),
                content: "running".to_string(),
                execute: Box::new(move || {
                    Box::pin(async move {
                        running_released.notified().await;
                        Ok("ran".to_string())
                    })
                }),
            })
            .await
            .expect("enqueue succeeds");

        let stale_executed_for_closure = Arc::clone(&stale_executed);
        scheduler
            .enqueue(ScheduledMessage {
                message_id: "queued-before-rewind".to_string(),
                generation: 0,
                client_message_id: None,
                turn_intent_id: String::new(),
                content: "stale".to_string(),
                execute: Box::new(move || {
                    Box::pin(async move {
                        stale_executed_for_closure.fetch_add(1, Ordering::SeqCst);
                        Ok("ran".to_string())
                    })
                }),
            })
            .await
            .expect("enqueue succeeds");

        scheduler.invalidate_pending();
        release_running.notify_one();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        assert_eq!(stale_executed.load(Ordering::SeqCst), 0);
        assert_eq!(scheduler.pending_count(), 0);
    }

    #[tokio::test]
    async fn duplicate_client_message_id_is_not_enqueued() {
        let scheduler = DialogScheduler::new("session-dedupe", 8);
        let release_running = Arc::new(tokio::sync::Notify::new());
        let running_released = Arc::clone(&release_running);

        let first = scheduler
            .enqueue(ScheduledMessage {
                message_id: "first".to_string(),
                generation: 0,
                client_message_id: Some("client-1".to_string()),
                turn_intent_id: String::new(),
                content: "running".to_string(),
                execute: Box::new(move || {
                    Box::pin(async move {
                        running_released.notified().await;
                        Ok("ran".to_string())
                    })
                }),
            })
            .await
            .expect("first enqueue succeeds");

        let second = scheduler
            .enqueue(ScheduledMessage {
                message_id: "second".to_string(),
                generation: 0,
                client_message_id: Some("client-1".to_string()),
                turn_intent_id: String::new(),
                content: "duplicate".to_string(),
                execute: Box::new(|| Box::pin(async { Ok("duplicate ran".to_string()) })),
            })
            .await
            .expect("duplicate enqueue returns idempotent success");

        assert!(!first.duplicate);
        assert!(second.duplicate);
        assert_eq!(second.message_id, "second");
        release_running.notify_one();
    }

    #[tokio::test]
    async fn message_after_invalidation_runs() {
        let scheduler = DialogScheduler::new("session-b", 8);
        let executed = Arc::new(AtomicUsize::new(0));

        scheduler.invalidate_pending();

        let executed_for_closure = Arc::clone(&executed);
        scheduler
            .enqueue(ScheduledMessage {
                message_id: "queued-after-rewind".to_string(),
                generation: 0,
                client_message_id: None,
                turn_intent_id: String::new(),
                content: "fresh".to_string(),
                execute: Box::new(move || {
                    Box::pin(async move {
                        executed_for_closure.fetch_add(1, Ordering::SeqCst);
                        Ok("ran".to_string())
                    })
                }),
            })
            .await
            .expect("enqueue succeeds");

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        assert_eq!(executed.load(Ordering::SeqCst), 1);
        assert_eq!(scheduler.pending_count(), 0);
    }
}
