//! Summarization prompt and message formatting helpers for context compaction.

use serde_json::Value;

use super::compaction::ContextCompactor;
use crate::core::side_query::{self, SideQueryConfig, StructuredOutput};

/// Truncate text for inclusion in the summary prompt.
pub(crate) fn truncate_for_summary(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        text.to_string()
    } else {
        let boundary = text
            .char_indices()
            .map(|(i, _)| i)
            .take_while(|&i| i <= max_chars)
            .last()
            .unwrap_or(0);
        format!("{}... [truncated]", &text[..boundary])
    }
}

// ============================================
// Summarization Prompt
// ============================================

pub(crate) const SUMMARIZATION_SYSTEM_PROMPT: &str = r#"You are a context compactor. Your job is to summarize a conversation between a user and an AI assistant, preserving the most important information for continued work.

## Instructions

Produce a concise summary that captures:

1. **Decisions made** — What the user decided, what approach was chosen, any preferences stated
2. **Files changed** — Which files were created, edited, or deleted, and what the changes were
3. **Errors encountered** — Any errors, their causes, and how they were resolved
4. **Current state** — What is the project/task state right now? What was the last thing done?
5. **Pending items** — Any tasks mentioned but not yet completed, next steps discussed
6. **Key context** — Names, paths, IDs, configurations, or technical details that the assistant will need to continue the work

## Format

Write the summary as structured bullet points grouped by topic. Use markdown formatting.
Be concise but preserve specifics (exact file paths, error messages, config values).
Do NOT include pleasantries or conversational filler.
Target ~500-1000 words."#;

// ============================================
// Message Formatting
// ============================================

/// Format messages (references) into a readable representation for the summarizer.
pub(crate) fn format_messages_for_summary_refs(messages: &[&Value]) -> String {
    let mut parts = Vec::new();

    for msg in messages {
        let role = msg
            .get("role")
            .and_then(|val| val.as_str())
            .unwrap_or("unknown");
        let content = msg
            .get("content")
            .and_then(|val| val.as_str())
            .unwrap_or("");

        match role {
            "user" => {
                parts.push(format!("**User:** {}", truncate_for_summary(content, 500)));
            }
            "assistant" => {
                let tool_calls = format_tool_calls(msg);
                if content.is_empty() && !tool_calls.is_empty() {
                    parts.push(format!("**Assistant:**\n{}", tool_calls));
                } else if !content.is_empty() {
                    let mut entry =
                        format!("**Assistant:** {}", truncate_for_summary(content, 500));
                    if !tool_calls.is_empty() {
                        entry.push_str(&format!("\n{}", tool_calls));
                    }
                    parts.push(entry);
                }
            }
            "tool" => {
                let tool_name = msg
                    .get("name")
                    .and_then(|val| val.as_str())
                    .unwrap_or("unknown");
                parts.push(format!(
                    "**Tool result ({}):** {}",
                    tool_name,
                    truncate_for_summary(content, 300)
                ));
            }
            "system" => {}
            _ => {
                parts.push(format!(
                    "**{}:** {}",
                    role,
                    truncate_for_summary(content, 200)
                ));
            }
        }
    }

    parts.join("\n\n")
}

/// Format tool calls from an assistant message.
pub(crate) fn format_tool_calls(msg: &Value) -> String {
    msg.get("tool_calls")
        .and_then(|tc| tc.as_array())
        .map(|arr| {
            arr.iter()
                .map(|tc| {
                    let name = tc
                        .get("function")
                        .and_then(|func| func.get("name"))
                        .and_then(|val| val.as_str())
                        .unwrap_or("unknown");
                    let args = tc
                        .get("function")
                        .and_then(|func| func.get("arguments"))
                        .and_then(|val| val.as_str())
                        .unwrap_or("{}");
                    format!(
                        "  → tool_call: {}({})",
                        name,
                        truncate_for_summary(args, 200)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// Generate a summary of messages using the LLM.
///
/// Oversized messages (>50% of context window) are excluded from
/// summarization and noted separately to avoid exceeding the
/// summarization model's context window.
pub(crate) async fn summarize_messages(
    messages: &[Value],
    state: &super::compaction::CompactionState,
    provider: &dyn crate::providers::traits::LLMProvider,
    model: &str,
    config: &super::compaction::CompactionConfig,
    budget_tokens: usize,
) -> Result<String, String> {
    let budget = budget_tokens;
    let mut summarizable: Vec<&Value> = Vec::new();
    let mut oversized_notes: Vec<String> = Vec::new();

    for msg in messages {
        if ContextCompactor::is_oversized(msg, budget) {
            let role = msg
                .get("role")
                .and_then(|val| val.as_str())
                .unwrap_or("message");
            let tokens = ContextCompactor::estimate_message_tokens(msg);
            oversized_notes.push(format!(
                "[Large {} (~{}K tokens) omitted from summary]",
                role,
                tokens / 1000
            ));
        } else {
            summarizable.push(msg);
        }
    }

    if !oversized_notes.is_empty() {
        tracing::info!(
            "[compaction] {} oversized messages excluded from summarization",
            oversized_notes.len()
        );
    }

    let formatted = format_messages_for_summary_refs(&summarizable);

    let mut prompt = String::from(SUMMARIZATION_SYSTEM_PROMPT);

    if state.recompaction_info.compaction_count > 0 {
        prompt.push_str(&format!(
            "\n\n## Re-compaction Context\n\nThis is compaction #{} for this session (last at turn {}). \
             Merge the prior summary with the new messages — preserve important details from both, \
             but prioritize recent information when there are conflicts or superseded decisions.",
            state.recompaction_info.compaction_count + 1,
            state.recompaction_info.last_compaction_turn,
        ));
    }

    if let Some(ref prior_summary) = state.summary {
        prompt.push_str(&format!(
            "\n\n## Prior Context Summary\n\n{}\n\n## New Messages to Incorporate\n\n",
            prior_summary
        ));
    }

    let user_message = vec![serde_json::json!({
        "role": "user",
        "content": formatted,
    })];

    let sq_config = SideQueryConfig {
        model: None,
        max_tokens: config.summary_max_tokens,
        temperature: 0.0,
        system_prompt: Some(prompt),
        structured: Some(StructuredOutput {
            tool_name: "emit_summary".to_string(),
            schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "The concise summary of the conversation"
                    }
                },
                "required": ["summary"]
            }),
        }),
        ..Default::default()
    };

    let result = side_query::side_query(provider, &user_message, &sq_config, model).await?;

    // Extract from structured output (forced tool call) if available,
    // fall back to text content for providers that don't support tool_choice.
    let mut summary = if let Some(structured) = result.structured {
        structured
            .get("summary")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        result.content
    };

    if !oversized_notes.is_empty() {
        summary.push_str("\n\n");
        summary.push_str(&oversized_notes.join("\n"));
    }

    Ok(summary)
}
