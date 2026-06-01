//! Tauri transport adapter
//!
//! Uses Tauri's app.emit() system to send events to frontend.
//! Maintains compatibility with current implementation while providing
//! the abstraction layer for future extensibility.

use crate::traits::{AgentEvent, TextChunk, ToolEvent, TransportAdapter};
use async_trait::async_trait;
use log::debug;
use serde_json::json;
use std::fmt;
use tauri::{AppHandle, Emitter};

/// Tauri transport adapter - wraps AppHandle with unified interface
pub struct TauriTransportAdapter {
    app_handle: AppHandle,
}

impl TauriTransportAdapter {
    pub fn new(app_handle: AppHandle) -> Self {
        debug!("Creating TauriTransportAdapter");
        Self { app_handle }
    }
}

impl fmt::Debug for TauriTransportAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TauriTransportAdapter")
            .field("adapter_type", &"tauri")
            .finish()
    }
}

#[async_trait]
impl TransportAdapter for TauriTransportAdapter {
    async fn emit_agent_event(&self, _session_id: &str, event: AgentEvent) -> anyhow::Result<()> {
        match event {
            AgentEvent::SessionCreated {
                session_id,
                session_name,
                agent_type,
                workspace_path,
            } => {
                self.app_handle.emit(
                    "agent://session-created",
                    json!({
                        "sessionId": session_id,
                        "sessionName": session_name,
                        "agentType": agent_type,
                        "workspacePath": workspace_path,
                    }),
                )?;
            }
            AgentEvent::SessionDeleted { session_id } => {
                self.app_handle.emit(
                    "agent://session-deleted",
                    json!({
                        "sessionId": session_id,
                    }),
                )?;
            }
            AgentEvent::DialogTurnStarted {
                session_id,
                turn_id,
                turn_index,
                user_input,
            } => {
                self.app_handle.emit(
                    "agent://dialog-turn-started",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "turnIndex": turn_index,
                        "userInput": user_input,
                    }),
                )?;
            }
            AgentEvent::DialogTurnCompleted {
                session_id,
                turn_id,
            } => {
                self.app_handle.emit(
                    "agent://dialog-turn-completed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                    }),
                )?;
            }
            AgentEvent::DialogTurnCancelled {
                session_id,
                turn_id,
            } => {
                self.app_handle.emit(
                    "agent://dialog-turn-cancelled",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                    }),
                )?;
            }
            AgentEvent::DialogTurnFailed {
                session_id,
                turn_id,
                error,
            } => {
                self.app_handle.emit(
                    "agent://dialog-turn-failed",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "error": error,
                    }),
                )?;
            }
            AgentEvent::TokenUsageUpdated {
                session_id,
                turn_id,
                model_id,
                input_tokens,
                output_tokens,
                total_tokens,
            } => {
                self.app_handle.emit(
                    "agent://token-usage-updated",
                    json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "modelId": model_id,
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "totalTokens": total_tokens,
                    }),
                )?;
            }
            AgentEvent::SessionStateChanged {
                session_id,
                new_state,
            } => {
                self.app_handle.emit(
                    "agent://session-state-changed",
                    json!({
                        "sessionId": session_id,
                        "newState": new_state,
                    }),
                )?;
            }
        }
        Ok(())
    }

    async fn emit_text_chunk(&self, _session_id: &str, chunk: TextChunk) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agent://text-chunk",
            json!({
                "sessionId": chunk.session_id,
                "turnId": chunk.turn_id,
                "roundId": chunk.round_id,
                "text": chunk.text,
                "timestamp": chunk.timestamp,
                "contentType": chunk.content_type,
                "isComplete": chunk.is_complete,
            }),
        )?;
        Ok(())
    }

    async fn emit_tool_event(&self, _session_id: &str, event: ToolEvent) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agent://tool-event",
            json!({
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
            }),
        )?;
        Ok(())
    }

    async fn emit_stream_start(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agent://stream-start",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "roundId": round_id,
            }),
        )?;
        Ok(())
    }

    async fn emit_stream_end(
        &self,
        session_id: &str,
        turn_id: &str,
        round_id: &str,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(
            "agent://stream-end",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "roundId": round_id,
            }),
        )?;
        Ok(())
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.app_handle.emit(event_name, payload)?;
        Ok(())
    }

    fn adapter_type(&self) -> &str {
        "tauri"
    }
}
