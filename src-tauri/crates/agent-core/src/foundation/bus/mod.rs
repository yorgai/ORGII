//! Generic async message bus for decoupled communication.
//!
//! Uses tokio channels: `mpsc` for inbound (many-to-one) and
//! `broadcast` for outbound (one-to-many).
//!
//! This is a generic version — each agent defines its own message types.
//! The `events` submodule defines the concrete event types used by agent sessions.

pub mod event_pipeline_bridge;
pub mod events;

pub use events::{InboundMessage, OutboundMessage};

use std::sync::OnceLock;
use tokio::sync::{broadcast, mpsc};
use tracing::info;

/// Inversion-of-control slot for the frontend WebSocket / IPC broadcast.
///
/// The actual broadcaster lives in `api::websocket_handler` (the `app` layer).
/// We register a function pointer at startup so this module — and any future
/// extracted `agent-core` crate — has no compile-time back-edge into `app`.
type BroadcastFn = fn(String);
static BROADCAST: OnceLock<BroadcastFn> = OnceLock::new();

/// Inversion-of-control slot for "is at least one frontend subscriber connected?".
///
/// Same rationale as [`BROADCAST`]: avoids `agent_core` reaching into
/// `api::websocket_handler` for subscriber counting.
type SubscriberCountFn = fn() -> usize;
static SUBSCRIBER_COUNT: OnceLock<SubscriberCountFn> = OnceLock::new();

/// Register the broadcast function pointer. Idempotent: subsequent calls are
/// silently ignored, which keeps tests safe across re-entry.
pub fn register_broadcast(broadcast_fn: BroadcastFn) {
    let _ = BROADCAST.set(broadcast_fn);
}

/// Register the frontend subscriber-count function pointer. Idempotent.
pub fn register_subscriber_count(subscriber_count_fn: SubscriberCountFn) {
    let _ = SUBSCRIBER_COUNT.set(subscriber_count_fn);
}

/// Read the current frontend subscriber count via the registered slot.
///
/// Returns `0` when the slot is unset (e.g. unit tests that exercise
/// `agent_core` without bringing up the IDE WebSocket layer), which matches
/// "no frontends connected" — the safe default for dispatch fallbacks.
pub fn frontend_subscriber_count() -> usize {
    SUBSCRIBER_COUNT.get().map(|f| f()).unwrap_or(0)
}

/// Agent-scoped message bus type alias.
pub type AgentMessageBus = MessageBus<InboundMessage, OutboundMessage>;

/// Default capacity for the inbound message queue.
const INBOUND_CAPACITY: usize = 256;

/// Default capacity for the outbound broadcast channel.
const OUTBOUND_CAPACITY: usize = 1000;

/// Generic async message bus that decouples message producers from consumers.
///
/// `I` = inbound message type, `O` = outbound message type.
pub struct MessageBus<I, O>
where
    I: Send + 'static,
    O: Clone + Send + 'static,
{
    /// Sender for inbound messages (cloneable, given to producers).
    inbound_tx: mpsc::Sender<I>,
    /// Receiver for inbound messages (consumed by the processing loop).
    inbound_rx: mpsc::Receiver<I>,
    /// Sender for outbound messages (kept by the processing loop).
    outbound_tx: broadcast::Sender<O>,
}

impl<I, O> MessageBus<I, O>
where
    I: Send + 'static,
    O: Clone + Send + 'static,
{
    /// Create a new message bus.
    pub fn new() -> Self {
        let (inbound_tx, inbound_rx) = mpsc::channel(INBOUND_CAPACITY);
        let (outbound_tx, _) = broadcast::channel(OUTBOUND_CAPACITY);

        Self {
            inbound_tx,
            inbound_rx,
            outbound_tx,
        }
    }

    /// Get a sender for publishing inbound messages.
    pub fn inbound_sender(&self) -> mpsc::Sender<I> {
        self.inbound_tx.clone()
    }

    /// Receive the next inbound message (blocks until available).
    pub async fn recv_inbound(&mut self) -> Option<I> {
        self.inbound_rx.recv().await
    }

    /// Try to receive an inbound message with a timeout.
    pub async fn recv_inbound_timeout(&mut self, timeout: std::time::Duration) -> Option<I> {
        tokio::time::timeout(timeout, self.inbound_rx.recv())
            .await
            .unwrap_or_default()
    }

    /// Publish an outbound message to all subscribers.
    pub fn publish_outbound(&self, msg: O) {
        if let Err(err) = self.outbound_tx.send(msg) {
            info!("No outbound subscribers ({})", err);
        }
    }

    /// Subscribe to outbound messages.
    pub fn subscribe_outbound(&self) -> broadcast::Receiver<O> {
        self.outbound_tx.subscribe()
    }
}

/// Broadcast a typed payload as a JSON `{ type, payload }` event.
///
/// Dispatched to the per-session Tauri IPC Channel registry (the primary
/// consumer for local sessions) and, as a tee, to any connected debug
/// WebSocket clients. See `api::websocket_handler::broadcast` for details.
///
/// Shared helper used by processor, task runner, and subagent spawner.
pub fn broadcast_event<T: serde::Serialize>(event_type: &'static str, payload: T) {
    #[derive(serde::Serialize)]
    struct EventEnvelope<T: serde::Serialize> {
        r#type: &'static str,
        payload: T,
    }
    match serde_json::to_string(&EventEnvelope {
        r#type: event_type,
        payload,
    }) {
        Ok(msg) => match BROADCAST.get() {
            Some(broadcast_fn) => broadcast_fn(msg),
            None => tracing::warn!("[bus] broadcast handler not registered; dropping event"),
        },
        Err(err) => tracing::warn!("Failed to serialize agent event: {}", err),
    }
}

impl<I, O> Default for MessageBus<I, O>
where
    I: Send + 'static,
    O: Clone + Send + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}
