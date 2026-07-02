//! Turn executor types — permission provider trait and verdict enum
//!
//! `PermissionProvider` is the async trait that the turn executor calls before
//! executing each tool call. Implementations can block execution, allow it, or
//! request user confirmation via a modal.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::core::turn_executor::context_accounting::ContextUsageSnapshot;
use crate::core::turn_executor::usage_telemetry::UsageTelemetry;
use crate::tools::traits::ToolUIMetadata;
use shared_state::ScreenshotStore;

// ============================================
// Permission Provider
// ============================================

/// Result of a permission check for a tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionVerdict {
    Allow,
    Deny,
    AlwaysAllow,
}

/// Abstract permission provider for tool execution.
///
/// `execute_turn` calls this when a tool has an `Ask` verdict in the policy.
/// Implementations handle the actual prompt UI (a frontend dialog driven by
/// a `permission:request` event delivered over the Tauri IPC Channel).
#[async_trait]
pub trait PermissionProvider: Send + Sync {
    /// Check if a tool has been granted "always allow" for the current session.
    async fn is_always_allowed(&self, tool_name: &str) -> bool;

    /// Request user permission for a tool call.
    /// Returns the user's verdict, or `Err(())` if the request was cancelled.
    async fn request_permission(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
        args: &Value,
    ) -> Result<PermissionVerdict, ()>;
}

/// Optional hook invoked at the start of each LLM iteration.
///
/// Used by non-blocking prefetch surfaces: a caller can start background work
/// before `execute_turn`, then perform a zero-wait collect before each provider
/// request. Implementations must return immediately when their work is not yet
/// ready.
#[async_trait]
pub trait TurnIterationHook: Send + Sync {
    async fn before_llm_iteration(
        &self,
        session_id: &str,
        iteration: u32,
        messages: &mut Vec<Value>,
    );
}

// ============================================
// Turn Configuration
// ============================================

/// Configuration for a single agent turn.
#[derive(Clone)]
pub struct TurnConfig {
    /// Model identifier (provider-specific).
    pub model: String,
    /// KeyVault account id backing this turn. Threaded through so
    /// `model_capabilities::resolve` can apply the provider-specific context
    /// window override (from `/v1/models`). `None` for contexts without a
    /// resolved key (tests, memory consolidation) — resolve then falls back
    /// to the static family table.
    pub account_id: Option<String>,
    /// User/agent-configured context window. `None` means auto-detect from the
    /// model family plus any account-specific provider override.
    pub context_window_override: Option<u64>,
    /// Maximum tool call iterations per turn.
    /// `None` means unlimited — the loop runs until the model stops calling tools
    /// (guarded by repeat detection, error loop detection, and cancellation).
    pub max_iterations: Option<u32>,
    /// Maximum tokens in LLM response.
    pub max_tokens: u32,
    /// Sampling temperature.
    pub temperature: f32,
    /// Maximum read-only tool calls to run concurrently from one assistant message.
    pub max_tool_use_concurrency: usize,
    /// Optional screenshot store for resolving `[screenshot:ID]` markers
    /// into multimodal image blocks before sending to the LLM.
    pub screenshot_store: Option<Arc<ScreenshotStore>>,
    /// Optional per-iteration hook. It must never block on unfinished work.
    pub iteration_hook: Option<Arc<dyn TurnIterationHook>>,
    /// Whether observing the cancel flag should persist a next-turn cancel marker.
    pub persist_cancel_marker: bool,
}

// ============================================
// Turn Result
// ============================================

/// Result of a completed agent turn.
pub struct TurnResult {
    /// Final text content from the LLM (if any).
    pub content: Option<String>,
    /// The full message history accumulated during this turn (user, assistant,
    /// and tool turns). Subagent callers (e.g. `AgentTool`) use this to call
    /// `last_assistant_text` for narration recovery: when `content` is `None`
    /// (terminal iteration was pure tool_use), the caller backtracks through
    /// `messages` to find the most recent assistant text.
    pub messages: Vec<serde_json::Value>,
    /// When true, `content` is an API/stream error message synthesized by
    /// the turn executor after retries were exhausted.
    ///
    /// Callers MUST NOT persist this content into the conversation history
    /// (i.e. skip the `on_assistant_iteration_complete` write). The error text
    /// is surfaced to the user via `on_stream_error_exhausted` and the
    /// `agent:error` / `agent:complete` events; writing it to the DB would
    /// cause it to be replayed as a real assistant turn on the next call,
    /// wasting context-window tokens and potentially confusing the LLM.
    pub is_stream_error: bool,
    /// Accumulated prompt tokens across all LLM calls in this turn.
    pub prompt_tokens: i64,
    /// Accumulated completion tokens across all LLM calls in this turn.
    pub completion_tokens: i64,
    /// Accumulated total tokens across all LLM calls in this turn.
    pub total_tokens: i64,
    /// Prompt tokens from the last LLM call — represents current context window fill level.
    pub context_tokens: i64,
    /// Estimated context breakdown for the final provider request payload.
    pub context_usage_snapshot: Option<ContextUsageSnapshot>,
    /// Accumulated cache-read tokens (Anthropic prompt caching).
    pub cache_read_tokens: i64,
    /// Accumulated cache-write tokens (Anthropic prompt caching).
    pub cache_write_tokens: i64,
    /// Per-LLM-call spans and per-tool-call attribution for diagnostics.
    pub usage_telemetry: UsageTelemetry,
}

// ============================================
// Turn Event Handler
// ============================================

/// Result from `before_tool_execute` indicating whether to block or modify a tool call.
pub struct ToolHookIntervention {
    /// If true, skip tool execution and return `block_reason` as the result.
    pub block: bool,
    /// Reason shown to the LLM when blocked.
    pub block_reason: Option<String>,
    /// Modified params to use instead of the original.
    pub modified_params: Option<Value>,
}

/// Callback trait for agent events during a turn.
///
/// Implementors handle streaming deltas, tool call/result events,
/// and persistence. Each agent type provides its own implementation.
#[async_trait]
#[allow(unused_variables)]
pub trait TurnEventHandler: Send + Sync {
    /// Called for each streaming text delta from the LLM.
    fn on_message_delta(&self, session_id: &str, content: &str);

    /// Called for each streaming thinking/reasoning delta from the LLM.
    fn on_thinking_delta(&self, session_id: &str, thinking: &str) {}

    /// Called for each streaming tool call argument delta from the LLM.
    /// Enables progressive rendering of tool call arguments (e.g., file edits).
    fn on_tool_call_delta(
        &self,
        session_id: &str,
        index: usize,
        tool_call_id: Option<&str>,
        tool_name: Option<&str>,
        arguments_delta: Option<&str>,
    ) {
    }

    /// Called when the LLM requests a tool call (before execution).
    fn on_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        args: &Value,
    );

    /// Called after hooks/permission checks resolve the final arguments, just before execution.
    fn on_tool_execute_start(
        &self,
        _session_id: &str,
        _tool_call_id: &str,
        _tool_name: &str,
        _args: &Value,
    ) {
    }

    /// Called after a tool has been executed with its result.
    fn on_tool_result(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
    );

    /// Called after a tool has been executed with optional structured UI metadata.
    ///
    /// This implements the "dual-track response" pattern: the text `result` goes
    /// to the LLM context, while `ui_metadata` provides structured data for rich
    /// frontend rendering (tables, diffs, search results, etc.).
    ///
    /// Default implementation calls `on_tool_result` and ignores the metadata.
    /// Override in handlers that support rich UI rendering.
    fn on_tool_result_with_metadata(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
        ui_metadata: Option<&ToolUIMetadata>,
    ) {
        // Default: fall back to basic on_tool_result, ignore metadata
        let _metadata = ui_metadata; // suppress unused warning
        self.on_tool_result(session_id, tool_call_id, tool_name, display_name, result);
    }

    /// Called after a file-modifying tool succeeds with the list of changed file paths.
    /// Implementations can broadcast diff information to the frontend.
    fn on_file_change(&self, session_id: &str, tool_name: &str, file_paths: &[String]) {}

    /// Called once per LLM iteration when the model emits an assistant turn —
    /// i.e. any combination of text and tool_calls that resulted from a single
    /// completion. `content` is the aggregated text (may be empty); `tool_calls`
    /// indicates whether this iteration also produced tool calls (only used for
    /// observability/filtering — the actual tool_call rows are written via
    /// `on_tool_call`). `model` is the provider-qualified model id.
    ///
    /// Handlers that persist LLM conversation history should write one
    /// assistant row here (matching the OpenAI/Anthropic spec where a single
    /// assistant message can carry both text and tool_calls). Default is a
    /// no-op so background/test handlers without persistence stay unaffected.
    fn on_assistant_iteration_complete(
        &self,
        session_id: &str,
        content: Option<&str>,
        has_tool_calls: bool,
        model: &str,
    ) {
    }

    /// Optional: called after a file-modifying tool succeeds.
    /// Returns additional text to append to the tool result (e.g., LSP diagnostics).
    /// Default returns None (no post-processing).
    async fn post_tool_hook(
        &self,
        _tool_name: &str,
        _args: &Value,
        _result: &str,
    ) -> Option<String> {
        None
    }

    /// Called before a tool is executed. Plugins can block or modify params.
    /// Returns None to proceed normally, or Some(ToolHookIntervention).
    async fn before_tool_execute(
        &self,
        _session_id: &str,
        _tool_name: &str,
        _args: &Value,
    ) -> Option<ToolHookIntervention> {
        None
    }

    /// Called after a tool is executed. For observability (logging, memory ingestion).
    /// Implementations should not block the agent loop.
    async fn after_tool_execute(
        &self,
        _session_id: &str,
        _tool_call_id: &str,
        _tool_name: &str,
        _args: &Value,
        _result: &str,
        _error: Option<&str>,
        _duration_ms: u64,
    ) {
    }

    /// Called when the final provider request payload's context usage estimate is available.
    fn on_context_usage(&self, _session_id: &str, _usage: &ContextUsageSnapshot) {}

    /// Called when a stream error is about to be retried. Low-key observability
    /// signal — handlers can surface this as a footer indicator ("Reconnecting…"),
    /// NOT as a chat bubble. Intentionally distinct from `on_message_delta` so
    /// the frontend never confuses retry internals with model output.
    ///
    /// - `kind` is the snake_case form of [`StreamErrorKind`] (e.g. `"idle_timeout"`).
    /// - `attempt` is 1-indexed (first retry = 1).
    /// - `max_attempts` is the retry budget ceiling; after `attempt == max_attempts`
    ///   the next failure surfaces through [`Self::on_stream_error_exhausted`].
    /// - `backoff_ms` is the wall-clock delay before the next attempt.
    ///
    /// Default is a no-op so background/test handlers stay unaffected.
    fn on_stream_retry(
        &self,
        _session_id: &str,
        _kind: &str,
        _attempt: u32,
        _max_attempts: u32,
        _backoff_ms: u64,
    ) {
    }

    /// Called once when the stream retry budget is exhausted. The turn
    /// is about to bail out with a terminal error; handlers that
    /// persist / surface user-visible errors should render a clear
    /// message here. No further streaming deltas will fire.
    ///
    /// `kind` is the last-seen snake_case [`StreamErrorKind`]. `attempts` is the
    /// total number of attempts that failed (== `max_attempts` configured in
    /// [`Self::on_stream_retry`]).
    fn on_stream_error_exhausted(
        &self,
        _session_id: &str,
        _kind: &str,
        _attempts: u32,
        _user_message: &str,
    ) {
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_result_cache_token_fields_exist_and_default_to_zero() {
        let result = TurnResult {
            content: None,
            is_stream_error: false,
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            context_tokens: 100,
            context_usage_snapshot: None,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            usage_telemetry: UsageTelemetry::default(),
            messages: vec![],
        };
        assert_eq!(result.cache_read_tokens, 0);
        assert_eq!(result.cache_write_tokens, 0);
    }

    #[test]
    fn turn_result_carries_cache_tokens() {
        let result = TurnResult {
            content: Some("hello".into()),
            is_stream_error: false,
            prompt_tokens: 1000,
            completion_tokens: 200,
            total_tokens: 1200,
            context_tokens: 1000,
            context_usage_snapshot: None,
            cache_read_tokens: 500,
            cache_write_tokens: 300,
            usage_telemetry: UsageTelemetry::default(),
            messages: vec![],
        };
        assert_eq!(result.cache_read_tokens, 500);
        assert_eq!(result.cache_write_tokens, 300);
        assert_eq!(result.prompt_tokens, 1000);
    }

    #[test]
    fn turn_config_unlimited_iterations() {
        let config = TurnConfig {
            model: "test".to_string(),
            account_id: None,
            context_window_override: None,
            max_iterations: None,
            max_tokens: 4096,
            temperature: 0.5,
            max_tool_use_concurrency: 10,
            screenshot_store: None,
            iteration_hook: None,
            persist_cancel_marker: false,
        };
        assert!(config.max_iterations.is_none());
    }

    #[test]
    fn turn_config_limited_iterations() {
        let config = TurnConfig {
            model: "test".to_string(),
            account_id: None,
            context_window_override: None,
            max_iterations: Some(15),
            max_tokens: 4096,
            temperature: 0.5,
            max_tool_use_concurrency: 10,
            screenshot_store: None,
            iteration_hook: None,
            persist_cancel_marker: false,
        };
        assert_eq!(config.max_iterations, Some(15));
    }
}
