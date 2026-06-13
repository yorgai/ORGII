//! Single source of truth for per-model capability resolution.
//!
//! Replaces the two parallel substring-match tables that previously lived in
//! `anthropic_native/thinking.rs` (thinking support) and `model_hints.rs`
//! (context windows). Every capability question — "does this model think?",
//! "how big is its context window?", "can I send temperature together with
//! thinking?" — must go through [`resolve`].
//!
//! # Resolution chain
//!
//! 1. **KeyVault** (`KEY_SERVICE`): the user's own model registry. A
//!    `ModelVariant { reasoning: Some(_) }` row for this model means the
//!    user (or the behavioral-observation writeback in `side_query.rs`)
//!    has marked it as a reasoning model.
//! 2. **Built-in family table** ([`FAMILY_RULES`]): declarative, one row
//!    per model family. The ONLY place family substring patterns live.
//! 3. **Conservative defaults**: unknown models get a 128K window and
//!    `ThinkingSupport::Optional` — "works, maybe suboptimally" instead
//!    of "fails loudly when the guess is wrong".
//!
//! @[MODEL LAUNCH]: when a new model family ships, add ONE row to
//! [`FAMILY_RULES`]. Do not add substring checks anywhere else — the
//! `no_substring_capability_checks_outside_this_module` test in this file
//! is the enforcement point.

use key_vault::key_store::KEY_SERVICE;

/// How a model handles extended thinking / reasoning output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThinkingSupport {
    /// Model never emits thinking blocks; sending a `thinking` request
    /// param would be rejected.
    No,
    /// Model supports thinking and accepts `{"type": "disabled"}` to turn
    /// it off (Claude 3.7 / 4 family behavior).
    Optional,
    /// Model thinks unconditionally server-side and REJECTS
    /// `{"type": "disabled"}` with a 400. Callers that need plain text
    /// must pad `max_tokens` instead (claude_code yoloClassifier lesson:
    /// observed 0–1114 thinking tokens before the answer).
    AlwaysOn,
}

/// Resolved capabilities for one model id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelCapabilities {
    pub context_window: usize,
    pub thinking: ThinkingSupport,
    /// When true, requests that enable thinking must omit `temperature`
    /// (Anthropic rejects sending both).
    pub omit_temperature_with_thinking: bool,
}

impl ModelCapabilities {
    /// Conservative profile for models nothing knows about: assume
    /// thinking-capable (never breaks a non-thinking model) and a 128K
    /// window (smallest mainstream size).
    pub const fn unknown() -> Self {
        Self {
            context_window: 128_000,
            thinking: ThinkingSupport::Optional,
            omit_temperature_with_thinking: true,
        }
    }
}

/// One declarative row: any model id containing `pattern` (after claude
/// shorthand normalization + lowercasing) gets these capabilities.
/// First match wins — order from most to least specific.
struct FamilyRule {
    pattern: &'static str,
    context_window: usize,
    thinking: ThinkingSupport,
}

/// @[MODEL LAUNCH] checklist:
/// 1. Add the family row here (pattern is matched with `contains` on the
///    lowercased, shorthand-normalized model id).
/// 2. If the model always thinks and rejects `thinking: disabled`, use
///    `AlwaysOn` — side queries will pad max_tokens instead.
/// 3. Nothing else. Tests pin that no other module does substring checks.
const FAMILY_RULES: &[FamilyRule] = &[
    // ── Anthropic ──
    // claude-fable-5: thinks by default in non-streaming responses
    // (2026-06-12 incident: thinking-only side-query responses broke
    // compaction + session-memory extraction).
    FamilyRule { pattern: "claude-fable-5", context_window: 200_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "claude-opus-4", context_window: 200_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "claude-sonnet-4", context_window: 200_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "claude-haiku-4", context_window: 200_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "claude-3-7", context_window: 200_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "claude-3-5", context_window: 200_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "claude-3-opus", context_window: 200_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "claude-3-haiku", context_window: 200_000, thinking: ThinkingSupport::No },
    // Unknown claude generations (claude-5, claude-6 …): assume always-on
    // thinking — newer Anthropic models default to it, and AlwaysOn is the
    // safe guess (Optional would send `disabled` and risk a 400).
    FamilyRule { pattern: "claude", context_window: 200_000, thinking: ThinkingSupport::AlwaysOn },
    // ── OpenAI ──
    FamilyRule { pattern: "gpt-5", context_window: 1_000_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "gpt-4.1", context_window: 1_000_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "o3", context_window: 200_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "o4", context_window: 200_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "o1", context_window: 200_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "gpt-4o", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "gpt-4-turbo", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "gpt-4", context_window: 128_000, thinking: ThinkingSupport::No },
    // ── Google ──
    FamilyRule { pattern: "gemini-2", context_window: 1_000_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "gemini-1.5", context_window: 1_000_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "gemini", context_window: 1_000_000, thinking: ThinkingSupport::Optional },
    // ── DeepSeek ──
    FamilyRule { pattern: "deepseek-r1", context_window: 128_000, thinking: ThinkingSupport::AlwaysOn },
    FamilyRule { pattern: "deepseek-v3", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "deepseek-coder", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "deepseek-chat", context_window: 64_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "deepseek", context_window: 64_000, thinking: ThinkingSupport::No },
    // ── Alibaba / Moonshot / Zhipu ──
    FamilyRule { pattern: "qwen-max", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "qwen-plus", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "qwen-turbo", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "qwen", context_window: 32_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "kimi", context_window: 256_000, thinking: ThinkingSupport::Optional },
    FamilyRule { pattern: "moonshot-v1-128k", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "moonshot-v1-32k", context_window: 32_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "moonshot-v1-8k", context_window: 8_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "moonshot", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "glm-4", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "glm", context_window: 32_000, thinking: ThinkingSupport::No },
    // ── Meta / Mistral ──
    FamilyRule { pattern: "llama-4", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "llama-3.3", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "llama-3.1", context_window: 128_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "llama-3", context_window: 8_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "llama", context_window: 8_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "mixtral-8x22b", context_window: 65_000, thinking: ThinkingSupport::No },
    FamilyRule { pattern: "mixtral", context_window: 32_000, thinking: ThinkingSupport::No },
];

/// Resolve capabilities for `model`, optionally consulting the KeyVault
/// entry for `account_id`.
///
/// KeyVault only *upgrades* thinking knowledge (a user/observation row
/// saying "this model reasons" beats the family guess); context window
/// always comes from the family table or default since KeyVault does not
/// store it.
pub fn resolve(model: &str, account_id: Option<&str>) -> ModelCapabilities {
    let mut caps = resolve_from_family_table(model);

    if let Some(vault_thinking) = resolve_thinking_from_keyvault(model, account_id) {
        caps.thinking = vault_thinking;
    }

    caps
}

fn resolve_from_family_table(model: &str) -> ModelCapabilities {
    let normalized = super::model_hints::normalize_claude_shorthand(model);
    let model_lower = normalized.to_lowercase();
    for rule in FAMILY_RULES {
        if model_lower.contains(rule.pattern) {
            return ModelCapabilities {
                context_window: rule.context_window,
                thinking: rule.thinking,
                omit_temperature_with_thinking: true,
            };
        }
    }
    ModelCapabilities::unknown()
}

/// KeyVault layer: a `ModelVariant` row with `reasoning: Some(..)` marks
/// the model as a reasoning model for this account. The writeback in
/// `side_query.rs` uses the value `"always_on"` to record observed
/// always-on behavior; any other non-empty value means Optional.
fn resolve_thinking_from_keyvault(model: &str, account_id: Option<&str>) -> Option<ThinkingSupport> {
    let account_id = account_id?;
    let key = KEY_SERVICE.get_key_by_id(account_id)?;
    let variant = key.model_variants.iter().find(|v| v.model == model)?;
    let reasoning = variant.reasoning.as_deref()?;
    if reasoning.is_empty() {
        return None;
    }
    Some(if reasoning == OBSERVED_ALWAYS_ON_REASONING {
        ThinkingSupport::AlwaysOn
    } else {
        ThinkingSupport::Optional
    })
}

/// `ModelVariant.reasoning` value written by behavioral observation when a
/// model is seen thinking despite a `disabled` request (or rejects
/// `disabled` with a 400). Shared with `key_vault`'s writeback API.
pub const OBSERVED_ALWAYS_ON_REASONING: &str = "always_on";

#[cfg(test)]
#[path = "tests/model_capabilities_tests.rs"]
mod tests;
