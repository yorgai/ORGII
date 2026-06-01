//! Side query: lightweight, non-streaming LLM call for auxiliary tasks.
//!
//! Used when the agent needs an LLM answer outside the main turn loop
//! (classification, summarization, labeling, etc.). Separate from the
//! conversation context — no tool execution, no streaming, tokens are
//! not counted toward the session cost.
//!
//! Ref: claude_code/utils/sideQuery.ts

use serde_json::Value;
use tracing::info;

use crate::providers::traits::{LLMProvider, ProviderError};

/// Configuration for a side query call.
pub struct SideQueryConfig {
    /// Model to use. `None` = use the caller-supplied default.
    pub model: Option<String>,
    /// Maximum tokens in the response (default: 1024).
    pub max_tokens: u32,
    /// Sampling temperature (default: 0.0 for deterministic output).
    pub temperature: f32,
    /// Optional system prompt prepended as a system message.
    pub system_prompt: Option<String>,
}

impl Default for SideQueryConfig {
    fn default() -> Self {
        Self {
            model: None,
            max_tokens: 1024,
            temperature: 0.0,
            system_prompt: None,
        }
    }
}

/// Result of a side query call.
#[derive(Debug)]
pub struct SideQueryResult {
    /// The text content returned by the LLM.
    pub content: String,
    /// Prompt tokens used by this call.
    pub prompt_tokens: i64,
    /// Completion tokens used by this call.
    pub completion_tokens: i64,
}

#[derive(Debug)]
pub enum SideQueryError {
    Provider(ProviderError),
    EmptyContent,
}

impl std::fmt::Display for SideQueryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Provider(err) => write!(formatter, "Side query failed: {err}"),
            Self::EmptyContent => write!(formatter, "Side query returned empty content"),
        }
    }
}

impl std::error::Error for SideQueryError {}

/// Execute a one-shot, non-streaming LLM call outside the main turn loop.
///
/// - No tool definitions are sent.
/// - Tokens are NOT counted toward the session's running total.
/// - Uses `provider.chat()` (non-streaming) for simplicity and speed.
///
/// # Arguments
///
/// * `provider` — LLM provider (gets retry/backoff via `ReliableProvider`).
/// * `user_messages` — Messages to send (typically 1 user message).
/// * `config` — Model, max_tokens, temperature, optional system prompt.
/// * `default_model` — Fallback model when `config.model` is `None`.
pub async fn side_query(
    provider: &dyn LLMProvider,
    user_messages: &[Value],
    config: &SideQueryConfig,
    default_model: &str,
) -> Result<SideQueryResult, String> {
    side_query_typed(provider, user_messages, config, default_model)
        .await
        .map_err(|err| err.to_string())
}

pub async fn side_query_typed(
    provider: &dyn LLMProvider,
    user_messages: &[Value],
    config: &SideQueryConfig,
    default_model: &str,
) -> Result<SideQueryResult, SideQueryError> {
    let model = config.model.as_deref().unwrap_or(default_model);

    let mut messages: Vec<Value> = Vec::with_capacity(user_messages.len() + 1);

    if let Some(ref system) = config.system_prompt {
        messages.push(serde_json::json!({
            "role": "system",
            "content": system,
        }));
    }

    messages.extend_from_slice(user_messages);

    info!(
        "[side-query] model={}, max_tokens={}, temp={}, messages={}",
        model,
        config.max_tokens,
        config.temperature,
        messages.len()
    );

    let response = provider
        .chat(
            &messages,
            None,
            model,
            config.max_tokens,
            config.temperature,
        )
        .await
        .map_err(SideQueryError::Provider)?;

    let content = response.content.ok_or(SideQueryError::EmptyContent)?;

    let prompt_tokens = response.usage.get("prompt_tokens").copied().unwrap_or(0);
    let completion_tokens = response
        .usage
        .get("completion_tokens")
        .copied()
        .unwrap_or(0);

    info!(
        "[side-query] Done: {} chars, prompt={}, completion={}",
        content.len(),
        prompt_tokens,
        completion_tokens
    );

    Ok(SideQueryResult {
        content,
        prompt_tokens,
        completion_tokens,
    })
}

#[cfg(test)]
#[path = "tests/side_query_tests.rs"]
mod tests;
