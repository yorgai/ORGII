//! Shared types for CLI agent event parsing.
//!
//! The canonical `ActivityChunk` wire shape lives in
//! [`core_types::activity::ActivityChunk`] so non-CLI emitters
//! (`dev_record`, event-pipeline ingestion, websocket broadcasters) can
//! type their values without depending on this module.

use serde::{Deserialize, Serialize};

/// CLI-based agents (subset of ModelType for parser use).
///
/// This is a focused subset for the parsers module. For the full set including
/// API providers, use `ModelType` from `key_vault::key_store::types`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CliAgentType {
    CursorCli,
    ClaudeCode,
    Codex,
    GeminiCli,
    Kiro,
    Copilot,
    KimiCli,
    OpenCode,
}

impl CliAgentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CursorCli => "cursor_cli",
            Self::ClaudeCode => "claude_code",
            Self::Codex => "codex",
            Self::GeminiCli => "gemini_cli",
            Self::Kiro => "kiro",
            Self::Copilot => "copilot",
            Self::KimiCli => "kimi_cli",
            Self::OpenCode => "opencode",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "cursor_cli" | "cursor" => Some(Self::CursorCli),
            "claude_code" => Some(Self::ClaudeCode),
            "codex" => Some(Self::Codex),
            "gemini_cli" | "gemini" => Some(Self::GeminiCli),
            "kiro" => Some(Self::Kiro),
            "copilot" => Some(Self::Copilot),
            "kimi_cli" | "kimi_code" => Some(Self::KimiCli),
            "opencode" | "opencode_cli" => Some(Self::OpenCode),
            _ => None,
        }
    }
}

/// Deprecated: Use `CliAgentType` instead.
#[deprecated(since = "0.2.0", note = "Use CliAgentType instead")]
pub type AgentPlatform = CliAgentType;

/// Token usage reported by CLI agents.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
    pub model: Option<String>,
}

#[cfg(test)]
#[path = "tests/types_tests.rs"]
mod tests;
