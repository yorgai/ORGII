//! OpenAI-compatible chat completions API types
//!
//! Covers: `ChatRequest`, `ChatMessage`, `ToolDefinition`, `ToolCallResponse`,
//! streaming delta types, and `ApiErrorResponse`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request body for OpenAI-compatible chat completions.
#[derive(Debug, Serialize)]
pub(super) struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<Value>,
    /// Chat Completions token-limit parameter used by most providers and older OpenAI models.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Required by OpenAI GPT-5+, o1, o3, o4 models (replaces max_tokens).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub stream: bool,
    /// Required for OpenAI-compatible streaming to include usage in the final chunk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<Value>,
}

/// Initial Chat Completions token-limit field hint from the model alias.
///
/// This is not authoritative. Custom relays can name models arbitrarily, so
/// `openai_policy` can override this hint after structured protocol errors.
pub(crate) fn chat_token_limit_field_hint(
    model: &str,
) -> crate::providers::openai_policy::ChatTokenLimitField {
    let model_lower = model.to_lowercase();
    if model_lower.starts_with("gpt-5")
        || model_lower.starts_with("o1")
        || model_lower.starts_with("o3")
        || model_lower.starts_with("o4")
        || model_lower.starts_with("o5")
    {
        crate::providers::openai_policy::ChatTokenLimitField::MaxCompletionTokens
    } else {
        crate::providers::openai_policy::ChatTokenLimitField::MaxTokens
    }
}

/// SSE streaming chunk from OpenAI-compatible APIs.
#[derive(Debug, Deserialize)]
pub(super) struct StreamChunk {
    pub choices: Vec<StreamChoice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamChoice {
    pub delta: StreamDeltaResponse,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamDeltaResponse {
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<StreamToolCallDelta>>,
    pub reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamToolCallDelta {
    pub index: Option<usize>,
    pub id: Option<String>,
    pub function: Option<StreamFunctionDelta>,
    /// Gemini returns thought_signature inside extra_content.google.thought_signature
    pub extra_content: Option<ExtraContent>,
}

/// Gemini-specific extra content on tool calls (OpenAI-compat format).
#[derive(Debug, Deserialize)]
pub(super) struct ExtraContent {
    google: Option<GoogleExtra>,
}

#[derive(Debug, Deserialize)]
struct GoogleExtra {
    thought_signature: Option<Value>,
}

impl ExtraContent {
    pub fn thought_signature(&self) -> Option<&Value> {
        self.google.as_ref()?.thought_signature.as_ref()
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct StreamFunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

/// Response from OpenAI-compatible chat completions.
#[derive(Debug, Deserialize)]
pub(super) struct ChatCompletionResponse {
    pub choices: Vec<Choice>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub(super) struct Choice {
    pub message: MessageResponse,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct MessageResponse {
    pub content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCallResponse>>,
    /// Reasoning/thinking content (DeepSeek-R1, Kimi k1.5, etc.)
    pub reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ToolCallResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub _type: Option<String>,
    pub function: FunctionCallResponse,
    pub extra_content: Option<ExtraContent>,
}

#[derive(Debug, Deserialize)]
pub(super) struct FunctionCallResponse {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct Usage {
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub total_tokens: i64,
}

/// Error response from the API.
/// Handles both OpenAI format (`{ "error": { "message": "..." } }`)
/// and Google Gemini format (`{ "error": { "message": "...", "status": "RESOURCE_EXHAUSTED", "code": 429 } }`).
///
/// Distinct from `super::super::anthropic_native::types::ApiErrorResponse`,
/// which decodes the Anthropic Messages API error envelope (`{type,
/// message}`). Both stay `pub(super)` so the names cannot collide in
/// downstream call sites.
#[derive(Debug, Deserialize)]
pub(super) struct ApiErrorResponse {
    pub error: Option<ApiError>,
}

/// OpenAI/Gemini-shaped error body — `{message, status, code}`.
///
/// See `super::super::anthropic_native::types::ApiError` for the
/// Anthropic variant which carries `type` + `message` only.
#[derive(Debug, Deserialize)]
pub(super) struct ApiError {
    pub message: Option<String>,
    /// Google-style status string (e.g. "RESOURCE_EXHAUSTED", "NOT_FOUND")
    pub status: Option<String>,
    /// Google-style numeric error code
    pub code: Option<i32>,
}

impl ApiError {
    /// Extract the best available error message, falling back to status/code.
    pub fn best_message(&self) -> String {
        if let Some(ref msg) = self.message {
            if !msg.is_empty() {
                return msg.clone();
            }
        }
        if let Some(ref status) = self.status {
            if let Some(code) = self.code {
                return format!("{} (code {})", status, code);
            }
            return status.clone();
        }
        if let Some(code) = self.code {
            return format!("Error code {}", code);
        }
        "Unknown error".to_string()
    }
}

/// Helper trait extension for reqwest to add bearer token auth.
pub(super) trait RequestBuilderExt {
    fn bearer_token(self, token: &str) -> Self;
}

impl RequestBuilderExt for reqwest::RequestBuilder {
    fn bearer_token(self, token: &str) -> Self {
        self.header("Authorization", format!("Bearer {}", token))
    }
}
