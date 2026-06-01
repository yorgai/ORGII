//! Gating + cursor-advance helpers for the extraction subsystem.
//!
//! Pure logic over `ExtractMemoriesState` + the in-memory message slice —
//! decides "should we even fork an extractor this turn?", advances the
//! cursor past main-agent memory writes, and coalesces the
//! trailing-run stash.

use serde_json::Value;
use std::path::Path;

use crate::tools::names as tool_names;

use super::state::ExtractMemoriesState;

/// Minimum new transcript slots before extraction is eligible.
/// Counts every message object after the cursor (any role) so tool-heavy
/// SDE turns still advance the gate — user+assistant-only counting never
/// reached 2 within a single turn.
pub(super) const MIN_NEW_MESSAGES: usize = 2;

/// How many turns between extraction runs (1 = every turn).
const EXTRACTION_INTERVAL: u32 = 1;

/// Check if extraction should run this turn.
///
/// Gating checks:
/// 1. Feature enabled (`extract_memories_enabled` in config)
/// 2. Workspace path is available
/// 3. Not already in progress
/// 4. Enough new messages since last extraction
/// 5. Main agent didn't write to memory files this turn
///
/// Note on gate 5: when this returns `false` *because* of a main-agent
/// memory write, callers should invoke [`skip_if_main_agent_wrote_memory`]
/// so the next turn skips past the already-processed range rather than
/// re-detecting the same write every turn.
pub fn should_extract(
    state: &ExtractMemoriesState,
    messages: &[Value],
    workspace: Option<&Path>,
) -> bool {
    if state.in_progress {
        return false;
    }

    if workspace.is_none() {
        return false;
    }

    let new_count = count_new_messages(messages, state.last_processed_idx);
    if new_count < MIN_NEW_MESSAGES {
        return false;
    }

    if has_memory_writes_since(messages, state.last_processed_idx, workspace.unwrap()) {
        return false;
    }

    state.turns_since_extraction + 1 >= EXTRACTION_INTERVAL
}

/// Returns true if the current turn should be skipped *because the main
/// agent already wrote to memory*, and advances the cursor past that
/// range as a side effect. Caller should use this before `should_extract`
/// to get correct "skip + advance cursor" semantics.
///
/// The main agent's own memory-write is mutually exclusive with the
/// forked extractor; bumping the cursor so the next tick only considers
/// messages after the main agent's write avoids every subsequent tick
/// re-detecting the same write and skipping again.
pub fn skip_if_main_agent_wrote_memory(
    state: &mut ExtractMemoriesState,
    messages: &[Value],
    workspace: &Path,
) -> bool {
    if !has_memory_writes_since(messages, state.last_processed_idx, workspace) {
        return false;
    }
    if !messages.is_empty() {
        state.last_processed_idx = Some(messages.len() - 1);
    }
    true
}

/// Stash the latest messages while an extraction is in flight.
///
/// Called by the processor when `in_progress` has blocked a would-be
/// extraction. Overwrites any prior stash — only the *latest* transcript
/// matters because it already contains the older ones as a prefix.
///
/// Returns `true` if there was no existing stash (informational only; the
/// coalesce behavior does not depend on it).
pub fn stash_pending(state: &mut ExtractMemoriesState, messages: &[Value]) -> bool {
    let was_empty = state.pending_messages.is_none();
    state.pending_messages = Some(messages.to_vec());
    was_empty
}

/// Drain the stashed trailing-run messages, if any.
///
/// The processor's spawned extraction task calls this after each
/// `run_extraction` completes. When `Some`, the task issues one more
/// extraction round with those messages. This is the key fix for the
/// "second turn during a long extraction silently vanishes" hole that
/// a drop-on-conflict policy would have.
pub fn take_pending(state: &mut ExtractMemoriesState) -> Option<Vec<Value>> {
    state.pending_messages.take()
}

/// Record a turn (increment counter). Call this every turn regardless
/// of whether extraction actually runs.
pub fn record_turn(state: &mut ExtractMemoriesState) {
    state.turns_since_extraction += 1;
}

/// Count new messages since the cursor (any role).
///
/// Tool-heavy agents append many `tool_use` / `tool_result` blocks per turn;
/// counting only user+assistant prevented `extract_memories` from ever firing.
pub(super) fn count_new_messages(messages: &[Value], since_idx: Option<usize>) -> usize {
    let start = match since_idx {
        Some(idx) => idx + 1,
        None => 0,
    };
    messages.get(start..).map(|slice| slice.len()).unwrap_or(0)
}

/// Check if any assistant message after the cursor wrote to memory files.
///
/// Scans OpenAI-style assistant messages (the canonical shape the processor
/// produces via `turn_executor::add_assistant_message`) for a top-level
/// `tool_calls` array whose `function.name == "edit_file"` and whose
/// `function.arguments` (a JSON-encoded string) decodes to a `file_path`
/// inside the workspace's workspace-memory directory.
///
/// Historical note: an earlier port of this gate scanned the Anthropic-native
/// `content: [{ type: "tool_use", ... }]` shape instead. That shape never
/// reaches this gate — the native Anthropic provider only materializes
/// `type: "tool_use"` blocks in the *outbound request body* for the API;
/// the in-memory `messages` vector that both the processor and this gate
/// see is always the OpenAI shape. As a result the old check silently
/// returned `false` in production and mutual exclusion was effectively
/// disabled — a main-agent write would still trigger the extract fork,
/// which then raced / overwrote the main agent's file.
fn has_memory_writes_since(messages: &[Value], since_idx: Option<usize>, workspace: &Path) -> bool {
    let start = match since_idx {
        Some(idx) => idx + 1,
        None => 0,
    };

    let Some(new_messages) = messages.get(start..) else {
        return false;
    };

    for msg in new_messages {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role != "assistant" {
            continue;
        }

        let Some(tool_calls) = msg.get("tool_calls").and_then(|c| c.as_array()) else {
            continue;
        };
        for call in tool_calls {
            if let Some(file_path) = extract_written_path(call) {
                let path = Path::new(&file_path);
                if super::super::is_memory_path(path, workspace) {
                    return true;
                }
            }
        }
    }

    false
}

/// Extract `file_path` from a single OpenAI-style `tool_calls[*]` entry
/// targeting `edit_file`. Returns `None` for any other tool or when the
/// streamed `arguments` string failed to parse as JSON (including the
/// `_stream_parse_error` short-circuit marker — those calls never actually
/// touched the filesystem).
fn extract_written_path(call: &Value) -> Option<String> {
    let function = call.get("function")?;
    let name = function.get("name").and_then(|n| n.as_str())?;
    if name != tool_names::EDIT_FILE {
        return None;
    }
    let arguments_str = function.get("arguments").and_then(|a| a.as_str())?;
    // Corrupt JSON in `arguments` would normally indicate the streamed
    // tool call was truncated mid-flight. Returning `None` keeps the
    // memory-gating layer correct (we don't want to gate on a tool
    // call that never actually wrote a file), but warn so the
    // upstream truncation surfaces in logs instead of silently
    // skipping memory work for an entire turn.
    let parsed: Value = match serde_json::from_str(arguments_str) {
        Ok(v) => v,
        Err(err) => {
            tracing::warn!(
                error = %err,
                len = arguments_str.len(),
                "workspace_memory::gating::extract_written_path: edit_file arguments are not valid JSON; skipping gate"
            );
            return None;
        }
    };
    if parsed.get("_stream_parse_error").is_some() {
        return None;
    }
    parsed
        .get("file_path")
        .or_else(|| parsed.get("path"))
        .and_then(|fp| fp.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_message(role: &str, content: &str) -> Value {
        serde_json::json!({ "role": role, "content": content })
    }

    fn openai_edit_file_message(file_path: &str) -> Value {
        serde_json::json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "edit_file",
                    "arguments": serde_json::to_string(&serde_json::json!({
                        "file_path": file_path,
                    })).unwrap(),
                }
            }]
        })
    }

    #[test]
    fn test_count_new_messages_all() {
        let messages = vec![
            make_message("system", "You are helpful."),
            make_message("user", "Hello"),
            make_message("assistant", "Hi there"),
            make_message("user", "How are you?"),
            make_message("assistant", "Good!"),
        ];

        assert_eq!(count_new_messages(&messages, None), 5);
        assert_eq!(count_new_messages(&messages, Some(0)), 4);
        assert_eq!(count_new_messages(&messages, Some(2)), 2);
        assert_eq!(count_new_messages(&messages, Some(4)), 0);
    }

    #[test]
    fn test_count_new_messages_tool_heavy() {
        let messages = vec![
            make_message("system", "sys"),
            make_message("user", "do something"),
            make_message("assistant", "ok"),
            serde_json::json!({ "role": "tool_use", "content": [{ "type": "tool_use", "name": "read_file" }] }),
            serde_json::json!({ "role": "tool_result", "content": "file content" }),
        ];

        assert_eq!(count_new_messages(&messages, None), 5);
        assert_eq!(count_new_messages(&messages, Some(1)), 3);
    }

    #[test]
    fn test_should_extract_basic() {
        let mut state = ExtractMemoriesState::default();
        let messages = vec![
            make_message("system", "system"),
            make_message("user", "hello"),
            make_message("assistant", "hi"),
            make_message("user", "question"),
            make_message("assistant", "answer"),
        ];

        assert!(should_extract(
            &state,
            &messages,
            Some(Path::new("/tmp/workspace"))
        ));

        state.in_progress = true;
        assert!(!should_extract(
            &state,
            &messages,
            Some(Path::new("/tmp/workspace"))
        ));
        state.in_progress = false;

        assert!(!should_extract(&state, &messages, None));
    }

    #[test]
    fn test_should_extract_not_enough_messages() {
        let state = ExtractMemoriesState::default();
        let messages = vec![make_message("system", "system")];

        assert!(!should_extract(
            &state,
            &messages,
            Some(Path::new("/tmp/workspace"))
        ));
    }

    #[test]
    fn test_has_memory_writes_since() {
        let workspace = Path::new("/home/user/workspace");

        let messages = vec![
            make_message("system", "system"),
            make_message("user", "hello"),
            openai_edit_file_message("/home/user/workspace/.orgii/workspace-memory/prefs.md"),
        ];

        assert!(has_memory_writes_since(&messages, None, workspace));
        assert!(has_memory_writes_since(&messages, Some(0), workspace));
        assert!(!has_memory_writes_since(&messages, Some(2), workspace));
    }

    #[test]
    fn test_has_memory_writes_since_handles_stale_cursor() {
        let workspace = Path::new("/home/user/workspace");
        let messages = vec![
            make_message("system", "system"),
            openai_edit_file_message("/home/user/workspace/.orgii/workspace-memory/prefs.md"),
        ];

        assert!(!has_memory_writes_since(&messages, Some(231), workspace));
    }

    #[test]
    fn test_has_memory_writes_non_memory_path() {
        let workspace = Path::new("/home/user/workspace");

        let messages = vec![
            make_message("system", "system"),
            openai_edit_file_message("/home/user/workspace/src/main.rs"),
        ];

        assert!(!has_memory_writes_since(&messages, None, workspace));
    }

    #[test]
    fn test_has_memory_writes_stream_parse_error_is_ignored() {
        let workspace = Path::new("/home/user/workspace");

        let bad_args = serde_json::to_string(&serde_json::json!({
            "_stream_parse_error": {
                "cause": "empty",
                "parse_err": "EOF while parsing a value",
                "preview": "",
                "total_len": 0,
            }
        }))
        .unwrap();

        let messages = vec![serde_json::json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "edit_file",
                    "arguments": bad_args,
                }
            }]
        })];

        assert!(!has_memory_writes_since(&messages, None, workspace));
    }

    #[test]
    fn test_has_memory_writes_relative_path() {
        let workspace = Path::new("/home/user/workspace");

        let messages = vec![openai_edit_file_message(
            "/home/user/workspace/.orgii/workspace-memory/subdir/nested.md",
        )];

        assert!(has_memory_writes_since(&messages, None, workspace));
    }

    #[test]
    fn test_has_memory_writes_other_tool_ignored() {
        let workspace = Path::new("/home/user/workspace");

        let messages = vec![serde_json::json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "read_file",
                    "arguments": "{\"file_path\":\"/home/user/workspace/.orgii/workspace-memory/x.md\"}",
                }
            }]
        })];

        assert!(!has_memory_writes_since(&messages, None, workspace));
    }

    #[test]
    fn test_record_turn() {
        let mut state = ExtractMemoriesState::default();
        assert_eq!(state.turns_since_extraction, 0);

        record_turn(&mut state);
        assert_eq!(state.turns_since_extraction, 1);

        record_turn(&mut state);
        assert_eq!(state.turns_since_extraction, 2);
    }

    #[test]
    fn test_extract_written_path() {
        let edit_call = serde_json::json!({
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "edit_file",
                "arguments": "{\"file_path\":\"/tmp/memory/test.md\"}",
            }
        });
        assert_eq!(
            extract_written_path(&edit_call),
            Some("/tmp/memory/test.md".to_string())
        );

        let read_call = serde_json::json!({
            "id": "call_2",
            "type": "function",
            "function": {
                "name": "read_file",
                "arguments": "{\"file_path\":\"/tmp/test.rs\"}",
            }
        });
        assert_eq!(extract_written_path(&read_call), None);

        let malformed = serde_json::json!({
            "id": "call_3",
            "type": "function",
            "function": {
                "name": "edit_file",
                "arguments": "not valid json",
            }
        });
        assert_eq!(extract_written_path(&malformed), None);
    }

    #[test]
    fn test_stash_pending_overwrites_latest() {
        let mut state = ExtractMemoriesState::default();

        let first = vec![make_message("user", "one")];
        assert!(
            stash_pending(&mut state, &first),
            "first stash should report empty prior state"
        );

        let second = vec![
            make_message("user", "one"),
            make_message("assistant", "ack"),
            make_message("user", "two"),
        ];
        assert!(
            !stash_pending(&mut state, &second),
            "subsequent stash should report already-stashed"
        );

        let drained = take_pending(&mut state).expect("pending should be present");
        assert_eq!(drained.len(), 3, "latest stash wins — coalesce semantics");
        assert!(take_pending(&mut state).is_none(), "take_pending drains");
    }

    #[test]
    fn test_skip_if_main_agent_wrote_memory_advances_cursor() {
        let workspace = Path::new("/home/user/workspace");
        let mut state = ExtractMemoriesState::default();

        let messages = vec![
            make_message("system", "system"),
            make_message("user", "save this"),
            openai_edit_file_message("/home/user/workspace/.orgii/workspace-memory/prefs.md"),
        ];

        assert!(
            skip_if_main_agent_wrote_memory(&mut state, &messages, workspace),
            "main-agent write should trigger skip"
        );
        assert_eq!(
            state.last_processed_idx,
            Some(messages.len() - 1),
            "cursor must advance to end of transcript"
        );

        assert!(
            !skip_if_main_agent_wrote_memory(&mut state, &messages, workspace),
            "cursor advance prevents re-detection next turn"
        );
    }

    #[test]
    fn test_skip_if_main_agent_wrote_memory_ignores_non_mem_writes() {
        let workspace = Path::new("/home/user/workspace");
        let mut state = ExtractMemoriesState::default();

        let messages = vec![
            make_message("system", "system"),
            make_message("user", "hello"),
            openai_edit_file_message("/home/user/workspace/src/main.rs"),
        ];

        assert!(
            !skip_if_main_agent_wrote_memory(&mut state, &messages, workspace),
            "non-memory edits must not trigger skip"
        );
        assert!(
            state.last_processed_idx.is_none(),
            "cursor must NOT move when skip is not triggered"
        );
    }
}
