//! Transport Emitter - Global event emission service
//!
//! Provides a global, injectable event emitter that can be used throughout
//! the application. Services receive this via dependency injection rather
//! than directly using AppHandle.

use crate::traits::{AgentEvent, TextChunk, ToolEvent, TransportAdapter};
use std::sync::Arc;

/// Global transport emitter - wraps any TransportAdapter
pub struct TransportEmitter {
    adapter: Arc<dyn TransportAdapter>,
}

impl TransportEmitter {
    pub fn new(adapter: Arc<dyn TransportAdapter>) -> Self {
        Self { adapter }
    }

    /// Emit agent event
    pub async fn emit_agent_event(
        &self,
        session_id: &str,
        event: AgentEvent,
    ) -> anyhow::Result<()> {
        self.adapter.emit_agent_event(session_id, event).await
    }

    /// Emit text chunk for streaming
    pub async fn emit_text_chunk(&self, session_id: &str, chunk: TextChunk) -> anyhow::Result<()> {
        self.adapter.emit_text_chunk(session_id, chunk).await
    }

    /// Emit tool event
    pub async fn emit_tool_event(&self, session_id: &str, event: ToolEvent) -> anyhow::Result<()> {
        self.adapter.emit_tool_event(session_id, event).await
    }

    /// Emit stream start
    pub async fn emit_stream_start(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.adapter
            .emit_stream_start(session_id, turn_id, round_id)
            .await
    }

    /// Emit stream end
    pub async fn emit_stream_end(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.adapter
            .emit_stream_end(session_id, turn_id, round_id)
            .await
    }

    /// Emit generic event
    pub async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.adapter.emit_generic(event_name, payload).await
    }

    /// Get adapter type for debugging
    pub fn adapter_type(&self) -> &str {
        self.adapter.adapter_type()
    }
}

impl std::fmt::Debug for TransportEmitter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TransportEmitter")
            .field("adapter_type", &self.adapter.adapter_type())
            .finish()
    }
}

// Global singleton for dependency injection
use std::sync::OnceLock;
static GLOBAL_TRANSPORT_EMITTER: OnceLock<Arc<TransportEmitter>> = OnceLock::new();

/// Set global transport emitter (called once at app startup)
pub fn set_global_transport_emitter(
    emitter: Arc<TransportEmitter>,
) -> Result<(), Arc<TransportEmitter>> {
    GLOBAL_TRANSPORT_EMITTER.set(emitter)
}

/// Get global transport emitter
pub fn get_global_transport_emitter() -> Option<Arc<TransportEmitter>> {
    GLOBAL_TRANSPORT_EMITTER.get().cloned()
}

/// Get global transport emitter or panic
pub fn get_global_transport_emitter_or_panic() -> Arc<TransportEmitter> {
    get_global_transport_emitter().expect(
        "Global transport emitter not initialized. Call set_global_transport_emitter() at startup.",
    )
}
