//! Extended-thinking request parameters, driven by [`ModelCapabilities`].
//!
//! The old substring matcher (`supports_thinking`) lived here until the
//! 2026-06-12 incident: `claude-fable-5` wasn't matched, got no thinking
//! handling, and returned thinking-only side-query responses that broke
//! compaction + session-memory extraction. Capability questions now go
//! through `model_capabilities::resolve` — this module only translates a
//! resolved capability + the caller's [`ThinkingDirective`] into the
//! Anthropic request triad `(thinking, temperature, max_tokens)`.

use serde_json::Value;

use crate::providers::model_capabilities::{ModelCapabilities, ThinkingSupport};

/// What the caller wants from thinking, independent of what the model can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThinkingDirective {
    /// Normal behavior: enable thinking when the model supports it.
    #[default]
    Auto,
    /// Caller needs plain text (side queries: summarization, extraction,
    /// classification). For `Optional` models we send
    /// `{"type": "disabled"}`; for `AlwaysOn` models — which reject
    /// `disabled` with a 400 — we instead pad `max_tokens` so thinking
    /// can't exhaust the output budget before the answer is emitted.
    PlainText,
}

/// Headroom added to `max_tokens` for always-on-thinking models when the
/// caller wants plain text. claude_code observed 0–1114 thinking tokens on
/// classifier calls; 2048 gives comfortable margin.
const ALWAYS_ON_THINKING_PAD_TOKENS: u32 = 2048;

/// Build the `thinking` request param and adjust max_tokens / temperature.
///
/// Returns `(thinking_param, temperature, max_tokens)`. When thinking is
/// enabled and `caps.omit_temperature_with_thinking` is set, temperature is
/// `None` (Anthropic rejects requests carrying both).
pub(super) fn build_thinking_params(
    caps: &ModelCapabilities,
    directive: ThinkingDirective,
    max_tokens: u32,
    temperature: f32,
) -> (Option<Value>, Option<f32>, u32) {
    match (caps.thinking, directive) {
        (ThinkingSupport::No, _) => (None, Some(temperature), max_tokens),

        (ThinkingSupport::Optional, ThinkingDirective::PlainText) => (
            Some(serde_json::json!({ "type": "disabled" })),
            Some(temperature),
            max_tokens,
        ),

        (ThinkingSupport::AlwaysOn, ThinkingDirective::PlainText) => {
            // `disabled` would be rejected with a 400; pad the budget so
            // the visible answer survives the model's obligatory thinking.
            (
                None,
                temperature_for_thinking(caps, temperature),
                max_tokens.saturating_add(ALWAYS_ON_THINKING_PAD_TOKENS),
            )
        }

        (ThinkingSupport::Optional, ThinkingDirective::Auto) => {
            let budget = (max_tokens / 2).clamp(1024, 32768);
            let effective_max = max_tokens.max(budget + 1024);
            (
                Some(serde_json::json!({
                    "type": "enabled",
                    "budget_tokens": budget,
                })),
                temperature_for_thinking(caps, temperature),
                effective_max,
            )
        }

        (ThinkingSupport::AlwaysOn, ThinkingDirective::Auto) => {
            // Model thinks server-side without being asked; send no
            // thinking param and make sure the output budget has room.
            (
                None,
                temperature_for_thinking(caps, temperature),
                max_tokens.max(ALWAYS_ON_THINKING_PAD_TOKENS + 1024),
            )
        }
    }
}

fn temperature_for_thinking(caps: &ModelCapabilities, temperature: f32) -> Option<f32> {
    if caps.omit_temperature_with_thinking {
        None
    } else {
        Some(temperature)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn optional_caps() -> ModelCapabilities {
        ModelCapabilities {
            context_window: 200_000,
            thinking: ThinkingSupport::Optional,
            omit_temperature_with_thinking: true,
        }
    }

    fn always_on_caps() -> ModelCapabilities {
        ModelCapabilities {
            context_window: 200_000,
            thinking: ThinkingSupport::AlwaysOn,
            omit_temperature_with_thinking: true,
        }
    }

    fn no_thinking_caps() -> ModelCapabilities {
        ModelCapabilities {
            context_window: 128_000,
            thinking: ThinkingSupport::No,
            omit_temperature_with_thinking: false,
        }
    }

    #[test]
    fn no_thinking_model_passes_temperature_through() {
        let (thinking, temp, max_tokens) =
            build_thinking_params(&no_thinking_caps(), ThinkingDirective::Auto, 4096, 0.7);
        assert!(thinking.is_none());
        assert_eq!(temp, Some(0.7));
        assert_eq!(max_tokens, 4096);
    }

    #[test]
    fn optional_plain_text_sends_disabled() {
        let (thinking, temp, max_tokens) =
            build_thinking_params(&optional_caps(), ThinkingDirective::PlainText, 1024, 0.0);
        assert_eq!(thinking.unwrap()["type"], "disabled");
        assert_eq!(temp, Some(0.0));
        assert_eq!(max_tokens, 1024);
    }

    #[test]
    fn always_on_plain_text_pads_max_tokens_no_disabled() {
        let (thinking, temp, max_tokens) =
            build_thinking_params(&always_on_caps(), ThinkingDirective::PlainText, 1024, 0.5);
        // Must NOT send {"type":"disabled"} — that would be rejected with a 400
        assert!(thinking.is_none());
        // Temperature omitted for thinking models
        assert!(temp.is_none());
        // max_tokens padded for thinking overhead
        assert!(max_tokens > 1024);
        assert_eq!(max_tokens, 1024 + 2048);
    }

    #[test]
    fn optional_auto_enables_thinking_with_budget() {
        let (thinking, temp, max_tokens) =
            build_thinking_params(&optional_caps(), ThinkingDirective::Auto, 8192, 0.7);
        let thinking = thinking.unwrap();
        assert_eq!(thinking["type"], "enabled");
        assert!(thinking["budget_tokens"].as_u64().unwrap() > 0);
        // Temperature omitted when thinking is enabled
        assert!(temp.is_none());
        assert!(max_tokens >= 8192);
    }

    #[test]
    fn always_on_auto_ensures_min_budget() {
        let (thinking, _temp, max_tokens) =
            build_thinking_params(&always_on_caps(), ThinkingDirective::Auto, 1024, 0.0);
        // No thinking param needed — server handles it
        assert!(thinking.is_none());
        // But max_tokens must have room
        assert!(max_tokens >= 2048 + 1024);
    }
}
