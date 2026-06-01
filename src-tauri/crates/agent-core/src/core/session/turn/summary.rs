//! Turn completion summary: generates a concise digest after long turns.
//!
//! When the agent finishes a turn that involved significant work (many tool
//! calls or long wall time), this module generates a 1-3 sentence summary
//! via a lightweight `side_query` call. The summary is broadcast to the
//! frontend as an `agent:turn_summary` event.
//!
//! Ref: claude_code/services/awaySummary.ts

use serde_json::Value;
use tracing::{info, warn};

use crate::bus::broadcast_event;
use crate::core::side_query::{self, SideQueryConfig};
use crate::providers::traits::LLMProvider;

const SUMMARY_PROMPT: &str = "\
Summarize what was accomplished in 1-3 short sentences. \
Start by stating the high-level task — what the user is building or debugging, not implementation details. \
Then state the concrete result or next step. \
Skip implementation details, commit recaps, and pleasantries.";

/// Maximum number of recent messages to include in the summary context.
const SUMMARY_RECENT_MESSAGES: usize = 30;

/// Minimum tool calls in a turn to trigger a summary.
const MIN_TOOL_CALLS: u32 = 5;

/// Minimum wall time (seconds) to trigger a summary.
const MIN_WALL_SECS: u64 = 60;

/// Determine whether a turn qualifies for a completion summary.
pub fn should_summarize(tool_calls_count: u32, wall_time_secs: u64) -> bool {
    tool_calls_count >= MIN_TOOL_CALLS || wall_time_secs >= MIN_WALL_SECS
}

/// Generate and broadcast a turn completion summary.
///
/// Takes the most recent messages from the conversation, generates a concise
/// summary via `side_query`, and broadcasts it as `agent:turn_summary`.
/// Returns the summary text if generation succeeded.
pub async fn generate_and_broadcast(
    messages: &[Value],
    provider: &dyn LLMProvider,
    model: &str,
    session_id: &str,
    turn_id: &str,
    created_at: &str,
    tool_calls_count: u32,
    wall_time_secs: u64,
) -> Option<String> {
    let recent: Vec<Value> = messages
        .iter()
        .rev()
        .filter(|msg| {
            msg.get("role")
                .and_then(|val| val.as_str())
                .is_some_and(|role| role != "system")
        })
        .take(SUMMARY_RECENT_MESSAGES)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    if recent.is_empty() {
        return None;
    }

    let formatted = recent
        .iter()
        .filter_map(|msg| {
            let role = msg.get("role")?.as_str()?;
            let content = msg
                .get("content")
                .and_then(|val| val.as_str())
                .unwrap_or("");
            if content.is_empty() && role != "assistant" {
                return None;
            }
            let truncated = if content.len() > 300 {
                let boundary = content
                    .char_indices()
                    .map(|(i, _)| i)
                    .take_while(|&i| i <= 300)
                    .last()
                    .unwrap_or(0);
                format!("{}...", &content[..boundary])
            } else {
                content.to_string()
            };
            Some(format!("[{}] {}", role, truncated))
        })
        .collect::<Vec<_>>()
        .join("\n");

    let user_messages = vec![serde_json::json!({
        "role": "user",
        "content": formatted,
    })];

    let config = SideQueryConfig {
        max_tokens: 256,
        temperature: 0.0,
        system_prompt: Some(SUMMARY_PROMPT.to_string()),
        ..SideQueryConfig::default()
    };

    info!(
        "[turn-summary] Generating summary for session={} (tool_calls={}, wall_time={}s)",
        session_id, tool_calls_count, wall_time_secs
    );

    match side_query::side_query(provider, &user_messages, &config, model).await {
        Ok(result) => {
            info!(
                "[turn-summary] Summary generated: {} chars",
                result.content.len()
            );
            broadcast_event(
                "agent:turn_summary",
                serde_json::json!({
                    "sessionId": session_id,
                    "turnId": turn_id,
                    "createdAt": created_at,
                    "summary": result.content,
                    "toolCalls": tool_calls_count,
                    "wallTimeSecs": wall_time_secs,
                }),
            );
            Some(result.content)
        }
        Err(err) => {
            warn!("[turn-summary] Failed to generate summary: {}", err);
            None
        }
    }
}

#[cfg(test)]
#[path = "../tests/summary_tests.rs"]
mod tests;
