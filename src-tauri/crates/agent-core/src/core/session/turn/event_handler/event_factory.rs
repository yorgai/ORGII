//! Pure builders for `SessionEvent` rows that the handler pushes into the
//! per-session `EventStore`. Kept side-effect-free so the unit-test surface
//! around event shape stays small and obvious.

use serde_json::Value;
use uuid::Uuid;

use core_types::cli_alias as alias_map;
use core_types::session_event::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};

pub(super) fn build_assistant_message_event(session_id: &str, content: &str) -> SessionEvent {
    let event_id = format!("assistant-{}", Uuid::new_v4().simple());
    let mut event = SessionEvent {
        id: event_id.clone(),
        chunk_id: Some(event_id),
        session_id: session_id.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        function_name: "assistant".to_string(),
        ui_canonical: "agent_message".to_string(),
        action_type: "assistant".to_string(),
        args: Value::Object(serde_json::Map::new()),
        result: serde_json::json!({
            "content": content,
            "observation": content,
            "role": "assistant",
            "is_delta": false,
        }),
        source: EventSource::Assistant,
        display_text: content.to_string(),
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::Message,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: None,
        file_path: None,
        command: None,
        is_delta: Some(false),
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    event.recompute_extracted();
    event
}

/// Build a `SessionEvent` for a tool_call.
///
/// Interactive tools (`is_interactive_tool`) start in `AwaitingUser` so the
/// generic `complete_last_running` paths can't flip them to `Completed`
/// prematurely — only `agent:interaction_finalized` (via `merge_events`)
/// transitions them out of `AwaitingUser`.
pub(super) fn build_tool_call_event(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    args: &Value,
    repo_path: Option<&str>,
) -> SessionEvent {
    let file_path = extract_file_path(args);
    let repo_path = repo_path.map(ToString::to_string);
    let initial_status = if crate::core::tools::is_interactive_tool(tool_name) {
        EventDisplayStatus::AwaitingUser
    } else {
        EventDisplayStatus::Running
    };
    let mut event = SessionEvent {
        id: format!("tool-call-{}", tool_call_id),
        chunk_id: None,
        session_id: session_id.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        function_name: tool_name.to_string(),
        ui_canonical: alias_map::get_ui_canonical(tool_name).to_string(),
        action_type: "tool_call".to_string(),
        args: args.clone(),
        result: Value::Null,
        source: EventSource::Assistant,
        display_text: display_name.to_string(),
        display_status: initial_status,
        display_variant: EventDisplayVariant::ToolCall,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: Some(tool_call_id.to_string()),
        file_path,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    event.recompute_extracted();
    event
}

fn extract_file_path(args: &Value) -> Option<String> {
    let object = args.as_object()?;
    ["file_path", "filePath", "target_file", "targetFile", "path"]
        .iter()
        .find_map(|key| object.get(*key)?.as_str())
        .filter(|path| !path.is_empty())
        .map(ToString::to_string)
}

/// Build a `SessionEvent` for a tool_result. The `merge_events` path in
/// `EventStore` folds this into the matching tool_call via `call_id`.
pub(super) fn build_tool_result_event(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    result: &str,
) -> SessionEvent {
    let result_value = match serde_json::from_str::<Value>(result) {
        Ok(Value::Object(object)) => Value::Object(object),
        _ => Value::String(result.to_string()),
    };

    SessionEvent {
        id: format!("tool-result-{}", tool_call_id),
        chunk_id: None,
        session_id: session_id.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        function_name: tool_name.to_string(),
        ui_canonical: alias_map::get_ui_canonical(tool_name).to_string(),
        action_type: "tool_result".to_string(),
        args: Value::Object(serde_json::Map::new()),
        result: result_value,
        source: EventSource::Assistant,
        display_text: display_name.to_string(),
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::ToolCall,
        activity_status: ActivityStatus::Processed,
        thread_id: None,
        process_id: None,
        call_id: Some(tool_call_id.to_string()),
        file_path: None,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    }
}
