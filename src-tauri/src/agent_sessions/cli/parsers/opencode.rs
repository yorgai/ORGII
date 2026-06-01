//! OpenCode CLI ACP (Agent Client Protocol) integration.
//!
//! Thin wrapper over `acp_common` with OpenCode-specific tool mapping.
//! OpenCode's `opencode acp` command speaks standard ACP over stdin/stdout.

use serde_json::Value;
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::mpsc;

use super::acp_common::{self, AcpAgentAdapter, AcpSessionResult};
use core_types::activity::ActivityChunk;

/// OpenCode adapter — maps OpenCode tool names to Cursor-normalized names.
pub(crate) struct OpenCodeAdapter;

impl AcpAgentAdapter for OpenCodeAdapter {
    fn map_tool_kind(&self, kind: &str, raw_input: &Value) -> String {
        let name = raw_input
            .get("name")
            .or(raw_input.get("tool"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match name {
            "write" | "Write" => return "Edit".to_string(),
            "read" | "Read" => return "Read".to_string(),
            "bash" | "Bash" | "execute" => return "Shell".to_string(),
            "grep" | "Grep" => return "Grep".to_string(),
            "glob" | "Glob" => return "Glob".to_string(),
            "fetch" | "Fetch" | "WebFetch" => return "WebFetch".to_string(),
            "TodoWrite" => return "UpdateTodos".to_string(),
            _ => {}
        }

        match kind {
            "execute" => "Shell",
            "read" => "Read",
            "write" | "edit" => "Edit",
            "search" => "Grep",
            "delete" => "Delete",
            "fetch" => "WebFetch",
            "other" => "Task",
            _ => kind,
        }
        .to_string()
    }
}

/// Run the ACP protocol with OpenCode CLI.
#[allow(clippy::too_many_arguments)]
pub async fn run_acp_protocol(
    stdin: ChildStdin,
    stdout: ChildStdout,
    session_id: &str,
    task: &str,
    working_dir: &str,
    resume_session_id: Option<&str>,
    chunk_tx: mpsc::Sender<ActivityChunk>,
    image_paths: Vec<String>,
) -> Result<AcpSessionResult, String> {
    acp_common::run_acp_protocol(
        OpenCodeAdapter,
        stdin,
        stdout,
        session_id,
        task,
        working_dir,
        resume_session_id,
        chunk_tx,
        image_paths,
    )
    .await
}

#[cfg(test)]
#[path = "tests/opencode_tests.rs"]
mod tests;
