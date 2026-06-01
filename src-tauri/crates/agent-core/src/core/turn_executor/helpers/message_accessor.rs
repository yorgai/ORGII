//! Read-only typed accessors over OpenAI-compat message JSON.
//!
//! All message history in agent-core uses OpenAI-compat JSON format:
//!   { "role": "assistant", "content": "...", "tool_calls": [...] }
//!
//! Do NOT access these fields with raw JSON indexing outside the
//! message-writer helpers. Use these accessors instead so any future
//! format migration (e.g. adding Anthropic-native fallback paths) has a
//! single choke point.

use serde_json::Value;

/// Return the `role` string of a message, or `""` if absent.
pub fn msg_role(msg: &Value) -> &str {
    msg.get("role").and_then(Value::as_str).unwrap_or("")
}

/// Return the `content` string of an assistant message, or `None` if absent
/// or not a string (e.g. `null` for pure tool-use turns).
fn msg_content_str(msg: &Value) -> Option<&str> {
    msg.get("content").and_then(Value::as_str)
}

/// Return the `tool_calls` array of a message, or `None` if absent or not
/// an array.
pub fn msg_tool_calls(msg: &Value) -> Option<&Vec<Value>> {
    msg.get("tool_calls").and_then(Value::as_array)
}

/// Walk `messages` backwards and return the most recent non-empty
/// assistant text content. Falls back to an earlier assistant turn's
/// text when the terminal assistant message is a pure tool_use block
/// with no text.
///
/// This is the fix for the "Agent 'Explore' completed but produced no text
/// response." symptom: when the final LLM iteration emits `finish_reason=stop`
/// with empty content (common for exploration-style agents after a
/// tool-heavy penultimate turn), `final_content` becomes `None`. Without a
/// backtrack, the subagent tool result is a bare fallback string and the
/// parent agent loses the narration the subagent actually produced in
/// earlier iterations (e.g. "I'll explore..." / "Good — lots of test
/// modules...").
///
/// Semantics:
///   - Only extract `role == "assistant"` messages.
///   - Skip messages whose `content` is `null`/missing/empty (pure tool_use
///     turns) or whose content string is empty.
///   - Return the **first** non-empty hit walking from tail to head.
pub fn last_assistant_text(messages: &[Value]) -> Option<String> {
    for msg in messages.iter().rev() {
        if msg_role(msg) != "assistant" {
            continue;
        }
        if let Some(text) = msg_content_str(msg) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant_with_text(text: &str) -> Value {
        serde_json::json!({ "role": "assistant", "content": text })
    }

    fn assistant_pure_tool_use() -> Value {
        serde_json::json!({
            "role": "assistant",
            "content": Value::Null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": { "name": "read_file", "arguments": "{}" }
            }]
        })
    }

    #[test]
    fn last_assistant_text_returns_last_when_terminal_has_text() {
        let messages = vec![
            assistant_with_text("first"),
            serde_json::json!({ "role": "user", "content": "anything" }),
            assistant_with_text("second"),
            assistant_with_text("third"),
        ];
        assert_eq!(last_assistant_text(&messages), Some("third".to_string()));
    }

    #[test]
    fn last_assistant_text_skips_terminal_pure_tool_use() {
        let messages = vec![
            assistant_with_text("I'll explore the project structure"),
            assistant_pure_tool_use(),
            serde_json::json!({ "role": "tool", "tool_call_id": "call_1", "content": "..." }),
            assistant_pure_tool_use(),
        ];
        assert_eq!(
            last_assistant_text(&messages),
            Some("I'll explore the project structure".to_string())
        );
    }

    #[test]
    fn last_assistant_text_skips_empty_content_string() {
        let messages = vec![
            assistant_with_text("real narration"),
            serde_json::json!({ "role": "assistant", "content": "" }),
        ];
        assert_eq!(
            last_assistant_text(&messages),
            Some("real narration".to_string())
        );
    }

    #[test]
    fn last_assistant_text_returns_none_when_no_assistant_text_anywhere() {
        let messages = vec![
            serde_json::json!({ "role": "user", "content": "hi" }),
            assistant_pure_tool_use(),
            serde_json::json!({ "role": "tool", "tool_call_id": "call_1", "content": "..." }),
        ];
        assert_eq!(last_assistant_text(&messages), None);
    }

    #[test]
    fn last_assistant_text_ignores_user_and_tool_roles() {
        let messages = vec![
            serde_json::json!({ "role": "user", "content": "decoy user text" }),
            serde_json::json!({ "role": "tool", "tool_call_id": "x", "content": "decoy tool" }),
            assistant_with_text("the real one"),
            serde_json::json!({ "role": "user", "content": "trailing user" }),
        ];
        assert_eq!(
            last_assistant_text(&messages),
            Some("the real one".to_string())
        );
    }
}
