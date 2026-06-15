//! `BroadcastingHandler` — wraps `UnifiedSubagentHandler` and forwards text
//! summaries of each event into a `broadcast::Sender<String>` plus the
//! per-handle rolling buffer in `BackgroundJobRegistry`. This is what lets
//! `AwaitTool` (`wait_for` / `monitor`) tail background subagent progress
//! without blocking the parent turn loop.

use super::UnifiedSubagentHandler;
use crate::turn_executor::TurnEventHandler;
use async_trait::async_trait;
use serde_json::Value;

pub struct BroadcastingHandler {
    inner: UnifiedSubagentHandler,
    tx: tokio::sync::broadcast::Sender<String>,
    handle: String,
}

impl BroadcastingHandler {
    pub fn new(inner: UnifiedSubagentHandler, tx: tokio::sync::broadcast::Sender<String>) -> Self {
        let handle = inner.config.subagent_session_id.clone();
        Self { inner, tx, handle }
    }

    fn send_line(&self, line: String) {
        let _ = self.tx.send(line.clone());
        super::super::super::coding::exec::registry::push_output_line(&self.handle, line);
    }

    pub fn broadcast_complete(&self) {
        self.inner.broadcast_complete();
    }

    pub fn broadcast_error(&self) {
        self.inner.broadcast_error();
    }
}

#[async_trait]
impl TurnEventHandler for BroadcastingHandler {
    fn on_message_delta(&self, session_id: &str, content: &str) {
        self.inner.on_message_delta(session_id, content);
        self.send_line(content.to_string());
    }

    fn on_thinking_delta(&self, session_id: &str, thinking: &str) {
        self.inner.on_thinking_delta(session_id, thinking);
    }

    fn on_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        args: &Value,
    ) {
        self.inner
            .on_tool_call(session_id, tool_call_id, tool_name, display_name, args);
        self.send_line(format!("[tool_call] {} {}\n", display_name, tool_call_id));
    }

    fn on_tool_result(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
    ) {
        self.on_tool_result_with_metadata(
            session_id,
            tool_call_id,
            tool_name,
            display_name,
            result,
            None,
        );
    }

    fn on_tool_result_with_metadata(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
        ui_metadata: Option<&crate::tools::traits::ToolUIMetadata>,
    ) {
        self.inner.on_tool_result_with_metadata(
            session_id,
            tool_call_id,
            tool_name,
            display_name,
            result,
            ui_metadata,
        );
        let preview: String = crate::utils::safe_truncate_chars_to_string(&result, 200);
        self.send_line(format!("[tool_result] {} → {}\n", display_name, preview));
    }

    fn on_assistant_iteration_complete(
        &self,
        session_id: &str,
        content: Option<&str>,
        has_tool_calls: bool,
        model: &str,
    ) {
        self.inner
            .on_assistant_iteration_complete(session_id, content, has_tool_calls, model);
    }
}
