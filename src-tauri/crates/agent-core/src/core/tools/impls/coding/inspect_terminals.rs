//! Terminal inspection and control tool.
//!
//! Provides Rust agents with bounded access to ORGII-managed PTY sessions.

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use terminal::agent_tool::{close_session, write_to_session};
use terminal::pty_commands::pty::{PtyInfo, PtySession};

use crate::tools::names as tool_names;
use crate::tools::registration::PtySessions;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError};

const DEFAULT_READ_CHARS: usize = 20_000;
const MAX_READ_CHARS: usize = 80_000;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum InspectTerminalsParams {
    /// List all live ORGII-managed PTY sessions.
    List,
    /// Read a bounded, redacted snapshot of recent output from one terminal.
    ReadOutput {
        /// Terminal session ID returned by `list`.
        session_id: String,
        /// Maximum number of trailing characters to return. Defaults to 20,000 and is capped at 80,000.
        #[serde(default)]
        max_chars: Option<usize>,
    },
    /// Write raw input into a terminal session.
    WriteInput {
        /// Terminal session ID returned by `list`.
        session_id: String,
        /// Text or control characters to write to the PTY. Use `\r` to press Enter.
        input: String,
    },
    /// Close a terminal session by dropping its PTY.
    Close {
        /// Terminal session ID returned by `list`.
        session_id: String,
    },
}

#[derive(Debug, Serialize)]
struct TerminalOutputSnapshot {
    session_id: String,
    redacted: bool,
    truncated: bool,
    chars_returned: usize,
    output: String,
}

#[derive(Debug, Serialize)]
struct TerminalActionResult {
    session_id: String,
    status: &'static str,
}

pub struct InspectTerminalsTool {
    sessions: PtySessions,
}

impl InspectTerminalsTool {
    pub fn new(sessions: PtySessions) -> Self {
        Self { sessions }
    }

    fn info_from_session(session_id: &str, session: &PtySession) -> PtyInfo {
        PtyInfo {
            session_id: session_id.to_string(),
            pid: session.pid,
            shell: session.shell.clone(),
            shell_kind: session.shell_kind.clone(),
            cwd: session.cwd.clone(),
            name: session.name.clone(),
            created_at: session.created_at,
            last_output_at: session
                .last_output_at
                .lock()
                .expect("last_output_at mutex poisoned")
                .clone(),
            has_output_tap: session.output_tap.is_some(),
            unacked_bytes: session
                .unacked_bytes
                .load(std::sync::atomic::Ordering::Relaxed),
            redacted_output_chars: session
                .redacted_output
                .lock()
                .expect("redacted_output mutex poisoned")
                .chars()
                .count(),
        }
    }

    fn trailing_chars(text: &str, max_chars: usize) -> (String, bool) {
        let char_count = text.chars().count();
        if char_count <= max_chars {
            return (text.to_string(), false);
        }
        (text.chars().skip(char_count - max_chars).collect(), true)
    }
}

#[async_trait]
impl Tool for InspectTerminalsTool {
    fn name(&self) -> &str {
        tool_names::INSPECT_TERMINALS
    }

    fn description(&self) -> &str {
        "Inspect and control live ORGII-managed terminal sessions."
    }

    fn category(&self) -> &str {
        crate::tools::categories::CODING
    }

    fn parameters(&self) -> Value {
        params_schema::<InspectTerminalsParams>()
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let params: InspectTerminalsParams = parse_params(params)?;

        match params {
            InspectTerminalsParams::List => {
                let sessions = self.sessions.lock().await;
                let mut terminal_infos = sessions
                    .iter()
                    .map(|(session_id, session)| Self::info_from_session(session_id, session))
                    .collect::<Vec<_>>();
                terminal_infos.sort_by(|left, right| left.session_id.cmp(&right.session_id));

                serde_json::to_string_pretty(&terminal_infos).map_err(|err| {
                    ToolError::ExecutionFailed(format!("Failed to serialize terminals: {err}"))
                })
            }
            InspectTerminalsParams::ReadOutput {
                session_id,
                max_chars,
            } => {
                let max_chars = max_chars.unwrap_or(DEFAULT_READ_CHARS).min(MAX_READ_CHARS);
                let sessions = self.sessions.lock().await;
                let session = sessions.get(&session_id).ok_or_else(|| {
                    ToolError::ExecutionFailed(format!("Terminal session not found: {session_id}"))
                })?;
                let redacted_output = session
                    .redacted_output
                    .lock()
                    .expect("redacted_output mutex poisoned")
                    .clone();
                drop(sessions);

                let (output, truncated) = Self::trailing_chars(&redacted_output, max_chars);
                let snapshot = TerminalOutputSnapshot {
                    session_id,
                    redacted: true,
                    truncated,
                    chars_returned: output.chars().count(),
                    output,
                };

                serde_json::to_string_pretty(&snapshot).map_err(|err| {
                    ToolError::ExecutionFailed(format!(
                        "Failed to serialize terminal output: {err}"
                    ))
                })
            }
            InspectTerminalsParams::WriteInput { session_id, input } => {
                write_to_session(&session_id, &input, self.sessions.clone())
                    .await
                    .map_err(ToolError::ExecutionFailed)?;
                serde_json::to_string_pretty(&TerminalActionResult {
                    session_id,
                    status: "input_written",
                })
                .map_err(|err| {
                    ToolError::ExecutionFailed(format!("Failed to serialize write result: {err}"))
                })
            }
            InspectTerminalsParams::Close { session_id } => {
                close_session(&session_id, self.sessions.clone())
                    .await
                    .map_err(ToolError::ExecutionFailed)?;
                serde_json::to_string_pretty(&TerminalActionResult {
                    session_id,
                    status: "closed",
                })
                .map_err(|err| {
                    ToolError::ExecutionFailed(format!("Failed to serialize close result: {err}"))
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailing_chars_reports_truncation() {
        let (output, truncated) = InspectTerminalsTool::trailing_chars("abcdef", 3);
        assert_eq!(output, "def");
        assert!(truncated);
    }

    #[test]
    fn trailing_chars_keeps_short_output() {
        let (output, truncated) = InspectTerminalsTool::trailing_chars("abc", 3);
        assert_eq!(output, "abc");
        assert!(!truncated);
    }
}
