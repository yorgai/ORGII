//! Chunk Consolidation
//!
//! Merges streaming thinking deltas and message deltas into single events.
//! Rust port of TypeScript `consolidateChunks.ts`.
//!
//! Uses dual accumulators so interleaved thinking + message streams
//! (e.g. from Copilot ACP) are handled correctly.

use std::collections::HashSet;

use chrono::DateTime;

use crate::agent_sessions::event_pipeline::ingestion::types::RawActivityChunk;

// ============================================================================
// Public API
// ============================================================================

/// Consolidate raw chunks: filter empty, merge thinking deltas, merge message
/// deltas, and deduplicate assistant messages.
pub fn consolidate_activity_chunks(chunks: &[RawActivityChunk]) -> Vec<RawActivityChunk> {
    // Step 0: filter empty/invalid
    let valid: Vec<&RawActivityChunk> = chunks.iter().filter(|c| !is_empty_chunk(c)).collect();
    if valid.is_empty() {
        return Vec::new();
    }

    let mut output: Vec<RawActivityChunk> = Vec::with_capacity(valid.len());
    let mut thinking_group: Vec<&RawActivityChunk> = Vec::new();
    let mut message_group: Vec<&RawActivityChunk> = Vec::new();

    let flush_thinking = |out: &mut Vec<RawActivityChunk>, group: &mut Vec<&RawActivityChunk>| {
        if group.is_empty() {
            return;
        }
        group.sort_by(|a, b| {
            let ta = a.created_at.as_deref().unwrap_or("");
            let tb = b.created_at.as_deref().unwrap_or("");
            ta.cmp(tb)
        });

        let content: String = group
            .iter()
            .copied()
            .map(extract_thinking_content)
            .collect::<Vec<_>>()
            .join("");

        if !content.trim().is_empty() {
            let first_id = group[0].chunk_id.as_deref().unwrap_or("unknown");
            let first_time = group[0].created_at.clone();
            let last_time = group
                .last()
                .and_then(|c| c.created_at.clone())
                .or_else(|| first_time.clone());
            let duration_ms = duration_between_iso_ms(first_time.as_deref(), last_time.as_deref());

            out.push(RawActivityChunk {
                chunk_id: Some(format!("merged:thinking:{}", first_id)),
                action_type: Some("llm_thinking".to_string()),
                function: Some("thinking".to_string()),
                args: Some(serde_json::json!({})),
                result: Some(serde_json::json!({
                    "thought": content,
                    "content": content,
                    "observation": content,
                    "duration": duration_ms,
                    "durationMs": duration_ms,
                    "is_delta": false
                })),
                created_at: last_time,
                session_id: group[0].session_id.clone(),
                thread_id: None,
                process_id: None,
                call_id: None,
            });
        }
        group.clear();
    };

    let flush_messages = |out: &mut Vec<RawActivityChunk>, group: &mut Vec<&RawActivityChunk>| {
        if group.is_empty() {
            return;
        }
        group.sort_by(|a, b| {
            let ta = a.created_at.as_deref().unwrap_or("");
            let tb = b.created_at.as_deref().unwrap_or("");
            ta.cmp(tb)
        });

        let content: String = group
            .iter()
            .copied()
            .map(extract_message_content)
            .collect::<Vec<_>>()
            .join("");

        if !content.trim().is_empty() {
            let first_id = group[0].chunk_id.as_deref().unwrap_or("unknown");
            let last_time = group
                .last()
                .and_then(|c| c.created_at.clone())
                .or_else(|| group[0].created_at.clone());

            out.push(RawActivityChunk {
                chunk_id: Some(format!("merged:message:{}", first_id)),
                action_type: Some("assistant".to_string()),
                function: Some("message".to_string()),
                args: Some(serde_json::json!({})),
                result: Some(serde_json::json!({
                    "content": content,
                    "observation": content,
                    "role": "assistant",
                    "is_delta": false
                })),
                created_at: last_time,
                session_id: group[0].session_id.clone(),
                thread_id: None,
                process_id: None,
                call_id: None,
            });
        }
        group.clear();
    };

    for chunk in &valid {
        if is_thinking_delta(chunk) {
            thinking_group.push(chunk);
        } else if is_message_delta(chunk) || is_legacy_assistant_delta(chunk) {
            message_group.push(chunk);
        } else if is_thinking_end_marker(chunk) {
            flush_thinking(&mut output, &mut thinking_group);
        } else if is_complete_message(chunk) {
            flush_messages(&mut output, &mut message_group);
            output.push((*chunk).clone());
        } else {
            flush_thinking(&mut output, &mut thinking_group);
            flush_messages(&mut output, &mut message_group);
            output.push((*chunk).clone());
        }
    }

    flush_thinking(&mut output, &mut thinking_group);
    flush_messages(&mut output, &mut message_group);

    // Post-consolidation dedup: remove duplicate assistant message content
    dedup_assistant_messages(output)
}

// ============================================================================
// Chunk Classification
// ============================================================================

fn is_thinking_delta(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    let is_thinking_type = matches!(
        at,
        "llm_thinking" | "llm_thinking_delta" | "thinking" | "thinking_delta"
    );
    is_thinking_type && result_is_delta(chunk)
}

fn is_message_delta(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    let is_msg_type = matches!(
        at,
        "assistant" | "assistant_delta" | "message" | "message_delta"
    );
    let is_assistant_role = chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .and_then(|o| o.get("role"))
        .and_then(|v| v.as_str())
        .map(|r| r == "assistant")
        .unwrap_or(true);

    is_msg_type && result_is_delta(chunk) && is_assistant_role
}

fn is_legacy_assistant_delta(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    let is_msg_type = at == "assistant" || at == "message";
    if !is_msg_type {
        return false;
    }

    let is_assistant_role = chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .and_then(|o| o.get("role"))
        .and_then(|v| v.as_str())
        .map(|r| r == "assistant")
        .unwrap_or(true);

    let has_is_delta = chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .map(|o| o.contains_key("is_delta"))
        .unwrap_or(false);

    !has_is_delta && is_assistant_role
}

fn is_thinking_end_marker(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    let is_thinking_type = matches!(
        at,
        "llm_thinking" | "llm_thinking_delta" | "thinking" | "thinking_delta"
    );
    if !is_thinking_type {
        return false;
    }

    let is_delta = result_is_delta(chunk);
    let has_content = has_thinking_text(chunk);
    !is_delta && !has_content
}

fn is_complete_message(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    if !(at == "assistant" || at == "message") {
        return false;
    }

    let is_assistant_role = chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .and_then(|o| o.get("role"))
        .and_then(|v| v.as_str())
        .map(|r| r == "assistant")
        .unwrap_or(true);

    let is_delta_false = chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .and_then(|o| o.get("is_delta"))
        .and_then(|v| v.as_bool())
        == Some(false);

    is_delta_false && is_assistant_role
}

fn is_empty_chunk(chunk: &RawActivityChunk) -> bool {
    let at = chunk.action_type.as_deref().unwrap_or("");
    if at.is_empty() {
        return true;
    }
    let cid = chunk.chunk_id.as_deref().unwrap_or("");
    if cid.is_empty() {
        return true;
    }

    if matches!(
        at,
        "llm_thinking" | "llm_thinking_delta" | "thinking" | "thinking_delta"
    ) && !has_thinking_text(chunk)
    {
        return true;
    }

    false
}

// ============================================================================
// Helpers
// ============================================================================

fn duration_between_iso_ms(started_at: Option<&str>, ended_at: Option<&str>) -> Option<i64> {
    let started_at = started_at?;
    let ended_at = ended_at?;
    let start = DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = DateTime::parse_from_rfc3339(ended_at).ok()?;
    let duration_ms = end.signed_duration_since(start).num_milliseconds();
    (duration_ms > 0).then_some(duration_ms)
}

fn result_is_delta(chunk: &RawActivityChunk) -> bool {
    chunk
        .result
        .as_ref()
        .and_then(|r| r.as_object())
        .and_then(|o| o.get("is_delta"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn has_thinking_text(chunk: &RawActivityChunk) -> bool {
    let obj = match chunk.result.as_ref().and_then(|r| r.as_object()) {
        Some(o) => o,
        None => return false,
    };

    for key in &["thought", "content", "observation"] {
        if let Some(serde_json::Value::String(text)) = obj.get(*key) {
            if !text.trim().is_empty() {
                return true;
            }
        }
    }
    false
}

fn extract_thinking_content(chunk: &RawActivityChunk) -> String {
    let obj = match chunk.result.as_ref().and_then(|r| r.as_object()) {
        Some(o) => o,
        None => return String::new(),
    };

    for key in &["thought", "content", "observation"] {
        if let Some(serde_json::Value::String(text)) = obj.get(*key) {
            if !text.is_empty() {
                return text.clone();
            }
        }
    }
    String::new()
}

fn extract_message_content(chunk: &RawActivityChunk) -> String {
    let obj = match chunk.result.as_ref().and_then(|r| r.as_object()) {
        Some(o) => o,
        None => return String::new(),
    };

    for key in &["content", "observation"] {
        if let Some(serde_json::Value::String(text)) = obj.get(*key) {
            if !text.is_empty() {
                return text.clone();
            }
        }
    }
    String::new()
}

fn dedup_assistant_messages(chunks: Vec<RawActivityChunk>) -> Vec<RawActivityChunk> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result = Vec::with_capacity(chunks.len());

    for chunk in chunks {
        let at = chunk.action_type.as_deref().unwrap_or("");
        let func = chunk.function.as_deref().unwrap_or("");
        let is_assistant = at == "assistant" || func == "message";

        if is_assistant {
            let text = extract_message_content(&chunk).trim().to_string();
            if !text.is_empty() && seen.contains(&text) {
                continue;
            }
            if !text.is_empty() {
                seen.insert(text);
            }
        }

        result.push(chunk);
    }

    result
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
#[path = "tests/consolidator_tests.rs"]
mod tests;
