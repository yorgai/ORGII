//! Free helpers for [`UnifiedEventHandler`].
//!
//! - [`tool_status_preview_from_args`] — short, human-readable preview
//!   string derived from a tool call's arguments. Used to populate
//!   activity-feed previews shown to the user during desktop tool runs.
//! - [`parse_hook_decision`] — parses `.orgii/hooks.json` PreToolUse hook
//!   stdout into a [`ToolHookIntervention`]. Returns `None` for empty
//!   or non-actionable output (backward compatible with hooks that
//!   echo logs to stdout). Re-exported from `event_handler::mod` so
//!   external test imports stay unchanged.

use serde::Deserialize;
use serde_json::Value;

use crate::tools::names as tool_names;
use crate::turn_executor::ToolHookIntervention;

/// Builds a short preview string for the activity feed from a tool
/// name + its raw `args` JSON. Falls back to the tool name when args
/// don't carry obvious user-visible content.
pub(super) fn tool_status_preview_from_args(tool_name: &str, args: &Value) -> String {
    let raw = match tool_name {
        tool_names::CONTROL_DESKTOP_WITH_PEEKABOO => args
            .get("command")
            .and_then(|value| value.as_str())
            .map(|command| format!("peekaboo {}", command))
            .unwrap_or_else(|| "peekaboo".to_string()),
        other => {
            let command = args
                .get("command")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if !command.is_empty() {
                command.chars().take(60).collect()
            } else {
                other.to_string()
            }
        }
    };

    raw.chars().take(80).collect()
}

/// Structured decision from a PreToolUse hook's stdout.
#[derive(Deserialize)]
struct HookDecision {
    decision: Option<String>,
    message: Option<String>,
    updated_input: Option<Value>,
}

/// Parse hook stdout as a JSON `HookDecision`. Returns `None` if stdout is not
/// valid JSON or does not contain an actionable decision (backward compatible).
pub fn parse_hook_decision(stdout: &str) -> Option<ToolHookIntervention> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    let decision: HookDecision = match serde_json::from_str(trimmed) {
        Ok(d) => d,
        Err(err) => {
            tracing::error!(
                "[hook] Failed to parse hook stdout as JSON (blocking tool call for safety): {}. \
                 Raw output: {}",
                err,
                &trimmed[..trimmed.len().min(200)]
            );
            return Some(ToolHookIntervention {
                block: true,
                block_reason: Some(format!(
                    "Hook returned malformed JSON (parse error: {}). Blocking tool call for safety.",
                    err
                )),
                modified_params: None,
            });
        }
    };
    match decision.decision.as_deref() {
        Some("deny") => Some(ToolHookIntervention {
            block: true,
            block_reason: Some(
                decision
                    .message
                    .unwrap_or_else(|| "Blocked by hook".to_string()),
            ),
            modified_params: None,
        }),
        Some("allow") => {
            if decision.updated_input.is_some() {
                Some(ToolHookIntervention {
                    block: false,
                    block_reason: None,
                    modified_params: decision.updated_input,
                })
            } else {
                None
            }
        }
        _ => {
            if decision.updated_input.is_some() {
                Some(ToolHookIntervention {
                    block: false,
                    block_reason: None,
                    modified_params: decision.updated_input,
                })
            } else {
                None
            }
        }
    }
}
