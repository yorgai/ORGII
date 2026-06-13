//! Lightweight per-turn context cleanup (no LLM call).
//!
//! Replaces old, large tool results with a short placeholder so they stop
//! consuming context window tokens. Unlike full compaction this is a pure
//! data-structure pass — zero latency, zero cost.
//!
//! **Trigger model (time-based):** When the gap since the last assistant
//! message exceeds a configurable threshold the server-side prompt cache
//! has almost certainly expired, so the full prefix will be rewritten
//! anyway.  Clearing old tool results *before* the request shrinks what
//! gets sent.  Within a fast agentic loop (gap < threshold) we skip MC
//! entirely — the cache is warm and mutating content would break the
//! cached prefix.
//!
//! Reference: `claude_code/services/compact/microCompact.ts`
//! (time-based MC path, `evaluateTimeBasedTrigger`).

#[cfg(test)]
#[path = "tests/microcompact_tests.rs"]
mod tests;

use serde_json::Value;
use tracing::info;

use crate::core::turn_executor::helpers::{STRUCTURED_CONTENT_BLOCKS_KEY, STRUCTURED_SIDECAR_KEY};
use crate::tools::names as tool_names;

/// Replacement text inserted in place of cleared tool results.
const CLEARED_MESSAGE: &str = "[Old tool result content cleared]";

/// Tools whose results are eligible for microcompact.
const COMPACTABLE_TOOLS: &[&str] = &[
    tool_names::READ_FILE,
    tool_names::RUN_SHELL,
    tool_names::AWAIT_OUTPUT,
    tool_names::CODE_SEARCH,
    tool_names::LIST_DIR,
    tool_names::WEB_SEARCH,
    tool_names::WEB_FETCH,
    tool_names::EDIT_FILE,
    tool_names::AGENT,
];

/// Internal metadata key stamped on tool-result messages so we know
/// when they were created. Stripped before sending to the LLM.
pub const TIMESTAMP_META_KEY: &str = "_mc_ts";

/// Configuration for microcompact behaviour.
#[derive(Debug, Clone)]
pub struct MicrocompactConfig {
    /// Trigger microcompact when the gap since the last assistant message
    /// exceeds this many seconds.  Default 3600 (60 min) matches the
    /// Anthropic prompt-cache TTL — after this the server cache has expired
    /// so we won't break a cached prefix.
    pub gap_threshold_secs: u64,
    /// Always keep at least this many of the most recent compactable tool
    /// results untouched, even when the time trigger fires.
    pub keep_recent: usize,
    /// Only clear tool results whose content exceeds this character count.
    pub min_content_chars: usize,
}

impl Default for MicrocompactConfig {
    fn default() -> Self {
        Self {
            gap_threshold_secs: 3600,
            keep_recent: 5,
            min_content_chars: 500,
        }
    }
}

/// Placeholder for cleared image/multimodal content blocks.
const IMAGE_CLEARED_MESSAGE: &str = "[Image content cleared — old turn]";

/// Stats returned after a microcompact pass.
#[derive(Debug, Default)]
pub struct MicrocompactStats {
    pub trimmed_count: usize,
    pub chars_saved: usize,
    pub images_cleared: usize,
}

/// Return the current wall-clock time as milliseconds since the Unix epoch.
/// Used as the source-of-truth timestamp for stamping tool results.
pub fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Evaluate whether the time-based trigger should fire.
///
/// Finds the most recent assistant message, computes the wall-clock gap,
/// and returns the gap (in seconds) when it exceeds the threshold.
/// Returns `None` when the trigger should *not* fire (no assistant yet,
/// gap under threshold).
fn evaluate_time_trigger(messages: &[Value], config: &MicrocompactConfig) -> Option<u64> {
    let now_ms = now_epoch_ms();

    let last_assistant_ts = messages
        .iter()
        .rev()
        .filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("assistant"))
        .find_map(|m| m.get(TIMESTAMP_META_KEY).and_then(|v| v.as_u64()));

    let ts_ms = last_assistant_ts?;
    let gap_secs = now_ms.saturating_sub(ts_ms) / 1000;
    if gap_secs >= config.gap_threshold_secs {
        Some(gap_secs)
    } else {
        None
    }
}

/// Run a microcompact pass over `messages`, replacing old large tool results
/// with [`CLEARED_MESSAGE`].
///
/// **Time-based trigger:** Only fires when the gap since the last assistant
/// message exceeds `config.gap_threshold_secs`.  Within a fast agentic
/// loop the function is a no-op (returns zero stats).
///
/// Call this at the start of each LLM iteration.
pub fn microcompact_messages(
    messages: &mut [Value],
    config: &MicrocompactConfig,
) -> MicrocompactStats {
    let gap_secs = match evaluate_time_trigger(messages, config) {
        Some(gap) => gap,
        None => return MicrocompactStats::default(),
    };
    let stats = clear_old_tool_results(messages, config);
    if stats.trimmed_count > 0 || stats.images_cleared > 0 {
        info!(
            "[microcompact] Time-based trigger fired (gap {}s > {}s). Cleared {} tool result(s) + {} image(s), saved ~{} chars",
            gap_secs, config.gap_threshold_secs,
            stats.trimmed_count, stats.images_cleared, stats.chars_saved
        );
    }
    stats
}

/// Run the microcompact clearing pass **unconditionally**, bypassing the
/// time-based trigger. Used as the first-line `ContextTooLong` rescue in
/// `execute_turn`: clearing old tool results is lossy but cheap, never
/// fails, and is strictly better than aborting the turn (and losing all
/// progress) because the provider rejected the prompt.
pub fn force_microcompact_messages(
    messages: &mut [Value],
    config: &MicrocompactConfig,
) -> MicrocompactStats {
    let stats = clear_old_tool_results(messages, config);
    if stats.trimmed_count > 0 || stats.images_cleared > 0 {
        info!(
            "[microcompact] Forced pass (context rescue). Cleared {} tool result(s) + {} image(s), saved ~{} chars",
            stats.trimmed_count, stats.images_cleared, stats.chars_saved
        );
    }
    stats
}

fn clear_old_tool_results(
    messages: &mut [Value],
    config: &MicrocompactConfig,
) -> MicrocompactStats {
    let tool_result_indices: Vec<usize> = messages
        .iter()
        .enumerate()
        .filter(|(_, msg)| {
            msg.get("role").and_then(|v| v.as_str()) == Some("tool")
                && COMPACTABLE_TOOLS
                    .contains(&msg.get("name").and_then(|v| v.as_str()).unwrap_or(""))
        })
        .map(|(idx, _)| idx)
        .collect();

    let total = tool_result_indices.len();
    let keep = config.keep_recent.max(1).min(total);
    let keep_set: std::collections::HashSet<usize> = tool_result_indices
        [total.saturating_sub(keep)..]
        .iter()
        .copied()
        .collect();

    let mut stats = MicrocompactStats::default();

    for &idx in &tool_result_indices {
        if keep_set.contains(&idx) {
            continue;
        }
        let msg = &messages[idx];
        let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if content.len() < config.min_content_chars {
            continue;
        }
        if content == CLEARED_MESSAGE {
            continue;
        }

        let original_len = content.len();
        messages[idx]["content"] = Value::String(CLEARED_MESSAGE.to_string());
        stats.trimmed_count += 1;
        stats.chars_saved += original_len;
    }

    // Second pass: clear old image/multimodal content blocks from any message.
    for msg in messages.iter_mut() {
        let content_blocks = match msg.get_mut("content").and_then(|v| v.as_array_mut()) {
            Some(arr) => arr,
            None => continue,
        };

        for block in content_blocks.iter_mut() {
            let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if block_type == "image_url" || block_type == "image" {
                *block = serde_json::json!({
                    "type": "text",
                    "text": IMAGE_CLEARED_MESSAGE,
                });
                stats.images_cleared += 1;
            }
        }
    }

    stats
}

/// Maximum number of tool-result screenshots retained in conversation
/// history. Older images are stripped from their `_orgii_structured`
/// sidecar on every turn so they don't accumulate and blow out the
/// context window / bandwidth budget.
///
/// Each desktop-control screenshot is a full-resolution window PNG
/// (~100–500 KB base64), and a long agentic loop easily produces 20+.
/// Without a cap, every subsequent turn re-sends all of them, which
/// dominates upload latency and can push prompt tokens over provider
/// limits well before the 1-hour microcompact time trigger fires.
const MAX_RECENT_TOOL_IMAGES: usize = 3;

/// Breadcrumb text prepended to the tool-result `content` string when
/// its image block is stripped, so the model still sees "this tool
/// returned a screenshot at some point" instead of silently losing
/// the signal.
const IMAGE_STRIPPED_BREADCRUMB: &str = "[Earlier screenshot omitted to save context] ";

/// Keep only the most recent `MAX_RECENT_TOOL_IMAGES` screenshots in
/// the `_orgii_structured.content_blocks[]` sidecars across the entire
/// message history. Older images are removed from the sidecar and a
/// short breadcrumb is prepended to the tool message's `content` text
/// so the model retains the fact that a screenshot once existed.
///
/// Runs every turn (unlike time-based microcompact) because images
/// inflate the wire payload far faster than they inflate token
/// counts, and the 1-hour idle trigger is too coarse for a fast
/// agentic loop doing 30 clicks in 5 minutes.
///
/// Returns the number of images stripped on this pass.
pub fn cap_recent_tool_images(messages: &mut [Value]) -> usize {
    // Walk newest → oldest so we can keep the first N images we see
    // and strip the rest. Image blocks live inside `_orgii_structured
    // .content_blocks[]` with `type: "image"`.
    let mut kept = 0usize;
    let mut stripped = 0usize;

    for msg in messages.iter_mut().rev() {
        if msg.get("role").and_then(Value::as_str) != Some("tool") {
            continue;
        }
        let Some(sidecar) = msg.get_mut(STRUCTURED_SIDECAR_KEY) else {
            continue;
        };
        let Some(blocks) = sidecar
            .get_mut(STRUCTURED_CONTENT_BLOCKS_KEY)
            .and_then(Value::as_array_mut)
        else {
            continue;
        };

        // Partition this message's blocks into (image, keep) buckets.
        // `retain` can't mutate the outer counters, so we do a manual
        // pass with the newest-first ordering preserved.
        let mut new_blocks: Vec<Value> = Vec::with_capacity(blocks.len());
        let mut stripped_in_msg = 0usize;
        for block in blocks.drain(..) {
            let is_image = block.get("type").and_then(Value::as_str) == Some("image");
            if !is_image {
                new_blocks.push(block);
                continue;
            }
            if kept < MAX_RECENT_TOOL_IMAGES {
                kept += 1;
                new_blocks.push(block);
            } else {
                stripped_in_msg += 1;
                stripped += 1;
            }
        }
        *blocks = new_blocks;

        if stripped_in_msg > 0 {
            // Prepend breadcrumb to the tool message content so the
            // model knows the screenshot existed. Only do this once
            // per message even if multiple images got stripped.
            if let Some(Value::String(ref mut s)) = msg.get_mut("content") {
                if !s.starts_with(IMAGE_STRIPPED_BREADCRUMB) {
                    *s = format!("{}{}", IMAGE_STRIPPED_BREADCRUMB, s);
                }
            }
        }
    }

    if stripped > 0 {
        info!(
            "[microcompact] Stripped {} old screenshot(s) from tool-result sidecars (keeping most recent {})",
            stripped, MAX_RECENT_TOOL_IMAGES,
        );
    }
    stripped
}

/// Strip the internal `_mc_ts` metadata key from all messages before
/// sending them to the LLM. This avoids leaking internal bookkeeping
/// into the API request.
pub fn strip_timestamp_metadata(messages: &mut [Value]) {
    for msg in messages.iter_mut() {
        if let Some(obj) = msg.as_object_mut() {
            obj.remove(TIMESTAMP_META_KEY);
        }
    }
}

// ============================================
// Aggregate Budget — per-message budget enforcement
// ============================================

/// Max total characters of tool results allowed in a single assistant message's
/// associated tool result block (200,000).
const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS: usize = 200_000;

/// Tracks which tool result messages have been replaced, ensuring prompt cache
/// stability across turns. Once a result is cleared, the decision is sticky —
/// we never un-clear it even if budget frees up later.
#[derive(Debug, Default, Clone)]
pub struct ReplacementState {
    /// Set of tool_call_ids whose results have been replaced with `CLEARED_MESSAGE`.
    cleared_ids: std::collections::HashSet<String>,
}

impl ReplacementState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_cleared(&self, tool_call_id: &str) -> bool {
        self.cleared_ids.contains(tool_call_id)
    }

    fn mark_cleared(&mut self, tool_call_id: &str) {
        self.cleared_ids.insert(tool_call_id.to_string());
    }
}

/// Enforce an aggregate budget on tool results per assistant message group.
///
/// Walks messages from oldest to newest. For each group of tool result
/// messages following an assistant message, if the total character count
/// exceeds `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`, the oldest results in
/// that group are replaced with `CLEARED_MESSAGE` until the group fits.
///
/// Decisions are sticky via `state`: once cleared, always cleared (prompt
/// cache stability). Call this every turn before the LLM call.
pub fn enforce_aggregate_budget(messages: &mut [Value], state: &mut ReplacementState) -> usize {
    let mut total_cleared = 0;

    // First: re-apply any previously cleared results (sticky decisions)
    for msg in messages.iter_mut() {
        if msg.get("role").and_then(|v| v.as_str()) != Some("tool") {
            continue;
        }
        let tool_call_id = msg
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if tool_call_id.is_empty() {
            continue;
        }
        if state.is_cleared(tool_call_id) {
            let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if content != CLEARED_MESSAGE {
                messages_set_content(msg, CLEARED_MESSAGE);
                total_cleared += 1;
            }
        }
    }

    // Second: find groups that exceed the budget and clear oldest-first
    let mut group_indices: Vec<usize> = Vec::new();

    let msg_count = messages.len();
    let mut idx = 0;
    while idx <= msg_count {
        let is_tool =
            idx < msg_count && messages[idx].get("role").and_then(|v| v.as_str()) == Some("tool");

        if is_tool {
            group_indices.push(idx);
        } else {
            if !group_indices.is_empty() {
                total_cleared += enforce_group_budget(messages, &group_indices, state);
            }
            group_indices.clear();
        }
        idx += 1;
    }

    if total_cleared > 0 {
        info!(
            "[aggregate-budget] Cleared {} tool result(s) to stay within per-message budget",
            total_cleared
        );
    }

    total_cleared
}

fn enforce_group_budget(
    messages: &mut [Value],
    indices: &[usize],
    state: &mut ReplacementState,
) -> usize {
    let total_chars: usize = indices
        .iter()
        .map(|&i| {
            messages[i]
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .len()
        })
        .sum();

    if total_chars <= MAX_TOOL_RESULTS_PER_MESSAGE_CHARS {
        return 0;
    }

    let mut excess = total_chars - MAX_TOOL_RESULTS_PER_MESSAGE_CHARS;
    let mut cleared = 0;

    for &i in indices {
        if excess == 0 {
            break;
        }
        let content = messages[i]
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if content == CLEARED_MESSAGE || content.len() < 100 {
            continue;
        }
        let tool_name = messages[i]
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !COMPACTABLE_TOOLS.contains(&tool_name) {
            continue;
        }

        let saved = content.len().saturating_sub(CLEARED_MESSAGE.len());
        let tool_call_id = messages[i]
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        messages_set_content(&mut messages[i], CLEARED_MESSAGE);
        if !tool_call_id.is_empty() {
            state.mark_cleared(&tool_call_id);
        }
        cleared += 1;
        excess = excess.saturating_sub(saved);
    }

    cleared
}

fn messages_set_content(msg: &mut Value, text: &str) {
    msg["content"] = Value::String(text.to_string());
}
