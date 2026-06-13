//! Miscellaneous extractors: thinking, message, todo, web_search, subagent,
//! delete_file, and org_task family.

use agent_core::core::tools::names as tool_names;

use super::helpers::{
    normalized_result_object, obj_bool, obj_f64, obj_i64, obj_str, obj_string_array,
};
use crate::agent_sessions::event_pipeline::extractors::types::*;
use crate::agent_sessions::event_pipeline::types::SessionEvent;

pub(super) fn extract_thinking(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedThinkingData {
    let content = result
        .and_then(|r| {
            obj_str(r, "thought")
                .or_else(|| obj_str(r, "content"))
                .or_else(|| obj_str(r, "observation"))
        })
        .or_else(|| args.and_then(|a| obj_str(a, "content")));

    let duration = result.and_then(|r| obj_f64(r, "duration"));

    ExtractedThinkingData { content, duration }
}

pub(super) fn extract_message(event: &SessionEvent) -> ExtractedMessageData {
    let is_user = event.source == crate::agent_sessions::event_pipeline::types::EventSource::User;
    let content = event
        .result
        .as_object()
        .and_then(|r| obj_str(r, "content").or_else(|| obj_str(r, "observation")))
        .or_else(|| Some(event.display_text.clone()));

    ExtractedMessageData { content, is_user }
}

pub(super) fn extract_todo(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedTodoData {
    let mut todos_value: Option<serde_json::Value> = None;
    let mut was_merge = false;

    // Primary source: structured `uiMetadata` embedded by the dual-track
    // tool-result path (`Tool::ui_metadata` → `build_tool_result_event`).
    // This is exact data from the tool — no text re-parsing involved.
    if let Some(meta_todos) = result
        .and_then(|r| r.get("uiMetadata"))
        .and_then(|v| v.as_object())
        .filter(|meta| meta.get("display_type").and_then(|v| v.as_str()) == Some("todo_list"))
        .and_then(|meta| meta.get("data"))
        .and_then(|v| v.as_object())
        .and_then(|data| data.get("todos"))
    {
        todos_value = Some(meta_todos.clone());
    }

    // Try observation next (legacy hosted-service source)
    if todos_value.is_none() {
        if let Some(obs) = result.and_then(|r| r.get("observation")) {
            let parsed = if let Some(s) = obs.as_str() {
                // The todo tool emits its observation as a JSON-stringified
                // object. Falling back to `None` here is intentional — the
                // event-pipeline extractors must not abort the whole event
                // on a corrupt observation string — but we warn so the
                // upstream-tool corruption surfaces in logs instead of
                // silently producing a "no todos" UI panel.
                match serde_json::from_str::<serde_json::Value>(s) {
                    Ok(v) => Some(v),
                    Err(err) => {
                        tracing::warn!(
                            error = %err,
                            len = s.len(),
                            "extractors::extract_todo: observation string is not valid JSON; skipping"
                        );
                        None
                    }
                }
            } else {
                Some(obs.clone())
            };

            if let Some(ref parsed_val) = parsed {
                if let Some(obj) = parsed_val.as_object() {
                    if let Some(success) = obj.get("success").and_then(|v| v.as_object()) {
                        if let Some(t) = success.get("todos") {
                            todos_value = Some(t.clone());
                            was_merge = success
                                .get("wasMerge")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                        }
                    } else if let Some(t) = obj.get("todos") {
                        todos_value = Some(t.clone());
                        was_merge = obj
                            .get("wasMerge")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                    }
                }
            }
        }
    }

    // Fallback: try other locations
    let needs_fallback = todos_value
        .as_ref()
        .map(|t| t.as_array().map(|a| a.is_empty()).unwrap_or(true))
        .unwrap_or(true);

    if needs_fallback {
        let candidates: [Option<&serde_json::Value>; 5] = [
            args.and_then(|a| a.get("todos")),
            result
                .and_then(|r| r.get("output"))
                .and_then(|v| v.as_object())
                .and_then(|o| o.get("success"))
                .and_then(|v| v.as_object())
                .and_then(|s| s.get("todos")),
            result
                .and_then(|r| r.get("output"))
                .and_then(|v| v.as_object())
                .and_then(|o| o.get("todos")),
            result
                .and_then(|r| r.get("success"))
                .and_then(|v| v.as_object())
                .and_then(|s| s.get("todos")),
            result.and_then(|r| r.get("todos")),
        ];

        if let Some(t) = candidates.iter().flatten().next() {
            todos_value = Some((*t).clone());
        }
    }

    // Last resort — covers every persisted ORGII `manage_todo` event before
    // the dual-track uiMetadata path existed: the native tool's result is
    // `{"content": "<header>\n[pretty-printed JSON array]\n<nudge>"}`. None
    // of the structured probes above match that shape, so parse the embedded
    // array back out of the LLM-facing text. `args.todos` only exists for
    // `action:"write"`; `update`/`read` events depend entirely on this path.
    let still_empty = todos_value
        .as_ref()
        .map(|t| t.as_array().map(|a| a.is_empty()).unwrap_or(true))
        .unwrap_or(true);
    if still_empty {
        if let Some(text) = result.and_then(|r| obj_str(r, "content")) {
            if let Some(parsed) = parse_embedded_todo_array(&text) {
                todos_value = Some(parsed);
            }
        }
    }

    let todos: Vec<TodoItem> = todos_value
        .as_ref()
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    let blocked_by = obj
                        .get("blockedBy")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_u64().map(|n| n as usize))
                                .collect()
                        })
                        .unwrap_or_default();
                    // Native tool snapshots key rows by `index`; hosted
                    // formats use a string `id`. Either works as a stable id.
                    let id = obj_str(obj, "id").unwrap_or_else(|| {
                        obj.get("index")
                            .and_then(|v| v.as_u64())
                            .map(|n| n.to_string())
                            .unwrap_or_default()
                    });
                    Some(TodoItem {
                        id,
                        content: obj_str(obj, "content")
                            .or_else(|| obj_str(obj, "description"))
                            .unwrap_or_default(),
                        status: obj_str(obj, "status").unwrap_or_else(|| "pending".to_string()),
                        active_form: obj_str(obj, "activeForm").filter(|s| !s.is_empty()),
                        blocked_by,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ExtractedTodoData { todos, was_merge }
}

/// Parse the pretty-printed JSON array that the native `manage_todo` tool
/// embeds in its text output between the header line and the progress nudge.
/// Returns `None` when no parseable array of objects is present.
fn parse_embedded_todo_array(text: &str) -> Option<serde_json::Value> {
    let start = text.find('[')?;
    let end = text.rfind(']')?;
    if end <= start {
        return None;
    }
    match serde_json::from_str::<serde_json::Value>(&text[start..=end]) {
        Ok(value @ serde_json::Value::Array(_)) => Some(value),
        _ => None,
    }
}

pub(super) fn extract_web_search(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedWebSearchData {
    let query = args
        .and_then(|a| obj_str(a, "query").or_else(|| obj_str(a, "search_term")))
        .unwrap_or_default();

    let results = result
        .and_then(|r| r.get("results"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    Some(WebSearchResult {
                        title: obj_str(obj, "title").unwrap_or_default(),
                        url: obj_str(obj, "url")
                            .or_else(|| obj_str(obj, "link"))
                            .unwrap_or_default(),
                        snippet: obj_str(obj, "snippet")
                            .or_else(|| obj_str(obj, "description"))
                            .unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    ExtractedWebSearchData { query, results }
}

pub(super) fn extract_org_task_item(
    task: &serde_json::Map<String, serde_json::Value>,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<OrgTaskItem> {
    let id = obj_str(task, "id")
        .or_else(|| args.and_then(|a| obj_str(a, "id")))
        .unwrap_or_default();
    if id.is_empty() {
        return None;
    }

    let owner_member = task.get("owner_member").and_then(|value| value.as_object());
    let owner_name = owner_member.and_then(|member| {
        let name = obj_str(member, "name");
        let role = obj_str(member, "role");
        match (name, role) {
            (Some(name), Some(role)) => Some(format!("{name} · {role}")),
            (Some(name), None) => Some(name),
            _ => None,
        }
    });

    Some(OrgTaskItem {
        id,
        subject: obj_str(task, "subject").or_else(|| args.and_then(|a| obj_str(a, "subject"))),
        description: obj_str(task, "description")
            .or_else(|| args.and_then(|a| obj_str(a, "description"))),
        active_form: obj_str(task, "active_form")
            .or_else(|| args.and_then(|a| obj_str(a, "active_form"))),
        status: obj_str(task, "status").or_else(|| args.and_then(|a| obj_str(a, "status"))),
        owner: obj_str(task, "owner_member_id")
            .or_else(|| obj_str(task, "owner"))
            .or_else(|| args.and_then(|a| obj_str(a, "owner_member_id"))),
        owner_name,
        owner_agent_icon_id: owner_member.and_then(|member| obj_str(member, "agent_icon_id")),
        owner_cli_agent_type: owner_member.and_then(|member| obj_str(member, "cli_agent_type")),
        priority: obj_str(task, "priority"),
        blocks: obj_string_array(task, "blocks"),
        blocked_by: obj_string_array(task, "blocked_by"),
    })
}

pub(super) fn extract_org_task_args_item(
    tool: &str,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<OrgTaskItem> {
    if tool == tool_names::TASK_LIST {
        return None;
    }

    let args = args?;
    let id = obj_str(args, "id").unwrap_or_default();
    Some(OrgTaskItem {
        id,
        subject: obj_str(args, "subject"),
        description: obj_str(args, "description"),
        active_form: obj_str(args, "active_form"),
        status: obj_str(args, "status"),
        owner: obj_str(args, "owner_member_id").or_else(|| obj_str(args, "owner")),
        owner_name: None,
        owner_agent_icon_id: None,
        owner_cli_agent_type: None,
        priority: obj_str(args, "priority"),
        blocks: obj_string_array(args, "blocks"),
        blocked_by: obj_string_array(args, "blocked_by"),
    })
}

pub(super) fn extract_org_task(
    tool: &str,
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedOrgTaskData {
    let result_object = normalized_result_object(result);
    let action = match tool {
        tool_names::TASK_CREATE => "create",
        tool_names::TASK_UPDATE => {
            if obj_bool(&result_object, "deleted") == Some(true) {
                "delete"
            } else {
                "update"
            }
        }
        tool_names::TASK_GET => "get",
        tool_names::TASK_LIST => "list",
        _ => "update",
    }
    .to_string();

    let task = result_object
        .get("task")
        .and_then(|value| value.as_object())
        .and_then(|task| extract_org_task_item(task, args))
        .or_else(|| extract_org_task_args_item(tool, args));

    let tasks: Vec<OrgTaskItem> = result_object
        .get("tasks")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_object())
                .filter_map(|task| extract_org_task_item(task, args))
                .collect()
        })
        .unwrap_or_default();

    let total = result_object
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .or_else(|| {
            if tasks.is_empty() {
                task.as_ref().map(|_| 1)
            } else {
                Some(tasks.len())
            }
        });

    ExtractedOrgTaskData {
        action,
        task,
        tasks,
        total,
        org_run_id: obj_str(&result_object, "org_run_id"),
        owner_changed: obj_bool(&result_object, "owner_changed"),
        status_changed: obj_bool(&result_object, "status_changed"),
        task_assigned_dispatched: obj_bool(&result_object, "task_assigned_dispatched"),
    }
}

pub(super) fn extract_subagent(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedSubagentData {
    let description = args
        .and_then(|a| obj_str(a, "description").or_else(|| obj_str(a, "task")))
        .unwrap_or_default();
    let subagent_type = args
        .and_then(|a| obj_str(a, "subagent_type").or_else(|| obj_str(a, "type")))
        .unwrap_or_default();

    let result_content = result
        .and_then(|r| obj_str(r, "content").or_else(|| obj_str(r, "output")))
        .unwrap_or_default();
    let result_summary = result.and_then(|r| obj_str(r, "summary"));

    let has_explicit_error = result
        .map(|r| {
            r.get("error").and_then(|v| v.as_bool()) == Some(true)
                || r.get("is_error").and_then(|v| v.as_bool()) == Some(true)
                || r.get("error_message")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
        })
        .unwrap_or(false);

    let success = !has_explicit_error
        && result
            .map(|r| {
                r.get("success").and_then(|v| v.as_bool()) == Some(true)
                    || r.get("status").and_then(|v| v.as_str()) == Some("completed")
                    || !result_content.is_empty()
            })
            .unwrap_or(false);

    let subagent_session_id = args.and_then(|a| obj_str(a, "subagentSessionId"));

    let elapsed_ms = args.and_then(|a| obj_f64(a, "elapsedMs"));
    let tool_call_count = args.and_then(|a| obj_i64(a, "toolCallCount"));
    let reasoning_text = args.and_then(|a| obj_str(a, "reasoningText"));
    let prompt = args.and_then(|a| obj_str(a, "prompt"));

    // Terminal failure state may ship its message via `error_message`, a
    // stringified `error`, or a generic `message` field. Only populate when
    // the call is not successful so the UI can surface the error text in the
    // expanded body (and collapsed summary) without bleeding into happy paths.
    let error_message = if !success {
        result.and_then(|r| {
            obj_str(r, "error_message")
                .or_else(|| obj_str(r, "error"))
                .or_else(|| obj_str(r, "message"))
        })
    } else {
        None
    };

    ExtractedSubagentData {
        description,
        subagent_type,
        result_content,
        result_summary,
        success,
        subagent_session_id,
        elapsed_ms,
        tool_call_count,
        reasoning_text,
        prompt,
        error_message,
    }
}

pub(crate) fn extract_delete_file(
    args: Option<&serde_json::Map<String, serde_json::Value>>,
    result: Option<&serde_json::Map<String, serde_json::Value>>,
) -> ExtractedDeleteFileData {
    let from_args = args.and_then(|a| {
        obj_str(a, "path")
            .or_else(|| obj_str(a, "file_path"))
            .or_else(|| obj_str(a, "target_file"))
    });

    let from_success = result
        .and_then(|r| r.get("success"))
        .and_then(|v| v.as_object())
        .and_then(|s| obj_str(s, "deletedFile").or_else(|| obj_str(s, "path")));

    let from_output_success = result
        .and_then(|r| r.get("output"))
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("success"))
        .and_then(|v| v.as_object())
        .and_then(|s| obj_str(s, "deletedFile").or_else(|| obj_str(s, "path")));

    let file_path = from_args
        .or(from_success)
        .or(from_output_success)
        .unwrap_or_default();

    let file_name = if file_path.is_empty() {
        "file".to_string()
    } else {
        file_path
            .rsplit('/')
            .next()
            .unwrap_or(&file_path)
            .to_string()
    };

    ExtractedDeleteFileData {
        file_path,
        file_name,
    }
}
