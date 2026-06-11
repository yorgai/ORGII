//! Context bridge building — injects prior ORGII conversation history into CLI
//! sessions that have no native conversation state.

use core_types::activity::ActivityChunk;

use super::super::persistence;

const CONTEXT_BRIDGE_MAX_CHARS: usize = 12_000;
const CONTEXT_BRIDGE_MAX_MESSAGES: usize = 24;

pub(super) fn chunk_text(chunk: &ActivityChunk) -> Option<String> {
    let result = &chunk.result;
    let text = result
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .or_else(|| result.get("content").and_then(|value| value.as_str()))
        .or_else(|| result.get("observation").and_then(|value| value.as_str()))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub(super) fn chunk_role(chunk: &ActivityChunk) -> Option<&'static str> {
    if chunk.function == "user_message" {
        return Some("User");
    }
    match chunk.action_type.as_str() {
        "assistant" | "assistant_delta" | "message" | "message_delta" => Some("Assistant"),
        _ => None,
    }
}

pub(super) fn build_context_bridge(session_id: &str) -> Option<String> {
    let chunks = persistence::load_chunks(session_id).ok()?;
    let mut lines = Vec::new();
    for chunk in chunks.iter().rev() {
        if lines.len() >= CONTEXT_BRIDGE_MAX_MESSAGES {
            break;
        }
        let Some(role) = chunk_role(chunk) else {
            continue;
        };
        let Some(text) = chunk_text(chunk) else {
            continue;
        };
        lines.push(format!("{role}: {text}"));
    }
    if lines.is_empty() {
        return None;
    }
    lines.reverse();
    let mut body = lines.join("\n\n");
    if body.len() > CONTEXT_BRIDGE_MAX_CHARS {
        let mut start = body.len().saturating_sub(CONTEXT_BRIDGE_MAX_CHARS);
        while start < body.len() && !body.is_char_boundary(start) {
            start += 1;
        }
        body = body[start..].to_string();
    }

    let mutation_note = persistence::get_history_mutation(session_id)
        .ok()
        .flatten()
        .map(|mutation| {
            format!(
                "\nORGII history mutation marker: epoch={}, reason={}, mutated_at={}. The native CLI conversation state was intentionally discarded after this mutation; treat the ORGII conversation context below as authoritative.",
                mutation.epoch, mutation.reason, mutation.mutated_at
            )
        })
        .unwrap_or_default();

    Some(format!(
        "<orgii_context_bridge>\nThis CLI profile has no native conversation for this ORGII session yet. Continue using the ORGII conversation context below; do not repeat or summarize it unless the user asks.{}\n\n{}\n</orgii_context_bridge>",
        mutation_note, body
    ))
}
