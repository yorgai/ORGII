//! `LLMProvider` impl for OpenAI-compatible chat completions.
//!
//! The trait `impl` block lives here and delegates to free functions in
//! the per-concern submodules below. Splitting the file by responsibility
//! (each submodule under ~500 lines) keeps the streaming SSE pipeline
//! readable while preserving the public surface area:
//!
//! - [`parse`] — accumulator parser + structured failure variant +
//!   the `STREAM_PARSE_ERROR_KEY` constant (re-exported below).
//! - [`index_resolver`] — slot allocation for `tool_calls[].index`,
//!   defending against providers that drop `index` on follow-up chunks.
//! - [`error_classify`] — heuristic root-cause labels for parse failures
//!   plus overload / `Retry-After` detectors used by the SSE assembly.
//! - [`chat`] — non-streaming `chat()` body.
//! - [`sse_stream`] — streaming `chat_streaming()` body.

mod chat;
mod error_classify;
mod index_resolver;
mod parse;
mod sse_stream;
mod think_split;

// Re-export the public constant used by `turn_executor::tool_execution::*`
// (via `openai_compat::STREAM_PARSE_ERROR_KEY`) to detect the synthetic
// parse-error tool args and convert them into an inline `tool_result`
// the model understands. Keep this `pub` — external callers depend on it.
pub use parse::STREAM_PARSE_ERROR_KEY;

use async_trait::async_trait;
use serde_json::Value;

use super::client::OpenAICompatClient;
use crate::providers::traits::{LLMProvider, LLMResponse, ProviderError, StreamDelta};

#[async_trait]
impl LLMProvider for OpenAICompatClient {
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        chat::run_chat(self, messages, tools, model, max_tokens, temperature).await
    }

    async fn chat_streaming(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
        on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
        cancel_flag: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<LLMResponse, ProviderError> {
        sse_stream::run_chat_streaming(
            self,
            messages,
            tools,
            model,
            max_tokens,
            temperature,
            on_delta,
            cancel_flag,
        )
        .await
    }

    fn default_model(&self) -> &str {
        &self.default_model
    }

    fn provider_name(&self) -> &str {
        self.provider_spec.name
    }

    // Image handling: `expand_tool_images_for_openai_wire` is called
    // unconditionally on every send path. We always expand MCP image
    // sidecars onto the wire and let the API respond with 400 if the
    // resolved model can't accept images. Silently dropping images on
    // proxies / custom deployment names is strictly worse than a loud
    // failure.
}
