//! Token-usage extraction for the Anthropic Messages API.
//!
//! Anthropic emits usage in two places:
//!   - non-streaming: a single `usage` object on `MessagesResponse`.
//!   - streaming: split across `MessageStart` (input + cache) and
//!     `MessageDelta` (output), with the totals computed on the client.
//!
//! Both paths funnel into the same `HashMap<String, i64>` keyed by the
//! `usage_key` constants so the turn executor's `UsageTotals::accumulate`
//! sees the same shape regardless of which code path produced the usage.

use std::collections::HashMap;

use serde_json::Value;
use tracing::debug;

use super::types::{AnthropicUsage, MessagesResponse};
use crate::providers::usage_key;

/// Build the unified usage map from a non-streaming `MessagesResponse`.
///
/// Cache fields are only inserted when non-zero — this matches the original
/// behaviour and keeps unset fields out of the downstream sum (the executor
/// distinguishes "missing" from "zero" for billing display).
pub(super) fn from_non_streaming(parsed: &MessagesResponse) -> HashMap<String, i64> {
    let mut usage = HashMap::new();
    let Some(ref api_usage) = parsed.usage else {
        return usage;
    };
    usage.insert(usage_key::PROMPT_TOKENS.to_string(), api_usage.input_tokens);
    usage.insert(
        usage_key::COMPLETION_TOKENS.to_string(),
        api_usage.output_tokens,
    );
    usage.insert(
        usage_key::TOTAL_TOKENS.to_string(),
        api_usage.input_tokens + api_usage.output_tokens,
    );
    if api_usage.cache_read_input_tokens > 0 {
        usage.insert(
            usage_key::CACHE_READ_TOKENS.to_string(),
            api_usage.cache_read_input_tokens,
        );
    }
    if api_usage.cache_creation_input_tokens > 0 {
        usage.insert(
            usage_key::CACHE_WRITE_TOKENS.to_string(),
            api_usage.cache_creation_input_tokens,
        );
    }
    usage
}

/// Pull `input_tokens` + cache counters out of a `MessageStart` event's
/// `message.usage` object and merge them into the running streaming usage map.
///
/// Anthropic emits these *once* at the start of a stream — they are the
/// authoritative input/cache numbers for the request. Output tokens come
/// later from `MessageDelta`.
pub(super) fn merge_message_start(usage: &mut HashMap<String, i64>, message: Option<&Value>) {
    let Some(msg) = message else {
        debug!("[streaming-usage] Anthropic MessageStart: no message field");
        return;
    };
    let Some(api_usage) = msg.get("usage") else {
        debug!("[streaming-usage] Anthropic MessageStart: no usage in message");
        return;
    };

    if let Some(input) = api_usage.get("input_tokens").and_then(Value::as_i64) {
        debug!("[streaming-usage] MessageStart input_tokens={}", input);
        usage.insert(usage_key::PROMPT_TOKENS.to_string(), input);
    }
    if let Some(cache_read) = api_usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_i64)
    {
        if cache_read > 0 {
            debug!("[streaming-usage] cache_read_input_tokens={}", cache_read);
            usage.insert(usage_key::CACHE_READ_TOKENS.to_string(), cache_read);
        }
    }
    if let Some(cache_create) = api_usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_i64)
    {
        if cache_create > 0 {
            debug!(
                "[streaming-usage] cache_creation_input_tokens={}",
                cache_create
            );
            usage.insert(usage_key::CACHE_WRITE_TOKENS.to_string(), cache_create);
        }
    }
}

/// Apply the output_tokens count from a `MessageDelta` event's `usage` field.
///
/// Anthropic emits this on every delta (cumulative) — the turn executor
/// only needs the final value, but recording the latest one keeps the map
/// in sync with the protocol semantics.
pub(super) fn merge_message_delta_output(
    usage: &mut HashMap<String, i64>,
    delta_usage: Option<&AnthropicUsage>,
) {
    let Some(api_usage) = delta_usage else {
        debug!("[streaming-usage] Anthropic MessageDelta: no usage field");
        return;
    };
    debug!(
        "[streaming-usage] Anthropic MessageDelta usage: output_tokens={}",
        api_usage.output_tokens
    );
    usage.insert(
        usage_key::COMPLETION_TOKENS.to_string(),
        api_usage.output_tokens,
    );
}

/// Compute and store the total once both prompt + completion are present.
///
/// Called at end-of-stream so the final delta sent to the client carries
/// a fully-populated usage map. If either side is missing (e.g. stream
/// truncation before MessageStart's usage) the total is left unset rather
/// than written as a wrong value — downstream consumers detect "no total"
/// by absence and fall back to summing what they have.
pub(super) fn finalize_total(usage: &mut HashMap<String, i64>) {
    if let (Some(&prompt), Some(&completion)) = (
        usage.get(usage_key::PROMPT_TOKENS),
        usage.get(usage_key::COMPLETION_TOKENS),
    ) {
        usage.insert(usage_key::TOTAL_TOKENS.to_string(), prompt + completion);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::usage_key;

    #[test]
    fn non_streaming_usage_preserves_provider_side_cache_counters() {
        let parsed: MessagesResponse = serde_json::from_value(serde_json::json!({
            "content": [{ "type": "text", "text": "OK" }],
            "usage": {
                "input_tokens": 3,
                "cache_creation_input_tokens": 8,
                "cache_read_input_tokens": 4195,
                "cache_creation": {
                    "ephemeral_5m_input_tokens": 8,
                    "ephemeral_1h_input_tokens": 0
                },
                "output_tokens": 4,
                "service_tier": "standard",
                "inference_geo": "not_available"
            }
        }))
        .expect("live Anthropic usage shape parses");

        let usage = from_non_streaming(&parsed);

        assert_eq!(usage[usage_key::PROMPT_TOKENS], 3);
        assert_eq!(usage[usage_key::COMPLETION_TOKENS], 4);
        assert_eq!(usage[usage_key::TOTAL_TOKENS], 7);
        assert_eq!(usage[usage_key::CACHE_WRITE_TOKENS], 8);
        assert_eq!(usage[usage_key::CACHE_READ_TOKENS], 4195);
    }

    #[test]
    fn streaming_message_start_preserves_provider_side_cache_counters() {
        let message = serde_json::json!({
            "usage": {
                "input_tokens": 11,
                "cache_creation_input_tokens": 4195,
                "cache_read_input_tokens": 0,
                "cache_creation": {
                    "ephemeral_5m_input_tokens": 4195,
                    "ephemeral_1h_input_tokens": 0
                }
            }
        });
        let mut usage = HashMap::new();

        merge_message_start(&mut usage, Some(&message));

        assert_eq!(usage[usage_key::PROMPT_TOKENS], 11);
        assert_eq!(usage[usage_key::CACHE_WRITE_TOKENS], 4195);
        assert!(!usage.contains_key(usage_key::CACHE_READ_TOKENS));
    }
}
