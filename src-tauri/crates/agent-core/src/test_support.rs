//! Test fixtures specific to `agent_core`.
//!
//! Anything here builds on top of agent_core's own surfaces — `Tool`,
//! `ToolRegistry`, `ToolCallRequest`, `TurnEventHandler`, message JSON for
//! the model-context layer — so it lives next to the code under test
//! rather than in the workspace-shared `test_helpers` crate.
//!
//! Generic helpers (`install_crypto_provider_for_tests`,
//! `temp_dir_with_files`, sandbox guards) stay in `crate::test_utils` /
//! `test_helpers`; this module is the agent_core-flavored layer above
//! them.

use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, Once};

/// Install the `ring` rustls crypto provider exactly once per test process.
///
/// The workspace `reqwest` is built with `rustls-no-provider`, so any test
/// that constructs a `reqwest::Client` (directly, or indirectly via
/// `create_optimized_client` / `WebSearchTool::new`) panics with
/// `"No provider set"` unless a crypto provider has been installed. The
/// production binary installs it in `lib.rs::run`; tests need this
/// one-shot bootstrap. Idempotent and cheap to call repeatedly.
pub fn install_crypto_provider_for_tests() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    });
}

// ============================================
// Message Builders
// ============================================

pub fn user_msg(content: &str) -> Value {
    json!({"role": "user", "content": content})
}

pub fn assistant_msg(content: &str) -> Value {
    json!({"role": "assistant", "content": content})
}

pub fn tool_msg(name: &str, content: &str) -> Value {
    json!({"role": "tool", "name": name, "content": content})
}

pub fn assistant_with_tool_calls(content: &str, calls: Vec<Value>) -> Value {
    json!({"role": "assistant", "content": content, "tool_calls": calls})
}

// ============================================
// Fake Tools for Testing
// ============================================

use crate::tools::traits::{Tool, ToolError, ToolUIMetadata};

/// A configurable fake tool for testing.
pub struct FakeTool {
    name: String,
    description: String,
    is_read_only: bool,
    result: String,
    parameters: Value,
    ui_metadata: Option<ToolUIMetadata>,
}

impl FakeTool {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            description: format!("Fake {} tool", name),
            is_read_only: false,
            result: "ok".to_string(),
            parameters: json!({"type": "object", "properties": {}}),
            ui_metadata: None,
        }
    }

    pub fn with_description(mut self, desc: &str) -> Self {
        self.description = desc.to_string();
        self
    }

    pub fn read_only(mut self, is_read_only: bool) -> Self {
        self.is_read_only = is_read_only;
        self
    }

    pub fn with_result(mut self, result: &str) -> Self {
        self.result = result.to_string();
        self
    }
}

#[async_trait]
impl Tool for FakeTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn parameters(&self) -> Value {
        self.parameters.clone()
    }

    fn is_read_only(&self) -> bool {
        self.is_read_only
    }

    async fn execute_text(
        &self,
        _params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        if self.result.starts_with("Error:") {
            Err(ToolError::ExecutionFailed(self.result.clone()))
        } else {
            Ok(self.result.clone())
        }
    }

    fn ui_metadata(&self, _params: &Value, _result: &str) -> Option<ToolUIMetadata> {
        self.ui_metadata.clone()
    }
}

/// Create a fake read-only tool (e.g., read_file, code_search).
pub fn fake_read_tool(name: &str) -> FakeTool {
    FakeTool::new(name).read_only(true)
}

/// Create a fake write tool (e.g., edit_file, apply_patch).
pub fn fake_write_tool(name: &str) -> FakeTool {
    FakeTool::new(name).read_only(false)
}

// ============================================
// Tool Call Request Helpers
// ============================================

use crate::providers::traits::ToolCallRequest;

/// Create a minimal ToolCallRequest for testing.
pub fn tool_call(name: &str, id: &str) -> ToolCallRequest {
    ToolCallRequest {
        id: id.to_string(),
        name: name.to_string(),
        arguments: json!({}),
        thought_signature: None,
    }
}

// ============================================
// Registry Helpers
// ============================================

use crate::tools::registry::ToolRegistry;

/// Create a ToolRegistry with common fake tools pre-registered.
pub fn test_registry() -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    registry.register(Box::new(fake_read_tool("read_file")));
    registry.register(Box::new(fake_write_tool("edit_file")));
    registry.register(Box::new(fake_read_tool("code_search")));
    registry
}

// ============================================
// Mock Event Handler
// ============================================

use crate::turn_executor::{ToolHookIntervention, TurnEventHandler};

/// A mock TurnEventHandler that records all events for assertion.
pub struct MockEventHandler {
    pub tool_calls: Arc<Mutex<Vec<(String, String, Value)>>>,
    pub tool_execute_starts: Arc<Mutex<Vec<(String, String, Value)>>>,
    pub tool_results: Arc<Mutex<Vec<(String, String, String)>>>,
    pub message_deltas: Arc<Mutex<Vec<String>>>,
    pub modified_params: Arc<Mutex<Option<Value>>>,
    #[allow(clippy::type_complexity)]
    pub assistant_iterations: Arc<Mutex<Vec<(Option<String>, bool, String)>>>,
}

impl MockEventHandler {
    pub fn new() -> Self {
        Self {
            tool_calls: Arc::new(Mutex::new(Vec::new())),
            tool_execute_starts: Arc::new(Mutex::new(Vec::new())),
            tool_results: Arc::new(Mutex::new(Vec::new())),
            message_deltas: Arc::new(Mutex::new(Vec::new())),
            modified_params: Arc::new(Mutex::new(None)),
            assistant_iterations: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn assistant_iteration_count(&self) -> usize {
        self.assistant_iterations.lock().unwrap().len()
    }

    pub fn assistant_iteration_contents(&self) -> Vec<Option<String>> {
        self.assistant_iterations
            .lock()
            .unwrap()
            .iter()
            .map(|(c, _, _)| c.clone())
            .collect()
    }

    pub fn with_modified_params(self, params: Value) -> Self {
        *self.modified_params.lock().unwrap() = Some(params);
        self
    }
}

impl Default for MockEventHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl TurnEventHandler for MockEventHandler {
    fn on_message_delta(&self, _session_id: &str, content: &str) {
        self.message_deltas
            .lock()
            .unwrap()
            .push(content.to_string());
    }

    fn on_tool_call(
        &self,
        _session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        _display_name: &str,
        args: &Value,
    ) {
        self.tool_calls.lock().unwrap().push((
            tool_name.to_string(),
            tool_call_id.to_string(),
            args.clone(),
        ));
    }

    fn on_tool_execute_start(
        &self,
        _session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        args: &Value,
    ) {
        self.tool_execute_starts.lock().unwrap().push((
            tool_name.to_string(),
            tool_call_id.to_string(),
            args.clone(),
        ));
    }

    fn on_tool_result(
        &self,
        _session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        _display_name: &str,
        result: &str,
    ) {
        self.tool_results.lock().unwrap().push((
            tool_name.to_string(),
            tool_call_id.to_string(),
            result.to_string(),
        ));
    }

    async fn before_tool_execute(
        &self,
        _session_id: &str,
        _tool_name: &str,
        _args: &Value,
    ) -> Option<ToolHookIntervention> {
        self.modified_params
            .lock()
            .unwrap()
            .clone()
            .map(|modified_params| ToolHookIntervention {
                block: false,
                block_reason: None,
                modified_params: Some(modified_params),
            })
    }

    fn on_assistant_iteration_complete(
        &self,
        _session_id: &str,
        content: Option<&str>,
        has_tool_calls: bool,
        model: &str,
    ) {
        self.assistant_iterations.lock().unwrap().push((
            content.map(|s| s.to_string()),
            has_tool_calls,
            model.to_string(),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fake_tool_builder_pattern() {
        let tool = FakeTool::new("test")
            .with_description("Test tool")
            .read_only(true)
            .with_result("success");

        assert_eq!(tool.name(), "test");
        assert_eq!(tool.description(), "Test tool");
        assert!(tool.is_read_only());
    }

    #[test]
    fn test_registry_has_common_tools() {
        let registry = test_registry();
        assert!(registry.get("read_file").is_some());
        assert!(registry.get("edit_file").is_some());
        assert!(registry.get("code_search").is_some());
    }

    #[test]
    fn tool_call_helper() {
        let tc = tool_call("read_file", "call-1");
        assert_eq!(tc.name, "read_file");
        assert_eq!(tc.id, "call-1");
    }

    #[test]
    fn mock_records_assistant_iterations() {
        let handler = MockEventHandler::new();
        handler.on_assistant_iteration_complete(
            "sess-1",
            Some("thinking about the file..."),
            true,
            "claude-sonnet-4-5",
        );
        handler.on_assistant_iteration_complete(
            "sess-1",
            Some("now reading the contents..."),
            true,
            "claude-sonnet-4-5",
        );
        handler.on_assistant_iteration_complete(
            "sess-1",
            Some("done; the root cause is X."),
            false,
            "claude-sonnet-4-5",
        );

        assert_eq!(handler.assistant_iteration_count(), 3);
        let contents = handler.assistant_iteration_contents();
        assert_eq!(contents[0].as_deref(), Some("thinking about the file..."));
        assert_eq!(contents[1].as_deref(), Some("now reading the contents..."));
        assert_eq!(contents[2].as_deref(), Some("done; the root cause is X."));
    }

    #[test]
    fn message_builders_produce_valid_json() {
        let user = user_msg("hello");
        assert_eq!(user["role"], "user");
        assert_eq!(user["content"], "hello");

        let assistant = assistant_msg("hi");
        assert_eq!(assistant["role"], "assistant");

        let tool = tool_msg("read_file", "content here");
        assert_eq!(tool["role"], "tool");
        assert_eq!(tool["name"], "read_file");
    }
}
