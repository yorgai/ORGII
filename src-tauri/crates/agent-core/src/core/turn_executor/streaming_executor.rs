//! Streaming Tool Executor — pre-parses tool calls during LLM streaming.
//!
//! As the LLM streams tool call deltas, this module incrementally
//! accumulates and validates them. When
//! the stream ends, all **read-only** tool calls that were fully parsed during
//! streaming are immediately available for concurrent execution — no re-parsing needed.
//!
//! ## Current Behavior
//!
//! The accumulator runs inside the synchronous `on_delta` callback (via
//! `Arc<std::sync::Mutex<...>>`). It classifies each completed tool call as:
//! - **read-only** → marked as pre-validated; skips the normal execution path
//!   and instead executes immediately post-stream in parallel
//! - **write / unknown** → deferred to the normal sequential execution path
//!
//! ## Architecture
//!
//! ```text
//! ┌─ on_delta callback ─────┐
//! │ feed tool_call deltas    │
//! │ accumulate JSON args     │
//! │ detect complete + valid  │
//! │ classify read-only       │
//! └──────────────────────────┘
//!          │
//!          ▼  (after stream ends)
//! ┌─ execute_prevalidated ──────────────────────┐
//! │ for each read-only TC: spawn tool.execute(, &crate::tools::call_context::CallContext::default()) │
//! │ join_all → Vec<StreamedToolResult>           │
//! └──────────────────────────────────────────────┘
//! ```

use std::collections::HashMap;

use serde_json::Value;
use tracing::info;

use crate::core::turn_executor::tool_execution::normalize_tool_use_concurrency;
use crate::providers::traits::{ToolCallDelta, ToolCallRequest};
use crate::tools::policy::{ResolvedToolPolicy, ToolVerdict};
use crate::tools::registry::ToolRegistry;
use crate::tools::traits::ToolExecuteResult;

/// Result of a tool that was executed via the streaming executor.
///
/// `result` preserves the full [`ToolExecuteResult`] (text + structured
/// content blocks + MCP meta) so downstream wire-format branching
/// (Anthropic-native) can read the structured payload. The OpenAI-compat
/// path only consumes `.text`.
#[derive(Debug, Clone)]
pub(crate) struct StreamedToolResult {
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    pub result: Result<ToolExecuteResult, String>,
}

/// Accumulates tool call deltas from the streaming callback and identifies
/// read-only tool calls that can be immediately executed after the stream ends.
pub(crate) struct StreamingToolAccumulator {
    /// Per-index accumulation state.
    accumulators: HashMap<usize, ToolCallAccumulator>,
    /// Set of tool names known to be read-only and allowed by policy.
    read_only_tools: std::collections::HashSet<String>,
    /// Completed read-only tool call requests ready for immediate execution.
    ready_tool_calls: Vec<ToolCallRequest>,
    /// IDs of tool calls that are ready (for filtering in normal execution path).
    ready_ids: Vec<String>,
}

/// Tracks incremental accumulation of a single tool call from streaming deltas.
struct ToolCallAccumulator {
    id: Option<String>,
    name: Option<String>,
    arguments: String,
    finalized: bool,
}

impl ToolCallAccumulator {
    fn new() -> Self {
        Self {
            id: None,
            name: None,
            arguments: String::new(),
            finalized: false,
        }
    }

    fn is_complete(&self) -> bool {
        if self.id.is_none() || self.name.is_none() {
            return false;
        }
        let trimmed = self.arguments.trim();
        if trimmed.is_empty() {
            return false;
        }
        serde_json::from_str::<Value>(trimmed).is_ok()
    }

    /// Convert this accumulator into a `ToolCallRequest`.
    ///
    /// **Invariant**: callers must gate this with `is_complete()` first.
    /// `is_complete()` already calls `serde_json::from_str::<Value>(...)`
    /// on the trimmed arguments, so the `from_str` here is a defensive
    /// recheck — if it fails, the caller broke the gating contract.
    /// Returning `None` keeps `try_finalize` graceful (skip this index)
    /// instead of panicking on a contract violation, but the warn makes
    /// the bug visible.
    fn to_tool_call_request(&self) -> Option<ToolCallRequest> {
        let id = self.id.as_ref()?;
        let name = self.name.as_ref()?;
        let args: Value = match serde_json::from_str(self.arguments.trim()) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(
                    tool_id = %id,
                    tool_name = %name,
                    error = %err,
                    "streaming_executor: to_tool_call_request invoked on non-JSON arguments; \
                     callers must gate with is_complete() first"
                );
                debug_assert!(false, "to_tool_call_request must be gated by is_complete()");
                return None;
            }
        };
        Some(ToolCallRequest {
            id: id.clone(),
            name: name.clone(),
            arguments: args,
            thought_signature: None,
        })
    }
}

impl StreamingToolAccumulator {
    /// Create a new accumulator that knows which tools are read-only.
    pub fn new(registry: &ToolRegistry, policy: &ResolvedToolPolicy) -> Self {
        let read_only_tools: std::collections::HashSet<String> = registry
            .tool_names()
            .into_iter()
            .filter(|name| {
                policy.verdict(name) == ToolVerdict::Allow
                    && registry
                        .get(name)
                        .map(|t| t.is_read_only())
                        .unwrap_or(false)
            })
            .collect();

        Self {
            accumulators: HashMap::new(),
            read_only_tools,
            ready_tool_calls: Vec::new(),
            ready_ids: Vec::new(),
        }
    }

    /// Feed a tool call delta from the streaming callback.
    pub fn on_tool_call_delta(&mut self, delta: &ToolCallDelta) {
        let acc = self
            .accumulators
            .entry(delta.index)
            .or_insert_with(ToolCallAccumulator::new);

        if let Some(ref id) = delta.id {
            acc.id = Some(id.clone());
        }
        if let Some(ref name) = delta.name {
            acc.name = Some(name.clone());
        }
        if let Some(ref args) = delta.arguments_delta {
            acc.arguments.push_str(args);
        }

        if !acc.finalized && acc.is_complete() {
            self.try_finalize(delta.index);
        }
    }

    fn try_finalize(&mut self, index: usize) {
        let acc = match self.accumulators.get_mut(&index) {
            Some(a) => a,
            None => return,
        };

        if acc.finalized {
            return;
        }

        let tool_name = match acc.name.as_deref() {
            Some(name) => name,
            None => return,
        };

        if !self.read_only_tools.contains(tool_name) {
            acc.finalized = true;
            return;
        }

        let tc = match acc.to_tool_call_request() {
            Some(tc) => tc,
            None => return,
        };

        acc.finalized = true;
        self.ready_ids.push(tc.id.clone());
        self.ready_tool_calls.push(tc);
    }

    /// Returns IDs of tool calls that were pre-validated during streaming.
    pub fn ready_ids(&self) -> &[String] {
        &self.ready_ids
    }

    /// Returns true if any read-only tool calls are ready for immediate execution.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn has_ready_tools(&self) -> bool {
        !self.ready_tool_calls.is_empty()
    }

    /// Take the pre-validated read-only tool calls (consumes them).
    pub fn take_ready_tool_calls(&mut self) -> Vec<ToolCallRequest> {
        std::mem::take(&mut self.ready_tool_calls)
    }
}

/// Execute pre-validated read-only tool calls concurrently.
///
/// Called after streaming completes. These tools were fully parsed during
/// streaming and are known to be read-only, so they can safely run in parallel.
pub(crate) async fn execute_prevalidated(
    tool_calls: Vec<ToolCallRequest>,
    registry: &ToolRegistry,
    session_id: &str,
    max_tool_use_concurrency: usize,
) -> Vec<StreamedToolResult> {
    if tool_calls.is_empty() {
        return Vec::new();
    }

    info!(
        "[streaming-exec] Executing {} pre-validated read-only tool(s) concurrently",
        tool_calls.len()
    );

    let concurrency_limit = normalize_tool_use_concurrency(max_tool_use_concurrency);
    let mut results = Vec::with_capacity(tool_calls.len());

    for chunk in tool_calls.chunks(concurrency_limit) {
        let futures: Vec<_> = chunk
            .iter()
            .cloned()
            .map(|tc| {
                let tool_ref = registry.get(&tc.name);
                let saved_args = tc.arguments.clone();
                let ctx = crate::tools::call_context::CallContext::new(&tc.id, session_id);
                async move {
                    let result = match tool_ref {
                        Some(tool) => match tool.execute(tc.arguments, &ctx).await {
                            Ok(output) => Ok(output),
                            Err(err) => Err(format!("{}", err)),
                        },
                        None => Err(format!("Tool '{}' not found", tc.name)),
                    };
                    StreamedToolResult {
                        tool_call_id: tc.id,
                        tool_name: tc.name,
                        args: saved_args,
                        result,
                    }
                }
            })
            .collect();

        results.extend(futures::future::join_all(futures).await);
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::traits::{Tool, ToolError};
    use async_trait::async_trait;

    struct FakeReadTool;
    #[async_trait]
    impl Tool for FakeReadTool {
        fn name(&self) -> &str {
            "read_file"
        }
        fn description(&self) -> &str {
            "read"
        }
        fn parameters(&self) -> Value {
            serde_json::json!({"type":"object","properties":{}})
        }
        fn is_read_only(&self) -> bool {
            true
        }
        async fn execute_text(
            &self,
            _params: Value,
            _ctx: &crate::tools::traits::CallContext,
        ) -> Result<String, ToolError> {
            Ok("file_content_here".into())
        }
    }

    struct FakeWriteTool;
    #[async_trait]
    impl Tool for FakeWriteTool {
        fn name(&self) -> &str {
            "edit_file"
        }
        fn description(&self) -> &str {
            "edit"
        }
        fn parameters(&self) -> Value {
            serde_json::json!({"type":"object","properties":{}})
        }
        async fn execute_text(
            &self,
            _params: Value,
            _ctx: &crate::tools::traits::CallContext,
        ) -> Result<String, ToolError> {
            Ok("edited".into())
        }
    }

    struct FakeSearchTool;
    #[async_trait]
    impl Tool for FakeSearchTool {
        fn name(&self) -> &str {
            "code_search"
        }
        fn description(&self) -> &str {
            "search"
        }
        fn parameters(&self) -> Value {
            serde_json::json!({"type":"object","properties":{}})
        }
        fn is_read_only(&self) -> bool {
            true
        }
        async fn execute_text(
            &self,
            _params: Value,
            _ctx: &crate::tools::traits::CallContext,
        ) -> Result<String, ToolError> {
            Ok("search_result".into())
        }
    }

    fn make_registry() -> ToolRegistry {
        let mut reg = ToolRegistry::new();
        reg.register(Box::new(FakeReadTool));
        reg.register(Box::new(FakeWriteTool));
        reg.register(Box::new(FakeSearchTool));
        reg
    }

    fn make_accumulator() -> StreamingToolAccumulator {
        let reg = make_registry();
        let policy = ResolvedToolPolicy::permissive();
        StreamingToolAccumulator::new(&reg, &policy)
    }

    fn feed_complete(
        acc: &mut StreamingToolAccumulator,
        index: usize,
        id: &str,
        name: &str,
        args: &str,
    ) {
        acc.on_tool_call_delta(&ToolCallDelta {
            index,
            id: Some(id.to_string()),
            name: Some(name.to_string()),
            arguments_delta: Some(args.to_string()),
        });
    }

    // --- Accumulator unit tests ---

    #[test]
    fn accumulator_incomplete_without_name() {
        let mut acc = ToolCallAccumulator::new();
        acc.id = Some("tc_1".into());
        acc.arguments = r#"{"path": "/tmp"}"#.into();
        assert!(!acc.is_complete());
    }

    #[test]
    fn accumulator_incomplete_without_valid_json() {
        let mut acc = ToolCallAccumulator::new();
        acc.id = Some("tc_1".into());
        acc.name = Some("read_file".into());
        acc.arguments = r#"{"path": "/tmp"#.into();
        assert!(!acc.is_complete());
    }

    #[test]
    fn accumulator_complete_with_valid_json() {
        let mut acc = ToolCallAccumulator::new();
        acc.id = Some("tc_1".into());
        acc.name = Some("read_file".into());
        acc.arguments = r#"{"path": "/tmp/test.rs"}"#.into();
        assert!(acc.is_complete());
    }

    #[test]
    fn accumulator_to_tool_call_request() {
        let mut acc = ToolCallAccumulator::new();
        acc.id = Some("tc_1".into());
        acc.name = Some("read_file".into());
        acc.arguments = r#"{"path": "/tmp/test.rs"}"#.into();
        let req = acc.to_tool_call_request().unwrap();
        assert_eq!(req.id, "tc_1");
        assert_eq!(req.name, "read_file");
        assert_eq!(req.arguments["path"], "/tmp/test.rs");
    }

    #[test]
    fn empty_args_not_complete() {
        let mut acc = ToolCallAccumulator::new();
        acc.id = Some("tc_1".into());
        acc.name = Some("read_file".into());
        acc.arguments = String::new();
        assert!(!acc.is_complete());
    }

    // --- StreamingToolAccumulator tests ---

    #[test]
    fn write_tool_not_ready() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "edit_file", r#"{"path":"a"}"#);
        assert!(!acc.has_ready_tools());
    }

    #[test]
    fn read_tool_becomes_ready() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "read_file", r#"{"path":"a"}"#);
        assert!(acc.has_ready_tools());
        assert_eq!(acc.ready_ids(), &["tc_1"]);
    }

    #[test]
    fn incremental_args_accumulation() {
        let mut acc = make_accumulator();

        acc.on_tool_call_delta(&ToolCallDelta {
            index: 0,
            id: Some("tc_1".into()),
            name: Some("read_file".into()),
            arguments_delta: Some(r#"{"path""#.into()),
        });
        assert!(!acc.has_ready_tools());

        acc.on_tool_call_delta(&ToolCallDelta {
            index: 0,
            id: None,
            name: None,
            arguments_delta: Some(r#": "/tmp"}"#.into()),
        });
        assert!(acc.has_ready_tools());
    }

    #[test]
    fn unknown_tool_not_ready() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "unknown_tool", r#"{"x":1}"#);
        assert!(!acc.has_ready_tools());
    }

    #[test]
    fn no_double_finalize() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "read_file", r#"{"path":"a"}"#);

        acc.on_tool_call_delta(&ToolCallDelta {
            index: 0,
            id: None,
            name: None,
            arguments_delta: Some("extra".into()),
        });

        assert_eq!(acc.ready_ids().len(), 1);
    }

    #[test]
    fn multiple_read_tools_ready() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "read_file", r#"{"path":"a"}"#);
        feed_complete(&mut acc, 1, "tc_2", "code_search", r#"{"query":"x"}"#);
        assert_eq!(acc.ready_ids().len(), 2);
    }

    #[test]
    fn take_ready_tool_calls_empties_list() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "read_file", r#"{"path":"a"}"#);
        let calls = acc.take_ready_tool_calls();
        assert_eq!(calls.len(), 1);
        assert!(!acc.has_ready_tools());
    }

    #[test]
    fn mixed_read_write_only_reads_ready() {
        let mut acc = make_accumulator();
        feed_complete(&mut acc, 0, "tc_1", "read_file", r#"{"path":"a"}"#);
        feed_complete(&mut acc, 1, "tc_2", "edit_file", r#"{"path":"b"}"#);
        feed_complete(&mut acc, 2, "tc_3", "code_search", r#"{"query":"x"}"#);
        assert_eq!(acc.ready_ids().len(), 2);
        assert!(acc.ready_ids().contains(&"tc_1".to_string()));
        assert!(acc.ready_ids().contains(&"tc_3".to_string()));
    }

    // --- execute_prevalidated async tests ---

    #[tokio::test]
    async fn execute_prevalidated_returns_results() {
        let reg = make_registry();
        let calls = vec![ToolCallRequest {
            id: "tc_1".into(),
            name: "read_file".into(),
            arguments: serde_json::json!({"path": "/tmp/test.rs"}),
            thought_signature: None,
        }];

        let results = execute_prevalidated(calls, &reg, "test-session", 10).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].tool_call_id, "tc_1");
        assert!(results[0].result.is_ok());
        assert_eq!(results[0].result.as_ref().unwrap(), "file_content_here");
    }

    #[tokio::test]
    async fn execute_prevalidated_multiple_concurrent() {
        let reg = make_registry();
        let calls = vec![
            ToolCallRequest {
                id: "tc_1".into(),
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "a"}),
                thought_signature: None,
            },
            ToolCallRequest {
                id: "tc_2".into(),
                name: "code_search".into(),
                arguments: serde_json::json!({"query": "x"}),
                thought_signature: None,
            },
        ];

        let results = execute_prevalidated(calls, &reg, "test-session", 10).await;
        assert_eq!(results.len(), 2);
    }

    #[tokio::test]
    async fn execute_prevalidated_empty_returns_empty() {
        let reg = make_registry();
        let results = execute_prevalidated(Vec::new(), &reg, "test-session", 10).await;
        assert!(results.is_empty());
    }
}
