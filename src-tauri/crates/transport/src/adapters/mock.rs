//! Mock transport adapter for testing
//!
//! Provides a test-friendly adapter that captures emitted events
//! for verification in unit tests.

#[cfg(test)]
use crate::traits::{AgentEvent, TextChunk, ToolEvent, TransportAdapter};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg(test)]
#[derive(Debug, Clone)]
pub struct EmittedEvent {
    pub event_name: String,
    pub payload: serde_json::Value,
    pub session_id: String,
}

#[cfg(test)]
#[derive(Debug)]
pub struct MockTransportAdapter {
    captured_events: Arc<Mutex<Vec<EmittedEvent>>>,
}

#[cfg(test)]
impl Default for MockTransportAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
impl MockTransportAdapter {
    pub fn new() -> Self {
        Self {
            captured_events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn get_captured_events(&self) -> Vec<EmittedEvent> {
        self.captured_events.lock().await.clone()
    }

    pub async fn clear_events(&self) {
        self.captured_events.lock().await.clear();
    }

    async fn capture_event(&self, event_name: &str, payload: serde_json::Value, session_id: &str) {
        let event = EmittedEvent {
            event_name: event_name.to_string(),
            payload,
            session_id: session_id.to_string(),
        };
        self.captured_events.lock().await.push(event);
    }
}

#[cfg(test)]
#[async_trait]
impl TransportAdapter for MockTransportAdapter {
    async fn emit_agent_event(&self, session_id: &str, event: AgentEvent) -> anyhow::Result<()> {
        let (event_name, payload) = match event {
            AgentEvent::SessionCreated {
                session_id: sid,
                session_name,
                agent_type,
                workspace_path,
            } => (
                "agent://session-created",
                serde_json::json!({
                    "sessionId": sid,
                    "sessionName": session_name,
                    "agentType": agent_type,
                    "workspacePath": workspace_path,
                }),
            ),
            AgentEvent::SessionDeleted { session_id: sid } => (
                "agent://session-deleted",
                serde_json::json!({
                    "sessionId": sid,
                }),
            ),
            AgentEvent::DialogTurnStarted {
                session_id: sid,
                turn_id,
                turn_index,
                user_input,
            } => (
                "agent://dialog-turn-started",
                serde_json::json!({
                    "sessionId": sid,
                    "turnId": turn_id,
                    "turnIndex": turn_index,
                    "userInput": user_input,
                }),
            ),
            AgentEvent::DialogTurnCompleted {
                session_id: sid,
                turn_id,
            } => (
                "agent://dialog-turn-completed",
                serde_json::json!({
                    "sessionId": sid,
                    "turnId": turn_id,
                }),
            ),
            AgentEvent::DialogTurnCancelled {
                session_id: sid,
                turn_id,
            } => (
                "agent://dialog-turn-cancelled",
                serde_json::json!({
                    "sessionId": sid,
                    "turnId": turn_id,
                }),
            ),
            AgentEvent::DialogTurnFailed {
                session_id: sid,
                turn_id,
                error,
            } => (
                "agent://dialog-turn-failed",
                serde_json::json!({
                    "sessionId": sid,
                    "turnId": turn_id,
                    "error": error,
                }),
            ),
            AgentEvent::TokenUsageUpdated {
                session_id: sid,
                turn_id,
                model_id,
                input_tokens,
                output_tokens,
                total_tokens,
            } => (
                "agent://token-usage-updated",
                serde_json::json!({
                    "sessionId": sid,
                    "turnId": turn_id,
                    "modelId": model_id,
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                    "totalTokens": total_tokens,
                }),
            ),
            AgentEvent::SessionStateChanged {
                session_id: sid,
                new_state,
            } => (
                "agent://session-state-changed",
                serde_json::json!({
                    "sessionId": sid,
                    "newState": new_state,
                }),
            ),
        };

        self.capture_event(event_name, payload, session_id).await;
        Ok(())
    }

    async fn emit_text_chunk(&self, session_id: &str, chunk: TextChunk) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "sessionId": chunk.session_id,
            "turnId": chunk.turn_id,
            "roundId": chunk.round_id,
            "text": chunk.text,
            "timestamp": chunk.timestamp,
            "contentType": chunk.content_type,
            "isComplete": chunk.is_complete,
        });

        self.capture_event("agent://text-chunk", payload, session_id)
            .await;
        Ok(())
    }

    async fn emit_tool_event(&self, session_id: &str, event: ToolEvent) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "sessionId": event.session_id,
            "turnId": event.turn_id,
            "toolEvent": {
                "tool_id": event.tool_id,
                "tool_name": event.tool_name,
                "event_type": event.event_type,
                "params": event.params,
                "result": event.result,
                "error": event.error,
                "duration_ms": event.duration_ms,
            }
        });

        self.capture_event("agent://tool-event", payload, session_id)
            .await;
        Ok(())
    }

    async fn emit_stream_start(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "roundId": round_id,
        });

        self.capture_event("agent://stream-start", payload, session_id)
            .await;
        Ok(())
    }

    async fn emit_stream_end(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        let payload = serde_json::json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "roundId": round_id,
        });

        self.capture_event("agent://stream-end", payload, session_id)
            .await;
        Ok(())
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        // For generic events, we don't know the session_id, so use empty string
        self.capture_event(event_name, payload, "").await;
        Ok(())
    }

    fn adapter_type(&self) -> &str {
        "mock"
    }
}
