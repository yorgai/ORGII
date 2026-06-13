use crate::providers::model_capabilities::*;

// ── Family table resolution ──

#[test]
fn claude_fable_5_is_always_on() {
    let caps = resolve("claude-fable-5-20260601", None);
    assert_eq!(caps.thinking, ThinkingSupport::AlwaysOn);
    assert_eq!(caps.context_window, 200_000);
}

#[test]
fn claude_opus_4_is_optional() {
    let caps = resolve("claude-opus-4-20250514", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
    assert_eq!(caps.context_window, 200_000);
}

#[test]
fn claude_sonnet_4_is_optional() {
    let caps = resolve("claude-sonnet-4-20250514", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
}

#[test]
fn claude_3_5_sonnet_no_thinking() {
    let caps = resolve("claude-3-5-sonnet-20241022", None);
    assert_eq!(caps.thinking, ThinkingSupport::No);
}

#[test]
fn claude_37_is_optional() {
    let caps = resolve("claude-3-7-sonnet-20250219", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
}

#[test]
fn shorthand_sonnet_4_normalizes() {
    let caps = resolve("sonnet-4", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
    assert_eq!(caps.context_window, 200_000);
}

// ── OpenAI family ──

#[test]
fn gpt5_is_always_on() {
    let caps = resolve("gpt-5-2025-06-01", None);
    assert_eq!(caps.thinking, ThinkingSupport::AlwaysOn);
    assert_eq!(caps.context_window, 1_000_000);
}

#[test]
fn o3_is_always_on() {
    let caps = resolve("o3-2025-04-16", None);
    assert_eq!(caps.thinking, ThinkingSupport::AlwaysOn);
}

#[test]
fn gpt4o_no_thinking() {
    let caps = resolve("gpt-4o-2024-11-20", None);
    assert_eq!(caps.thinking, ThinkingSupport::No);
}

// ── DeepSeek ──

#[test]
fn deepseek_r1_always_on() {
    let caps = resolve("deepseek-r1", None);
    assert_eq!(caps.thinking, ThinkingSupport::AlwaysOn);
    assert_eq!(caps.context_window, 128_000);
}

#[test]
fn deepseek_v3_no_thinking() {
    let caps = resolve("deepseek-v3-0324", None);
    assert_eq!(caps.thinking, ThinkingSupport::No);
}

// ── Unknown model ──

#[test]
fn unknown_model_conservative_defaults() {
    let caps = resolve("totally-unknown-model-xyz", None);
    assert_eq!(caps, ModelCapabilities::unknown());
    assert_eq!(caps.context_window, 128_000);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
    assert!(caps.omit_temperature_with_thinking);
}

// ── Case insensitivity ──

#[test]
fn case_insensitive_matching() {
    let caps = resolve("Claude-Opus-4-20250514", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
}

// ── Google ──

#[test]
fn gemini_2_optional() {
    let caps = resolve("gemini-2.0-flash", None);
    assert_eq!(caps.thinking, ThinkingSupport::Optional);
    assert_eq!(caps.context_window, 1_000_000);
}

// ── Future unknown claude is AlwaysOn (safe bet) ──

#[test]
fn future_claude_defaults_to_always_on() {
    let caps = resolve("claude-7-ultra-2029", None);
    assert_eq!(caps.thinking, ThinkingSupport::AlwaysOn);
    assert_eq!(caps.context_window, 200_000);
}
