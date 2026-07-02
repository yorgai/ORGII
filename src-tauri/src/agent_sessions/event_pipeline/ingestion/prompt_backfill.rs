use serde_json::Value;

use crate::agent_sessions::event_pipeline::types::SessionEvent;

fn is_generic_task_label(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "task" | "todo" | "assigned task to subagent"
    )
}

fn is_paste_placeholder(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.contains("paste://") || value.contains("[paste:") || value.starts_with("pasted.txt")
}

fn is_result_like_report(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("now i have all the data")
        || value.starts_with("here is the comprehensive report")
        || value.starts_with("# comprehensive `")
        || value.starts_with("# comprehensive .rs")
}

fn strip_known_prompt_prelude(value: &str) -> &str {
    let mut rest = value.trim();
    loop {
        let tag = if rest.starts_with("<skills>") {
            "skills"
        } else if rest.starts_with("<orgii_cli_exec_mode_bridge>") {
            "orgii_cli_exec_mode_bridge"
        } else {
            break;
        };
        let close_tag = format!("</{tag}>");
        let Some(close_idx) = rest.find(&close_tag) else {
            break;
        };
        rest = rest[close_idx + close_tag.len()..].trim_start();
    }
    rest.trim()
}

fn is_parent_delegation_request(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.contains("subagent")
        && value.contains("启动")
        && (value.contains("让它") || value.contains("必须要用subagent"))
}

pub fn is_good_subagent_prompt(value: &str) -> bool {
    let value = strip_known_prompt_prelude(value);
    !value.is_empty()
        && !is_generic_task_label(value)
        && !is_paste_placeholder(value)
        && !is_result_like_report(value)
        && !is_parent_delegation_request(value)
}

pub(crate) fn non_generic_subagent_prompt(value: String) -> Option<String> {
    let value = strip_known_prompt_prelude(&value).to_string();
    is_good_subagent_prompt(&value).then_some(value)
}

pub(crate) fn prompt_from_history_chunks(
    chunks: &[core_types::activity::ActivityChunk],
) -> Option<String> {
    chunks.iter().find_map(|chunk| {
        if chunk.function != "user_message" {
            return None;
        }
        let prompt = chunk
            .result
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(|value| value.as_str())
            .or_else(|| chunk.result.get("content").and_then(|value| value.as_str()))
            .or_else(|| {
                chunk
                    .result
                    .get("observation")
                    .and_then(|value| value.as_str())
            })?;
        non_generic_subagent_prompt(prompt.to_string())
    })
}

pub fn backfill_subagent_prompts_with_resolver(
    events: &mut [SessionEvent],
    mut prompt_for_child: impl FnMut(&str) -> Option<String>,
) {
    for event in events {
        if event.function_name != "subagent" && event.ui_canonical != "subagent" {
            continue;
        }
        let Some(args) = event.args.as_object_mut() else {
            continue;
        };
        let has_prompt = args
            .get("prompt")
            .and_then(|value| value.as_str())
            .map(is_good_subagent_prompt)
            .unwrap_or(false);
        if has_prompt {
            continue;
        }
        let Some(child_session_id) = args
            .get("subagentSessionId")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(prompt) = prompt_for_child(child_session_id) else {
            continue;
        };
        args.insert("prompt".to_string(), Value::String(prompt.clone()));
        let should_replace_description = args
            .get("description")
            .and_then(|value| value.as_str())
            .map(|description| !is_good_subagent_prompt(description))
            .unwrap_or(true);
        if should_replace_description {
            args.insert("description".to_string(), Value::String(prompt));
        }
    }
}
