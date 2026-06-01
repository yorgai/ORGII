//! Provider reliability configuration (retry + fallback chain).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityConfig {
    /// Maximum retry attempts per provider (0 = no retries).
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Base backoff in milliseconds (doubles each retry, capped at 10s).
    #[serde(default = "default_base_backoff_ms")]
    pub base_backoff_ms: u64,
    /// Fallback model names (e.g., ["openai/gpt-4o", "deepseek/deepseek-chat"]).
    /// Tried in order after the primary model is exhausted.
    #[serde(default)]
    pub fallback_models: Vec<String>,
}

fn default_max_retries() -> u32 {
    // 10 retries for pre-stream retryable HTTP errors (rate limit,
    // overloaded, transient 5xx). The in-stream retry budget in
    // `turn_executor` is also 10 — keeping the two sides aligned
    // gives the same reliability ceiling regardless of where the
    // failure surfaces (before vs during token streaming).
    10
}

fn default_base_backoff_ms() -> u64 {
    500
}

impl Default for ReliabilityConfig {
    fn default() -> Self {
        Self {
            max_retries: default_max_retries(),
            base_backoff_ms: default_base_backoff_ms(),
            fallback_models: Vec::new(),
        }
    }
}
