//! Transcript building for the reflection write path.
//!
//! Loads `user`/`assistant` rows from `agent_messages` and renders them as a
//! single tail-biased string suitable for an LLM extraction call. Tool turns
//! are deliberately excluded — see [`build_transcript`].

use crate::foundation::persistence::db_helpers::message_role;

/// Minimum transcript length to trigger reflection (chars).
///
/// Transcript is now user+assistant only (tool turns are excluded — they're
/// covered by L2 workspace memory / extract_memories), so this threshold filters
/// out trivially-short exchanges that have no durable behavioral signal.
pub(super) const MIN_TRANSCRIPT_LEN: usize = 200;

/// Total transcript byte cap fed to the reflection LLM. Tail-biased: when
/// the conversation exceeds this cap we drop the head (oldest turns) and
/// keep the tail (most recent exchange + session conclusion) because insights
/// about *how the session went* concentrate at the end, not the beginning.
///
/// This replaces the previous per-message byte truncation (2000 user/assistant,
/// 800 tool_input, 500 tool_output) which caused the reflection model to see
/// only the head bytes of every message — including sandbox paths, e2e test
/// IDs, and tool schema errors that then leaked into "learnings". See
/// `Documentation/Agent/audit-fallbacks-0421.md` for the 14 polluted rows this
/// caused before 0421.
pub(super) const TRANSCRIPT_TOTAL_CAP: usize = 16_000;

/// Build a condensed transcript from session messages.
///
/// Only `user` and `assistant` turns are included. `tool_call` / `tool_result`
/// rows are deliberately excluded: durable L3 insights (user preferences,
/// correction patterns, cross-session strategies) live in the natural-language
/// turns, while tool-level detail (file paths, shell output, schema errors)
/// is noise at this layer and is already captured by L2 workspace memory and
/// `extract_memories`. Earlier revisions of this function included tool rows
/// and truncated each one to the first N bytes, which is exactly how the
/// "e2e-orch-…", "sandbox-…", and "missing additionalProperties" artifacts
/// leaked into `learnings` rows.
///
/// This is the same shape mem0's `parse_messages` and memU's
/// `format_conversation_for_preprocess` produce — per-message lines, no
/// per-message byte truncation. A single total-length cap is applied at the
/// end, tail-biased so the tail of the session (where conclusions and
/// corrections typically surface) is always preserved.
pub fn build_transcript(conn: &rusqlite::Connection, session_id: &str) -> Result<String, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role, content
             FROM agent_messages
             WHERE session_id = ?1 AND role IN (?2, ?3)
             ORDER BY sequence ASC",
        )
        .map_err(|e| format!("Query failed: {}", e))?;

    let rows = stmt
        .query_map(
            rusqlite::params![session_id, message_role::USER, message_role::ASSISTANT],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Query failed: {}", e))?;

    let mut transcript = String::new();
    for (role, content) in rows.filter_map(Result::ok) {
        append_transcript_line(&mut transcript, &role, &content);
    }

    Ok(trim_head_to_cap(&transcript, TRANSCRIPT_TOTAL_CAP))
}

fn append_transcript_line(transcript: &mut String, role: &str, content: &str) {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return;
    }
    let label = match role {
        message_role::USER => "User",
        message_role::ASSISTANT => "Assistant",
        _ => return,
    };
    transcript.push_str(label);
    transcript.push_str(": ");
    transcript.push_str(trimmed);
    transcript.push_str("\n\n");
}

/// Trim the *head* of `text` so the byte length fits within `cap`, snapping
/// the cut to a UTF-8 character boundary. Never byte-indexes inside a multi-
/// byte codepoint.
fn trim_head_to_cap(text: &str, cap: usize) -> String {
    if text.len() <= cap {
        return text.to_string();
    }
    let start_byte = text.len() - cap;
    let mut boundary = start_byte;
    while boundary < text.len() && !text.is_char_boundary(boundary) {
        boundary += 1;
    }
    text[boundary..].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_transcript_line_keeps_user_and_assistant_only() {
        let mut out = String::new();
        append_transcript_line(&mut out, message_role::USER, "hello world");
        append_transcript_line(&mut out, message_role::ASSISTANT, "hi there");
        append_transcript_line(&mut out, message_role::TOOL_CALL, "should be dropped");
        append_transcript_line(&mut out, message_role::TOOL_RESULT, "should be dropped");
        append_transcript_line(&mut out, "unknown_role", "also dropped");
        assert!(out.contains("User: hello world"));
        assert!(out.contains("Assistant: hi there"));
        assert!(!out.contains("should be dropped"));
        assert!(!out.contains("also dropped"));
        assert!(!out.contains("Tool Call"));
        assert!(!out.contains("Tool Result"));
    }

    #[test]
    fn append_transcript_line_skips_empty_and_whitespace_content() {
        let mut out = String::new();
        append_transcript_line(&mut out, message_role::USER, "");
        append_transcript_line(&mut out, message_role::USER, "   \n\t  ");
        assert_eq!(out, "");
    }

    #[test]
    fn trim_head_to_cap_returns_input_when_under_cap() {
        let s = "hello";
        assert_eq!(trim_head_to_cap(s, 100), "hello");
    }

    #[test]
    fn trim_head_to_cap_drops_head_not_tail() {
        let input: String = "A".repeat(100) + &"B".repeat(100);
        let out = trim_head_to_cap(&input, 50);
        assert_eq!(out.len(), 50);
        assert!(
            out.chars().all(|c| c == 'B'),
            "tail-biased trim must keep trailing bytes"
        );
    }

    #[test]
    fn trim_head_to_cap_respects_utf8_boundaries() {
        let input = "a".to_string() + &"✓".repeat(20);
        let out = trim_head_to_cap(&input, 10);
        assert!(
            out.chars().all(|c| c == '✓'),
            "must never byte-index into a multi-byte codepoint — got: {:?}",
            out
        );
    }
}
