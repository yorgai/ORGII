//! Hook event types — the lifecycle points where hooks can fire.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Lifecycle events that hooks can subscribe to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookEvent {
    /// Fires before a tool is executed. Can modify params or block execution.
    PreToolUse,
    /// Fires after a tool has executed. Receives result and duration.
    PostToolUse,
    /// Fires after a tool execution fails.
    PostToolUseFailure,
    /// Fires when a session starts (first message processed).
    SessionStart,
    /// Fires when a session ends (explicit stop or last message).
    SessionStop,
    /// Fires when the agent receives a notification/message from the user.
    NotificationReceived,
    /// Fires when the agent's turn is about to conclude (final response ready).
    Stop,
    /// Fires before the system prompt is assembled (prompt hooks inject text here).
    PrePromptBuild,
    /// Fires before context compaction starts.
    PreCompaction,
    /// Fires after context compaction completes.
    PostCompaction,
}

impl HookEvent {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PreToolUse => "pre_tool_use",
            Self::PostToolUse => "post_tool_use",
            Self::PostToolUseFailure => "post_tool_use_failure",
            Self::SessionStart => "session_start",
            Self::SessionStop => "session_stop",
            Self::NotificationReceived => "notification_received",
            Self::Stop => "stop",
            Self::PrePromptBuild => "pre_prompt_build",
            Self::PreCompaction => "pre_compaction",
            Self::PostCompaction => "post_compaction",
        }
    }

    pub fn all() -> &'static [HookEvent] {
        &[
            Self::PreToolUse,
            Self::PostToolUse,
            Self::PostToolUseFailure,
            Self::SessionStart,
            Self::SessionStop,
            Self::NotificationReceived,
            Self::Stop,
            Self::PrePromptBuild,
            Self::PreCompaction,
            Self::PostCompaction,
        ]
    }
}

impl std::fmt::Display for HookEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Context passed to hook executors — event-specific environment variables.
#[derive(Debug, Clone, Default)]
pub struct HookContext {
    /// Key-value pairs exposed as environment variables to command hooks.
    pub env_vars: HashMap<String, String>,
}

impl HookContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_var(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env_vars.insert(key.into(), value.into());
        self
    }

    /// Build context for a tool-related event.
    pub fn for_tool(session_id: &str, tool_name: &str, tool_call_id: &str) -> Self {
        Self::new()
            .with_var("ORGII_SESSION_ID", session_id)
            .with_var("ORGII_TOOL_NAME", tool_name)
            .with_var("ORGII_TOOL_CALL_ID", tool_call_id)
    }

    /// Build context for a session-level event.
    pub fn for_session(session_id: &str) -> Self {
        Self::new().with_var("ORGII_SESSION_ID", session_id)
    }
}
