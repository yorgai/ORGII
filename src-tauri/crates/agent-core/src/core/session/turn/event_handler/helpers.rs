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
                crate::utils::safe_truncate_chars(command, 60).to_string()
            } else {
                other.to_string()
            }
        }
    };

    crate::utils::safe_truncate_chars(raw, 80).to_string()
}

/// Structured decision from a PreToolUse hook's stdout.
#[derive(Deserialize)]
struct HookDecision {
    decision: Option<String>,
    message: Option<String>,
    updated_input: Option<Value>,
}

/// Extract partial `title` / `content` from a streaming, incomplete
/// `create_plan` arguments JSON buffer.
///
/// `title` is only returned once its closing quote has arrived (a half
/// title flickering in the card header is worse than a short delay).
/// `content` is returned as-is up to the end of the buffer — trailing
/// escape fragments are trimmed. Both use prefix matching, not a JSON
/// parser, because the buffer is syntactically incomplete during the
/// entire stream.
pub(super) fn parse_partial_plan_args(buf: &str) -> (Option<String>, Option<String>) {
    let title = extract_complete_string_field(buf, "title");
    let content = extract_partial_string_field(buf, "content");
    (title, content)
}

fn field_value_start(buf: &str, field: &str) -> Option<usize> {
    let needle = format!("\"{field}\"");
    let key_pos = buf.find(&needle)?;
    let after_key = &buf[key_pos + needle.len()..];
    let colon = after_key.find(':')?;
    let after_colon = &after_key[colon + 1..];
    let quote = after_colon.find('"')?;
    Some(key_pos + needle.len() + colon + 1 + quote + 1)
}

/// JSON-string-unescape `raw` up to its closing quote (or end of buffer).
/// Returns `(decoded, closed)`.
fn decode_json_string_prefix(raw: &str) -> (String, bool) {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(character) = chars.next() {
        match character {
            '"' => return (out, true),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('/') => out.push('/'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    if let Ok(code) = u32::from_str_radix(&hex, 16) {
                        if let Some(decoded) = char::from_u32(code) {
                            out.push(decoded);
                        }
                    }
                }
                // Trailing lone backslash (escape split across deltas) —
                // drop it; the next delta completes it.
                None => break,
                Some(other) => out.push(other),
            },
            other => out.push(other),
        }
    }
    (out, false)
}

fn extract_complete_string_field(buf: &str, field: &str) -> Option<String> {
    let start = field_value_start(buf, field)?;
    let (decoded, closed) = decode_json_string_prefix(&buf[start..]);
    closed.then_some(decoded)
}

fn extract_partial_string_field(buf: &str, field: &str) -> Option<String> {
    let start = field_value_start(buf, field)?;
    let (decoded, _closed) = decode_json_string_prefix(&buf[start..]);
    (!decoded.is_empty()).then_some(decoded)
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

#[cfg(test)]
mod plan_args_tests {
    use super::parse_partial_plan_args;

    #[test]
    fn title_only_returned_when_closed() {
        let (title, content) = parse_partial_plan_args(r#"{"title":"My Pl"#);
        assert_eq!(title, None);
        assert_eq!(content, None);

        let (title, content) = parse_partial_plan_args(r#"{"title":"My Plan","#);
        assert_eq!(title.as_deref(), Some("My Plan"));
        assert_eq!(content, None);
    }

    #[test]
    fn content_streams_incrementally_with_unescaping() {
        let buf = r##"{"title":"Plan","content":"# Heading\n\nFirst li"##;
        let (title, content) = parse_partial_plan_args(buf);
        assert_eq!(title.as_deref(), Some("Plan"));
        assert_eq!(content.as_deref(), Some("# Heading\n\nFirst li"));
    }

    #[test]
    fn trailing_split_escape_is_dropped() {
        let buf = r#"{"content":"line\"#;
        let (_, content) = parse_partial_plan_args(buf);
        assert_eq!(content.as_deref(), Some("line"));
    }

    #[test]
    fn closed_content_stops_at_quote() {
        let buf = r#"{"content":"done","title":"After"}"#;
        let (title, content) = parse_partial_plan_args(buf);
        assert_eq!(content.as_deref(), Some("done"));
        assert_eq!(title.as_deref(), Some("After"));
    }

    #[test]
    fn missing_fields_return_none() {
        assert_eq!(parse_partial_plan_args("{"), (None, None));
        assert_eq!(parse_partial_plan_args(""), (None, None));
    }
}
