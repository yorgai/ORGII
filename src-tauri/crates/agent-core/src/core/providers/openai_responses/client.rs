//! HTTP client for the OpenAI Responses API (public API).
//!
//! Sends requests to `api.openai.com/v1/responses` using standard Bearer
//! authentication. Supports `max_output_tokens` but NOT `temperature` for
//! reasoning models (GPT-5.4+, o1, o3, o4).

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;

use crate::providers::responses_common::{convert_messages, convert_tools, ResponsesRequest};
use crate::providers::traits::{ProviderConfig, ProviderError};
use crate::utils::build_http_client;

const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";

/// LLM client for OpenAI Responses API (GPT-5.4+ models).
///
/// Translates between the internal Chat Completions message format
/// (used by the agent loop) and the Responses API format.
pub struct OpenAIResponsesClient {
    pub(super) client: Client,
    pub(super) config: ProviderConfig,
    pub(super) default_model: String,
}

impl OpenAIResponsesClient {
    pub fn new(config: ProviderConfig, default_model: String) -> Self {
        let client = build_http_client(std::time::Duration::from_secs(300));

        Self {
            client,
            config,
            default_model,
        }
    }

    /// Build the responses endpoint URL.
    pub(super) fn responses_url(&self) -> String {
        let base = self.config.api_base.as_deref().unwrap_or(DEFAULT_API_BASE);
        format!("{}/responses", base.trim_end_matches('/'))
    }

    /// Build HTTP request with required headers.
    pub(super) fn build_request(
        &self,
        url: &str,
        body: &impl Serialize,
    ) -> Result<reqwest::RequestBuilder, ProviderError> {
        let mut req = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.config.api_key));

        for (key, value) in &self.config.extra_headers {
            req = req.header(key.as_str(), value.as_str());
        }

        Ok(req.json(body))
    }

    /// Build a ResponsesRequest from Chat Completions format inputs.
    ///
    /// MCP image sidecars on
    /// `role:"tool"` messages are *always* lifted into follow-up
    /// `user` items with `input_image` blocks. The Responses API
    /// family (GPT-5, GPT-5.4-*, o1/o3/o4) is uniformly vision-capable,
    /// and non-vision models returning 400 is strictly better than
    /// silently dropping image evidence.
    pub(crate) fn build_responses_request(
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        _temperature: f32,
        stream: bool,
    ) -> ResponsesRequest {
        let (instructions, input) = convert_messages(messages);
        let converted_tools = convert_tools(tools);

        ResponsesRequest {
            model: model.to_string(),
            input,
            instructions,
            tools: converted_tools,
            tool_choice: tools.map(|_| Value::String("auto".to_string())),
            max_output_tokens: Some(max_tokens),
            temperature: None,
            store: false,
            stream,
        }
    }

    /// Parse HTTP error response into ProviderError.
    pub(super) fn parse_error(status: u16, body: &str, retry_after: Option<u64>) -> ProviderError {
        match status {
            401 => ProviderError::AuthError(body.to_string()),
            429 => ProviderError::RateLimited {
                message: body.to_string(),
                retry_after_secs: retry_after,
            },
            404 => ProviderError::ModelNotFound(body.to_string()),
            _ => ProviderError::RequestFailed(format!("HTTP {}: {}", status, body)),
        }
    }
}
