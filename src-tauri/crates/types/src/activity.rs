//! The canonical `ActivityChunk` event the frontend's `normalizeChunk()`
//! converts into a `SessionEvent` for rendering.
//!
//! Lives here (not in `agent_sessions::cli::parsers::types`) so crates
//! that read or emit chunks — `dev_record`, `agent_sessions`,
//! event-pipeline ingestion, websocket broadcasters — don't have to
//! depend on each other or on the parent `app` crate just to type the
//! shape they pass through.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One activity chunk: a single tool call, assistant turn, or raw user
/// message, normalized to the wire format the frontend renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityChunk {
    pub chunk_id: String,
    pub session_id: String,
    pub action_type: String,
    pub function: String,
    pub args: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    /// When true, `emit_chunk` broadcasts via WS but skips DB persistence.
    /// Used for streaming deltas that are followed by a final flush chunk.
    #[serde(skip)]
    pub broadcast_only: bool,
}

impl ActivityChunk {
    /// Create a new chunk with auto-generated ID and current timestamp.
    pub fn new(session_id: &str, action_type: &str, function: &str) -> Self {
        Self {
            chunk_id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            action_type: action_type.to_string(),
            function: function.to_string(),
            args: serde_json::json!({}),
            result: serde_json::json!({}),
            created_at: chrono::Utc::now().to_rfc3339(),
            thread_id: None,
            process_id: None,
            broadcast_only: false,
        }
    }

    pub fn with_args(mut self, args: serde_json::Value) -> Self {
        self.args = args;
        self
    }

    pub fn with_result(mut self, result: serde_json::Value) -> Self {
        self.result = result;
        self
    }

    pub fn with_thread_id(mut self, thread_id: impl Into<String>) -> Self {
        self.thread_id = Some(thread_id.into());
        self
    }
}
