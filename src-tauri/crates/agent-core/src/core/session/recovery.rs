//! Interrupted turn detection and recovery.
//!
//! When a session crashes mid-turn (app crash, OOM, network timeout), the
//! conversation history may be left in an inconsistent state:
//!
//! - Dangling `tool_use` blocks without matching `tool_result`
//! - Unterminated assistant messages (no finish_reason)
//!
//! This module detects these patterns and repairs them in-place so the
//! next LLM call doesn't fail with an API error.
//!
//! Ref: claude_code/utils/conversationRecovery.ts (~600 lines)

use serde_json::Value;
use tracing::info;

use std::collections::HashSet;

use crate::core::turn_executor::helpers::{msg_role, msg_tool_calls};

#[cfg(debug_assertions)]
pub mod debug_counters {
    //! Debug-only counters that record which recovery path ran, so E2E
    //! scenarios can distinguish the user-initiated resume path
    //! (`filter_unresolved_tool_uses`) from the crash-recovery path
    //! (`repair_interrupted_history`) without having to scrape logs or
    //! infer from LLM output wording.
    //!
    //! Reset by the `/test/recovery/counters-reset` endpoint; read by
    //! `/test/recovery/counters`. Only compiled in debug builds.
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub static FILTER_INVOCATIONS: AtomicUsize = AtomicUsize::new(0);
    pub static FILTER_MESSAGES_REMOVED: AtomicUsize = AtomicUsize::new(0);
    pub static REPAIR_INVOCATIONS: AtomicUsize = AtomicUsize::new(0);

    pub fn record_filter(removed: usize) {
        FILTER_INVOCATIONS.fetch_add(1, Ordering::Relaxed);
        FILTER_MESSAGES_REMOVED.fetch_add(removed, Ordering::Relaxed);
    }

    pub fn record_repair() {
        REPAIR_INVOCATIONS.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot() -> (usize, usize, usize) {
        (
            FILTER_INVOCATIONS.load(Ordering::Relaxed),
            FILTER_MESSAGES_REMOVED.load(Ordering::Relaxed),
            REPAIR_INVOCATIONS.load(Ordering::Relaxed),
        )
    }

    pub fn reset() {
        FILTER_INVOCATIONS.store(0, Ordering::Relaxed);
        FILTER_MESSAGES_REMOVED.store(0, Ordering::Relaxed);
        REPAIR_INVOCATIONS.store(0, Ordering::Relaxed);
    }
}

/// Type of interruption detected in conversation history.
#[derive(Debug, PartialEq)]
pub enum InterruptionType {
    /// tool_use blocks exist without matching tool_result responses.
    DanglingToolUse { tool_call_ids: Vec<String> },
    /// Last assistant message appears truncated (conversation ends with
    /// an assistant message that has no subsequent user message).
    UnterminatedAssistant,
}

/// The sentinel text injected in-memory when the previous turn was cancelled
/// by the user.
///
/// This is injected by `processor.rs` step 4b (not persisted to the DB), so
/// it will always appear as the *last* message in the in-memory list when
/// present. `detect_turn_interruption` must recognise it to avoid treating a
/// clean user-cancel as a crash that needs recovery.
pub const USER_INTERRUPT_SENTINEL: &str = "[Request interrupted by user]";

const SYNTHETIC_INTERRUPTED_TOOL_RESULT: &str =
    "Tool execution was interrupted before a result was produced. Retry if needed.";

/// Return true if the last message in `messages` is the in-memory interrupt
/// sentinel injected by the processor after a user cancel.
fn ends_with_interrupt_sentinel(messages: &[Value]) -> bool {
    messages.last().is_some_and(|last| {
        msg_role(last) == "user"
            && last
                .get("content")
                .and_then(|v| v.as_str())
                .is_some_and(|c| c == USER_INTERRUPT_SENTINEL)
    })
}

/// Scan conversation history for interrupted turns.
///
/// Checks the tail of the conversation for two patterns:
/// 1. Assistant message with tool_calls that lack matching tool_result messages
/// 2. Conversation ending with an assistant message (no user follow-up)
///
/// **Important:** if the history ends with the in-memory cancel sentinel
/// (`[Request interrupted by user]`), the turn was cleanly cancelled and is
/// already handled — returns `None` so crash-recovery repair is skipped.
pub fn detect_turn_interruption(messages: &[Value]) -> Option<InterruptionType> {
    if messages.is_empty() {
        return None;
    }

    // If the cancel-interrupt sentinel is the tail message, the previous turn
    // was intentionally cancelled — not a crash. No repair needed.
    if ends_with_interrupt_sentinel(messages) {
        return None;
    }

    // Find the last assistant message
    let mut last_assistant_idx = None;
    for idx in (0..messages.len()).rev() {
        if msg_role(&messages[idx]) == "assistant" {
            last_assistant_idx = Some(idx);
            break;
        }
    }

    let assistant_idx = last_assistant_idx?;
    let assistant_msg = &messages[assistant_idx];

    // Check for dangling tool_use: assistant has tool_calls without matching tool results
    if let Some(tool_calls) = msg_tool_calls(assistant_msg) {
        if !tool_calls.is_empty() {
            let expected_ids: Vec<String> = tool_calls
                .iter()
                .filter_map(|tc| tc.get("id").and_then(|id| id.as_str()))
                .map(|s| s.to_string())
                .collect();

            // Collect tool_call_ids from subsequent tool-role messages
            let mut matched_ids: Vec<String> = Vec::new();
            for msg in &messages[assistant_idx + 1..] {
                if msg_role(msg) == "tool" {
                    if let Some(tool_call_id) = msg.get("tool_call_id").and_then(|id| id.as_str()) {
                        matched_ids.push(tool_call_id.to_string());
                    }
                } else {
                    break;
                }
            }

            let orphan_ids: Vec<String> = expected_ids
                .into_iter()
                .filter(|id| !matched_ids.contains(id))
                .collect();

            if !orphan_ids.is_empty() {
                return Some(InterruptionType::DanglingToolUse {
                    tool_call_ids: orphan_ids,
                });
            }
        }
    }

    // Check for unterminated assistant: conversation ends with assistant message
    // (no user message after it, and no tool results either)
    let last_role = msg_role(&messages[messages.len() - 1]);
    if last_role == "assistant" {
        return Some(InterruptionType::UnterminatedAssistant);
    }

    None
}

/// Repair interrupted history in-place by injecting synthetic messages.
///
/// Returns `true` if any repair was applied.
pub fn repair_interrupted_history(messages: &mut Vec<Value>) -> bool {
    let interruption = match detect_turn_interruption(messages) {
        Some(intr) => intr,
        None => return false,
    };

    let result = match interruption {
        InterruptionType::DanglingToolUse { tool_call_ids } => {
            info!(
                "[recovery] Injecting {} synthetic tool_result(s) for orphan tool calls",
                tool_call_ids.len()
            );
            for tool_call_id in &tool_call_ids {
                messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": "Tool execution was interrupted by a crash. Retry if needed.",
                }));
            }
            messages.push(serde_json::json!({
                "role": "user",
                "content": "Your previous response was interrupted. \
                             Some tool calls could not complete. \
                             Continue from where you left off.",
            }));
            true
        }
        InterruptionType::UnterminatedAssistant => {
            info!("[recovery] Injecting continuation prompt for unterminated assistant message");
            messages.push(serde_json::json!({
                "role": "user",
                "content": "Your previous response was interrupted. \
                             Continue from where you left off.",
            }));
            true
        }
    };

    #[cfg(debug_assertions)]
    if result {
        debug_counters::record_repair();
    }

    result
}

/// Deletion-based cleanup of orphan `tool_use` entries for user-initiated resumes.
///
/// Instead of injecting a synthetic tool_result + continuation prompt (which
/// [`repair_interrupted_history`] does for crash recovery), this walks the
/// tail of the history and **removes** any assistant message whose
/// `tool_calls` include unresolved ids, along with any stray `tool` rows that
/// follow.
///
/// This is the right shape for a user-triggered "Resume" button where the user
/// is sending a fresh message: we want the provider API to accept the
/// conversation (no dangling tool_use) without injecting a synthetic
/// "continue from where you left off" user message that would duplicate the
/// user's next prompt.
///
/// # Whole-message removal vs block-level filtering
///
/// Our `turn_executor` writes the entire turn's assistant payload as a single
/// JSON message (`content` + `tool_calls` together), so the only safe unit of
/// removal is the **whole assistant message**. We run filter / repair at the
/// start of every turn so historical orphans cannot accumulate, making a
/// tail-only scan sufficient.
///
/// Returns the number of messages removed.
pub(crate) fn filter_unresolved_tool_uses(messages: &mut Vec<Value>) -> usize {
    if messages.is_empty() {
        return 0;
    }

    // Find the last assistant message with tool_calls that has at least one
    // orphan. If such a message exists, the safe repair is to drop it AND every
    // message that follows (they are all either partial tool results or a
    // synthetic user message injected by a previous repair).
    let mut cut_at: Option<usize> = None;
    for idx in (0..messages.len()).rev() {
        if msg_role(&messages[idx]) != "assistant" {
            continue;
        }
        let tool_calls = match msg_tool_calls(&messages[idx]) {
            Some(arr) if !arr.is_empty() => arr,
            _ => break,
        };

        let expected_ids: Vec<&str> = tool_calls
            .iter()
            .filter_map(|tc| tc.get("id").and_then(|id| id.as_str()))
            .collect();

        let mut matched: Vec<&str> = Vec::new();
        for msg in &messages[idx + 1..] {
            if msg_role(msg) == "tool" {
                if let Some(id) = msg.get("tool_call_id").and_then(|id| id.as_str()) {
                    matched.push(id);
                }
            } else {
                break;
            }
        }

        let has_orphan = expected_ids.iter().any(|id| !matched.contains(id));
        if has_orphan {
            cut_at = Some(idx);
        }
        break;
    }

    let removed = match cut_at {
        Some(idx) => {
            let removed = messages.len() - idx;
            messages.truncate(idx);
            removed
        }
        None => 0,
    };

    if removed > 0 {
        info!(
            "[recovery] filter_unresolved_tool_uses removed {} trailing message(s) with orphan tool_use",
            removed
        );
    }

    #[cfg(debug_assertions)]
    debug_counters::record_filter(removed);

    removed
}

/// Ensure every assistant `tool_calls` envelope is immediately followed by
/// matching `tool` result rows before history is sent to a provider.
///
/// User Stop / Force Send can persist a new user turn after an interrupted tool
/// call, so tail-only resume cleanup is not sufficient. This mirrors Claude
/// Code's request-boundary pairing repair: preserve the assistant turn and add
/// synthetic error tool results directly after it, while removing stray tool
/// rows that no longer have a live assistant parent.
pub(crate) fn ensure_tool_result_pairing(messages: &mut Vec<Value>) -> bool {
    if messages.is_empty() {
        return false;
    }

    let original_len = messages.len();
    let mut result = Vec::with_capacity(messages.len());
    let mut repaired = false;
    let mut all_seen_tool_call_ids = HashSet::new();
    let mut idx = 0;

    while idx < messages.len() {
        let mut msg = messages[idx].clone();
        if msg_role(&msg) != "assistant" {
            if msg_role(&msg) == "tool" {
                repaired = true;
            } else {
                result.push(msg);
            }
            idx += 1;
            continue;
        }

        let mut tool_call_ids = Vec::new();
        let mut filtered_tool_calls = Vec::new();
        if let Some(tool_calls) = msg_tool_calls(&msg) {
            for tool_call in tool_calls {
                if let Some(id) = tool_call.get("id").and_then(|id| id.as_str()) {
                    if all_seen_tool_call_ids.insert(id.to_string()) {
                        tool_call_ids.push(id.to_string());
                        filtered_tool_calls.push(tool_call.clone());
                    } else {
                        repaired = true;
                    }
                }
            }
        }
        if let Some(object) = msg.as_object_mut() {
            if !filtered_tool_calls.is_empty() {
                object.insert("tool_calls".to_string(), Value::Array(filtered_tool_calls));
            } else if object.remove("tool_calls").is_some() {
                repaired = true;
                if object.get("content").is_none_or(Value::is_null) {
                    object.insert(
                        "content".to_string(),
                        Value::String("[Duplicate tool call removed]".to_string()),
                    );
                }
            }
        }

        result.push(msg);
        if tool_call_ids.is_empty() {
            idx += 1;
            continue;
        }

        let next_idx = idx + 1;
        let mut consumed_tool_rows = 0;
        let mut matched_ids = HashSet::new();
        let tool_call_id_set: HashSet<&str> = tool_call_ids.iter().map(String::as_str).collect();

        while next_idx + consumed_tool_rows < messages.len() {
            let candidate = &messages[next_idx + consumed_tool_rows];
            if msg_role(candidate) != "tool" {
                break;
            }
            consumed_tool_rows += 1;
            if let Some(tool_call_id) = candidate.get("tool_call_id").and_then(|id| id.as_str()) {
                if tool_call_id_set.contains(tool_call_id)
                    && matched_ids.insert(tool_call_id.to_string())
                {
                    result.push(candidate.clone());
                } else {
                    repaired = true;
                }
            } else {
                repaired = true;
            }
        }

        for tool_call_id in tool_call_ids {
            if !matched_ids.contains(&tool_call_id) {
                repaired = true;
                result.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": SYNTHETIC_INTERRUPTED_TOOL_RESULT,
                }));
            }
        }

        idx = next_idx + consumed_tool_rows;
    }

    if repaired {
        info!(
            "[recovery] ensured tool_result pairing before provider request ({} -> {} messages)",
            original_len,
            result.len()
        );
        *messages = result;
    }

    repaired
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clean_history_returns_none() {
        let messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
            json!({"role": "user", "content": "do something"}),
        ];
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn empty_history_returns_none() {
        assert!(detect_turn_interruption(&[]).is_none());
    }

    #[test]
    fn detects_dangling_tool_use_single() {
        let messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            // No tool result follows — crash happened here
        ];
        let result = detect_turn_interruption(&messages);
        assert_eq!(
            result,
            Some(InterruptionType::DanglingToolUse {
                tool_call_ids: vec!["call_1".to_string()]
            })
        );
    }

    #[test]
    fn detects_dangling_tool_use_partial() {
        let messages = vec![
            json!({"role": "user", "content": "do two things"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "tool_a", "arguments": "{}"}},
                    {"id": "call_2", "type": "function", "function": {"name": "tool_b", "arguments": "{}"}}
                ]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "result a"}),
            // call_2 result is missing
        ];
        let result = detect_turn_interruption(&messages);
        assert_eq!(
            result,
            Some(InterruptionType::DanglingToolUse {
                tool_call_ids: vec!["call_2".to_string()]
            })
        );
    }

    #[test]
    fn detects_unterminated_assistant() {
        let messages = vec![
            json!({"role": "user", "content": "write code"}),
            json!({"role": "assistant", "content": "Here is the code..."}),
            // No user follow-up — crash or disconnect
        ];
        let result = detect_turn_interruption(&messages);
        assert_eq!(result, Some(InterruptionType::UnterminatedAssistant));
    }

    #[test]
    fn complete_tool_cycle_returns_none() {
        let messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "file contents"}),
            json!({"role": "assistant", "content": "Here is the file"}),
            json!({"role": "user", "content": "thanks"}),
        ];
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn repair_dangling_tool_use() {
        let mut messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
        ];
        let repaired = repair_interrupted_history(&mut messages);
        assert!(repaired);
        // Should have injected tool_result + continuation prompt
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_1");
        assert_eq!(messages[3]["role"], "user");
        // After repair, no interruption should be detected
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn repair_unterminated_assistant() {
        let mut messages = vec![
            json!({"role": "user", "content": "do something"}),
            json!({"role": "assistant", "content": "I was saying..."}),
        ];
        let repaired = repair_interrupted_history(&mut messages);
        assert!(repaired);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[2]["role"], "user");
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn no_repair_on_clean_history() {
        let mut messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
            json!({"role": "user", "content": "bye"}),
        ];
        let original_len = messages.len();
        let repaired = repair_interrupted_history(&mut messages);
        assert!(!repaired);
        assert_eq!(messages.len(), original_len);
    }

    // --- Cancel-interrupt sentinel tests ---

    #[test]
    fn sentinel_at_tail_suppresses_interruption_detection() {
        // Simulate: user cancelled after the assistant started responding.
        // Processor injected the sentinel in-memory. detect_turn_interruption
        // must return None so crash-recovery repair is skipped.
        let messages = vec![
            json!({"role": "user", "content": "do something"}),
            json!({"role": "assistant", "content": "I was starting to..."}),
            json!({"role": "user", "content": USER_INTERRUPT_SENTINEL}),
        ];
        assert!(
            detect_turn_interruption(&messages).is_none(),
            "sentinel tail must suppress UnterminatedAssistant detection"
        );
    }

    #[test]
    fn sentinel_at_tail_suppresses_dangling_tool_use_detection() {
        // Simulate: user cancelled during tool execution. Tool call was
        // emitted by the assistant but the result was never returned. The
        // processor injected the sentinel in-memory. Must not trigger repair.
        let messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "user", "content": USER_INTERRUPT_SENTINEL}),
        ];
        assert!(
            detect_turn_interruption(&messages).is_none(),
            "sentinel tail must suppress DanglingToolUse detection after cancel"
        );
    }

    #[test]
    fn non_sentinel_user_at_tail_still_clean() {
        // A normal user message at the tail is already clean — must return None.
        let messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
            json!({"role": "user", "content": "thanks, that was good"}),
        ];
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn repair_does_not_fire_when_sentinel_present() {
        // End-to-end: repair_interrupted_history must be a no-op when the
        // sentinel is already at the tail.
        let mut messages = vec![
            json!({"role": "user", "content": "do something"}),
            json!({"role": "assistant", "content": "Started, but..."}),
            json!({"role": "user", "content": USER_INTERRUPT_SENTINEL}),
        ];
        let original_len = messages.len();
        let repaired = repair_interrupted_history(&mut messages);
        assert!(!repaired, "repair must be skipped when sentinel is present");
        assert_eq!(messages.len(), original_len);
    }

    // --- filter_unresolved_tool_uses tests ---

    #[test]
    fn filter_removes_orphan_assistant_and_partial_results() {
        let mut messages = vec![
            json!({"role": "user", "content": "do two things"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    {"id": "call_1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                    {"id": "call_2", "type": "function", "function": {"name": "b", "arguments": "{}"}}
                ]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "ok"}),
        ];
        let removed = filter_unresolved_tool_uses(&mut messages);
        assert_eq!(removed, 2);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        assert!(detect_turn_interruption(&messages).is_none());
    }

    #[test]
    fn filter_removes_synthetic_continuation_injected_by_previous_repair() {
        let mut messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            // Synthetic rows a prior repair_interrupted_history pass injected:
            json!({"role": "tool", "tool_call_id": "call_1", "content": "Tool execution was interrupted by a crash. Retry if needed."}),
            json!({"role": "user", "content": "Your previous response was interrupted. Continue from where you left off."}),
        ];
        // These messages do not look like "orphan tool_use" anymore after repair
        // injected a tool result, so they should pass through untouched.
        let removed = filter_unresolved_tool_uses(&mut messages);
        assert_eq!(removed, 0);
        assert_eq!(messages.len(), 4);
    }

    #[test]
    fn filter_noop_on_clean_history() {
        let mut messages = vec![
            json!({"role": "user", "content": "hello"}),
            json!({"role": "assistant", "content": "hi"}),
        ];
        let removed = filter_unresolved_tool_uses(&mut messages);
        assert_eq!(removed, 0);
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn filter_noop_when_all_tool_results_present() {
        let mut messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "contents"}),
            json!({"role": "assistant", "content": "Here is the file"}),
        ];
        let removed = filter_unresolved_tool_uses(&mut messages);
        assert_eq!(removed, 0);
        assert_eq!(messages.len(), 4);
    }

    #[test]
    fn filter_empty_history_is_safe() {
        let mut messages: Vec<Value> = Vec::new();
        let removed = filter_unresolved_tool_uses(&mut messages);
        assert_eq!(removed, 0);
        assert!(messages.is_empty());
    }

    #[test]
    fn ensure_pairing_repairs_mid_history_orphan_before_new_user_turn() {
        let mut messages = vec![
            json!({"role": "system", "content": "prompt"}),
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "user", "content": "new prompt after stop"}),
        ];

        assert!(ensure_tool_result_pairing(&mut messages));
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "call_1");
        assert_eq!(messages[4]["role"], "user");
        assert_eq!(messages[4]["content"], "new prompt after stop");
    }

    #[test]
    fn ensure_pairing_strips_orphan_tool_rows() {
        let mut messages = vec![
            json!({"role": "system", "content": "prompt"}),
            json!({"role": "tool", "tool_call_id": "missing", "content": "late result"}),
            json!({"role": "user", "content": "continue"}),
        ];

        assert!(ensure_tool_result_pairing(&mut messages));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn ensure_pairing_dedupes_duplicate_tool_results() {
        let mut messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "first"}),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "duplicate"}),
            json!({"role": "user", "content": "next"}),
        ];

        assert!(ensure_tool_result_pairing(&mut messages));
        let tool_rows: Vec<&Value> = messages
            .iter()
            .filter(|msg| msg_role(msg) == "tool")
            .collect();
        assert_eq!(tool_rows.len(), 1);
        assert_eq!(tool_rows[0]["content"], "first");
        assert_eq!(messages.last().unwrap()["content"], "next");
    }

    #[test]
    fn ensure_pairing_noops_clean_history() {
        let mut messages = vec![
            json!({"role": "user", "content": "read file"}),
            json!({
                "role": "assistant",
                "content": null,
                "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
            }),
            json!({"role": "tool", "tool_call_id": "call_1", "content": "contents"}),
            json!({"role": "assistant", "content": "done"}),
        ];
        let original = messages.clone();

        assert!(!ensure_tool_result_pairing(&mut messages));
        assert_eq!(messages, original);
    }
}
