//! Session Memory tunables — extraction frequency, size budgets, and SM-compact thresholds.

/// Configuration for session memory extraction.
#[derive(Debug, Clone)]
pub struct SessionMemoryConfig {
    /// Master switch.
    pub enabled: bool,
    /// Minimum total context tokens before first extraction.
    pub min_tokens_to_init: usize,
    /// Minimum token growth since last extraction to trigger update.
    pub min_tokens_between_update: usize,
    /// Minimum new tool calls since last extraction.
    pub tool_calls_between_updates: usize,
    /// Per-section token soft cap (used in prompt instructions).
    pub max_section_tokens: usize,
    /// Total SM content token cap.
    pub max_total_tokens: usize,
    /// Max tokens for the extraction LLM response.
    pub extraction_max_tokens: u32,
}

impl Default for SessionMemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_tokens_to_init: 10_000,
            min_tokens_between_update: 5_000,
            tool_calls_between_updates: 3,
            max_section_tokens: 2_000,
            max_total_tokens: 12_000,
            extraction_max_tokens: 4096,
        }
    }
}

/// Configuration for SM-compact (the compaction path that uses SM as summary).
#[derive(Debug, Clone)]
pub struct SessionMemoryCompactConfig {
    /// Minimum tokens to preserve after compaction.
    pub min_tokens_to_keep: usize,
    /// Minimum messages with text content to keep.
    pub min_text_messages_to_keep: usize,
    /// Hard cap on preserved tokens.
    pub max_tokens_to_keep: usize,
}

impl Default for SessionMemoryCompactConfig {
    fn default() -> Self {
        Self {
            min_tokens_to_keep: 10_000,
            min_text_messages_to_keep: 5,
            max_tokens_to_keep: 40_000,
        }
    }
}
