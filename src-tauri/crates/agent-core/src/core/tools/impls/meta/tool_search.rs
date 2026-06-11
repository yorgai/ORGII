//! `tool_search` — discover deferred (OnDemand) tools by keyword.
//!
//! When the agent needs a capability that isn't in its current tool set,
//! it calls `tool_search` with a query. The tool searches through all
//! deferred tools' names and descriptions and returns matches.

use std::sync::Arc;

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::tools::registry::ToolRegistry;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError, ToolPriority};

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ToolSearchParams {
    /// Search query — matches against tool names and descriptions.
    /// Use descriptive terms like "database", "image", "browser", etc.
    pub query: String,
}

/// Meta-tool that searches deferred (OnDemand) tools by keyword.
///
/// This enables a two-tier tool loading strategy: core tools are always
/// available, while specialized tools are deferred until the agent
/// explicitly discovers them via this search.
pub struct ToolSearchTool {
    registry: Arc<ToolRegistry>,
}

impl ToolSearchTool {
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl Tool for ToolSearchTool {
    fn name(&self) -> &str {
        crate::tools::names::TOOL_SEARCH
    }

    fn description(&self) -> &str {
        "Search for additional tools not currently loaded. Returns matching tool names and descriptions."
    }

    fn category(&self) -> &str {
        crate::tools::categories::META
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn priority(&self) -> ToolPriority {
        ToolPriority::Always
    }

    fn parameters(&self) -> Value {
        params_schema::<ToolSearchParams>()
    }

    async fn execute_text(
        &self,
        params: Value,
        _ctx: &crate::tools::traits::CallContext,
    ) -> Result<String, ToolError> {
        let params: ToolSearchParams = parse_params(params)?;
        let query = params.query.trim();

        if query.is_empty() {
            let all_deferred = self.registry.deferred_tool_names();
            if all_deferred.is_empty() {
                return Ok("No deferred tools available.".to_string());
            }
            return Ok(format!(
                "All deferred tools ({}):\n{}",
                all_deferred.len(),
                all_deferred
                    .iter()
                    .map(|name| format!("  - {}", name))
                    .collect::<Vec<_>>()
                    .join("\n")
            ));
        }

        let matches = self.registry.search_deferred(query);

        if matches.is_empty() {
            Ok(format!(
                "No tools found matching '{}'. Try a broader query.",
                query
            ))
        } else {
            let mut output = format!("Found {} tool(s) matching '{}':\n\n", matches.len(), query);
            for (name, description) in &matches {
                output.push_str(&format!("**{}**: {}\n", name, description));
            }
            output.push_str(
                "\nTo use a deferred tool, call it by name as usual — it will be loaded automatically.",
            );
            Ok(output)
        }
    }
}
