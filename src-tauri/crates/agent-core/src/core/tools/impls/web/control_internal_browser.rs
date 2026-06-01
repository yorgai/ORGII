//! Agent-facing internal browser tool stub.
//!
//! Frontend/Tauri inline webview commands remain available through their
//! runtime command surfaces. Agents must use `control_external_browser` for
//! browser automation until internal browser automation is implemented for the
//! agent tool runtime.

use async_trait::async_trait;
use serde_json::Value;

use crate::tools::categories as tool_categories;
use crate::tools::names as tool_names;
use crate::tools::traits::{Tool, ToolError};

const INTERNAL_BROWSER_UNAVAILABLE_MESSAGE: &str = "Internal browser automation is currently unavailable to agents. Use control_external_browser for browser automation, or ask the user to use the Workstation Browser UI.";

pub struct InternalBrowserTool;

impl InternalBrowserTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for InternalBrowserTool {
    fn name(&self) -> &str {
        tool_names::CONTROL_INTERNAL_BROWSER
    }

    fn category(&self) -> &str {
        tool_categories::WEB
    }

    fn description(&self) -> &str {
        INTERNAL_BROWSER_UNAVAILABLE_MESSAGE
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
    }

    async fn execute_text(&self, _params: Value) -> Result<String, ToolError> {
        Err(ToolError::ExecutionFailed(
            INTERNAL_BROWSER_UNAVAILABLE_MESSAGE.to_string(),
        ))
    }
}
