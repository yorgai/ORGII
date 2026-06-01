//! Extended-thinking parameters for Anthropic Claude models.
//!
//! Models that support extended thinking (Claude 3.7 Sonnet, Claude Sonnet 4,
//! Claude Opus 4) need the `thinking` request param + an adjusted output
//! budget. When thinking is enabled, Anthropic also requires `temperature`
//! to be omitted from the request — the API rejects requests that send
//! both. These two helpers centralize that branch so call sites in
//! `streaming::*` stay readable.

use serde_json::Value;

/// Returns true if the given model id supports extended thinking.
///
/// Matches the family-prefix rules used by Anthropic's docs (any
/// `claude-3-7-*`, `claude-sonnet-4-*`, `claude-opus-4-*` variant).
/// Case-insensitive so deployment-suffixed model ids
/// (e.g. `azure-claude-sonnet-4-deployment-1`) are still detected.
pub(super) fn supports_thinking(model: &str) -> bool {
    let lower = model.to_lowercase();
    lower.contains("claude-3-7")
        || lower.contains("claude-sonnet-4")
        || lower.contains("claude-opus-4")
}

/// Build the `thinking` request param and adjust max_tokens / temperature
/// for thinking mode.
///
/// Returns `(thinking_param, temperature, max_tokens)`. When the model
/// doesn't support thinking, returns `(None, None, max_tokens)` and the
/// caller should still apply its own temperature.
///
/// Notes:
/// - `budget_tokens` is half of `max_tokens` clamped to `[1024, 32768]`.
///   This is the **carve-out** from the total output budget for thinking
///   tokens; the response itself shares the rest.
/// - We bump `max_tokens` to `budget + 1024` if it would otherwise be too
///   small to leave room for any visible response after thinking.
/// - When thinking is enabled we return `temperature = None` because
///   Anthropic rejects requests that send both `thinking` and `temperature`.
pub(super) fn build_thinking_params(
    model: &str,
    max_tokens: u32,
    _temperature: f32,
) -> (Option<Value>, Option<f32>, u32) {
    if supports_thinking(model) {
        let budget = (max_tokens / 2).clamp(1024, 32768);
        let effective_max = max_tokens.max(budget + 1024);
        (
            Some(serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            })),
            None,
            effective_max,
        )
    } else {
        (None, None, max_tokens)
    }
}
