//! Post-compaction cleanup pass.
//!
//! After LLM-based compaction replaces older messages with a summary,
//! orphaned tool-result messages (whose parent assistant `tool_calls`
//! were compacted away) can remain. This module removes them.
//!
//! Reference: `claude_code/services/compact/postCompactCleanup.ts`

#[cfg(test)]
#[path = "tests/cleanup_tests.rs"]
mod tests;

use std::collections::HashSet;

use serde_json::Value;
use tracing::info;

/// Remove orphaned tool results and deduplicate consecutive system messages.
///
/// An "orphaned" tool result is one whose `tool_call_id` does not appear
/// in any assistant message's `tool_calls` array. These arise when
/// compaction summarises the assistant messages but leaves the tool
/// results behind.
pub fn post_compact_cleanup(messages: Vec<Value>) -> Vec<Value> {
    let valid_tool_call_ids = collect_tool_call_ids(&messages);

    let mut out: Vec<Value> = Vec::with_capacity(messages.len());
    let mut removed_orphans: usize = 0;
    let mut removed_dupes: usize = 0;

    for msg in messages {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");

        if role == "tool" {
            let tc_id = msg
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !tc_id.is_empty() && !valid_tool_call_ids.contains(tc_id) {
                removed_orphans += 1;
                continue;
            }
        }

        if role == "system" {
            if let Some(prev) = out.last() {
                if prev.get("role").and_then(|v| v.as_str()) == Some("system")
                    && prev.get("content") == msg.get("content")
                {
                    removed_dupes += 1;
                    continue;
                }
            }
        }

        out.push(msg);
    }

    if removed_orphans > 0 || removed_dupes > 0 {
        info!(
            "[post-compact-cleanup] Removed {} orphaned tool result(s), {} duplicate system message(s)",
            removed_orphans, removed_dupes
        );
    }

    out
}

/// Collect every `tool_call_id` referenced in assistant messages' `tool_calls` arrays.
fn collect_tool_call_ids(messages: &[Value]) -> HashSet<String> {
    let mut ids = HashSet::new();
    for msg in messages {
        if msg.get("role").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        if let Some(tool_calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                    ids.insert(id.to_string());
                }
            }
        }
    }
    ids
}
