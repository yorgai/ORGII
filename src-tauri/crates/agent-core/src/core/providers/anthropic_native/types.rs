//! Anthropic Messages API request/response types
//!
//! Covers: `MessagesRequest`, `Message`, `ContentBlock`, `ToolDefinition`,
//! streaming event types (`MessageStart`, `ContentBlockDelta`, `MessageStop`),
//! and `ApiErrorResponse`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request body for Anthropic Messages API.
#[derive(Debug, Serialize)]
pub(super) struct MessagesRequest {
    pub model: String,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<Value>,
    pub messages: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// Response from Anthropic Messages API.
#[derive(Debug, Deserialize)]
pub(super) struct MessagesResponse {
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<AnthropicUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub(super) enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename = "thinking")]
    Thinking {
        #[serde(default)]
        thinking: Option<String>,
        #[serde(default)]
        signature: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
pub(super) struct AnthropicUsage {
    #[serde(default)]
    pub input_tokens: i64,
    #[serde(default)]
    pub output_tokens: i64,
    #[serde(default)]
    pub cache_creation_input_tokens: i64,
    #[serde(default)]
    pub cache_read_input_tokens: i64,
}

/// SSE event types for Anthropic streaming.
///
/// Distinct from
/// [`crate::core::providers::responses_common::types::StreamEvent`]
/// (a `pub` struct on the OpenAI Responses SSE shape). This enum is
/// intentionally `pub(super)` so the bare name only collides under glob
/// imports, not in normal module-qualified use.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub(super) enum StreamEvent {
    #[serde(rename = "message_start")]
    MessageStart {
        #[serde(default)]
        message: Option<Value>,
    },
    #[serde(rename = "content_block_start")]
    ContentBlockStart { index: usize, content_block: Value },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { index: usize, delta: Value },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop {
        /// Content block index from the Anthropic API.
        /// Required for complete deserialization; not used directly in our code.
        #[serde(default)]
        #[allow(unused)]
        index: Option<usize>,
    },
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: Value,
        #[serde(default)]
        usage: Option<AnthropicUsage>,
    },
    #[serde(rename = "message_stop")]
    MessageStop {},
    #[serde(rename = "ping")]
    Ping {},
    #[serde(rename = "error")]
    Error { error: Value },
}

/// Error response from the Anthropic Messages API.
///
/// Distinct from the OpenAI-compat `ApiErrorResponse` in
/// `super::super::openai_compat::types`. Both are intentionally
/// module-private (`pub(super)`) — the bare name only collides if
/// you import via globs or follow a Go-To-Definition that then
/// shows multiple matches; in normal use the type stays scoped to
/// the Anthropic provider.
#[derive(Debug, Deserialize)]
pub(super) struct ApiErrorResponse {
    pub error: Option<ApiError>,
}

/// Anthropic-shaped error body — `{type, message}`.
///
/// See `super::super::openai_compat::types::ApiError` for the
/// OpenAI/Gemini variant which carries `status` + `code` instead.
#[derive(Debug, Deserialize)]
pub(super) struct ApiError {
    #[serde(rename = "type")]
    pub _type: Option<String>,
    pub message: Option<String>,
}
