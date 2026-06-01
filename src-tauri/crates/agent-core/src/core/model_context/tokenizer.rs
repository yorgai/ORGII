//! Reusable token-counting service backed by tiktoken BPE encoders.
//!
//! Provides accurate token counts instead of the `len / 4` heuristic.
//! Encoders are lazily initialized and cached for the process lifetime.
//!
//! # Usage
//!
//! ```ignore
//! use crate::model_context::tokenizer;
//!
//! let count = tokenizer::count_tokens("Hello, world!");
//! let count = tokenizer::count_tokens_for_model("Hello", "gpt-4o");
//! let count = tokenizer::count_message_tokens(&msg);
//! ```

#[cfg(test)]
#[path = "tests/tokenizer_tests.rs"]
mod tests;

use serde_json::Value;
use std::sync::LazyLock;
use tiktoken_rs::CoreBPE;

/// cl100k_base — GPT-4, GPT-3.5-turbo, Claude (approximate), most models.
static CL100K: LazyLock<CoreBPE> =
    LazyLock::new(|| tiktoken_rs::cl100k_base().expect("failed to load cl100k_base encoding"));

/// o200k_base — GPT-4o, o1, o3, o4, GPT-5+.
static O200K: LazyLock<CoreBPE> =
    LazyLock::new(|| tiktoken_rs::o200k_base().expect("failed to load o200k_base encoding"));

/// Texts longer than this are sampled rather than fully tokenized.
/// BPE on a 100K-char string takes ~25ms; above this we sample + extrapolate.
pub(crate) const SAMPLE_THRESHOLD: usize = 50_000;

/// Number of characters to sample from the beginning of large texts.
const SAMPLE_SIZE: usize = 8_000;

/// Select the appropriate BPE encoder for a model name.
fn encoder_for_model(model: &str) -> &'static CoreBPE {
    let lower = model.to_lowercase();
    if lower.starts_with("gpt-4o")
        || lower.starts_with("gpt-5")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
        || lower.contains("4o")
    {
        &O200K
    } else {
        &CL100K
    }
}

/// Count tokens using the given encoder, with sampling for large texts.
fn count_with_encoder(text: &str, encoder: &CoreBPE) -> usize {
    if text.is_empty() {
        return 0;
    }
    if text.len() <= SAMPLE_THRESHOLD {
        return encoder.encode_ordinary(text).len();
    }
    // Sample the beginning and extrapolate based on char-to-token ratio.
    let sample_end = text
        .char_indices()
        .nth(SAMPLE_SIZE)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len());
    let sample = &text[..sample_end];
    let sample_tokens = encoder.encode_ordinary(sample).len();
    let ratio = sample_tokens as f64 / sample.len() as f64;
    (text.len() as f64 * ratio).ceil() as usize
}

/// Count tokens in a string using cl100k_base (good default for most models).
pub fn count_tokens(text: &str) -> usize {
    count_with_encoder(text, &CL100K)
}

/// Count tokens using the most appropriate encoder for a given model.
pub fn count_tokens_for_model(text: &str, model: &str) -> usize {
    count_with_encoder(text, encoder_for_model(model))
}

fn count_content_tokens(content: &Value) -> usize {
    if let Some(text) = content.as_str() {
        return count_tokens(text);
    }

    content
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .map(|block| {
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .map(count_tokens)
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0)
}

/// Per-message overhead: every message has role, separators, etc.
pub(crate) const MESSAGE_OVERHEAD_TOKENS: usize = 4;

/// Count tokens in an OpenAI-format message (content + tool_calls + reasoning).
pub fn count_message_tokens(msg: &Value) -> usize {
    let content_tokens = msg.get("content").map(count_content_tokens).unwrap_or(0);

    let reasoning_tokens = msg
        .get("reasoning_content")
        .and_then(|val| val.as_str())
        .map(count_tokens)
        .unwrap_or(0);

    let tool_calls_tokens = msg
        .get("tool_calls")
        .and_then(|tc| tc.as_array())
        .map(|arr| {
            arr.iter()
                .map(|tc| {
                    let name_tokens = tc
                        .get("function")
                        .and_then(|func| func.get("name"))
                        .and_then(|name| name.as_str())
                        .map(count_tokens)
                        .unwrap_or(0);
                    let args_tokens = tc
                        .get("function")
                        .and_then(|func| func.get("arguments"))
                        .and_then(|args| args.as_str())
                        .map(count_tokens)
                        .unwrap_or(0);
                    name_tokens + args_tokens
                })
                .sum::<usize>()
        })
        .unwrap_or(0);

    content_tokens + reasoning_tokens + tool_calls_tokens + MESSAGE_OVERHEAD_TOKENS
}

/// Count total tokens across a list of messages.
pub fn count_messages_tokens(messages: &[Value]) -> usize {
    messages.iter().map(count_message_tokens).sum()
}
