use crate::agent_sessions::event_pipeline::ingestion::normalizer::{
    normalize_chunk, normalize_chunks,
};
use crate::agent_sessions::event_pipeline::ingestion::types::RawActivityChunk;
use crate::agent_sessions::event_pipeline::types::{
    EventDisplayStatus, EventDisplayVariant, EventSource,
};

fn make_chunk(action_type: &str, function: &str) -> RawActivityChunk {
    RawActivityChunk {
        chunk_id: Some("test-001".to_string()),
        session_id: Some("sess-1".to_string()),
        action_type: Some(action_type.to_string()),
        function: Some(function.to_string()),
        args: Some(serde_json::json!({})),
        result: Some(serde_json::json!({})),
        created_at: Some("2025-01-15T10:30:00.000Z".to_string()),
        thread_id: None,
        process_id: None,
        call_id: None,
    }
}

#[test]
fn test_normalize_tool_call() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-1".to_string()),
        action_type: Some("tool_call".to_string()),
        function: Some("Read".to_string()),
        args: Some(serde_json::json!({"file_path": "/src/main.rs"})),
        result: Some(serde_json::json!({"content": "fn main() {}"})),
        created_at: Some("2025-01-15T10:30:00.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.function_name, "read_file");
    assert_eq!(event.display_variant, EventDisplayVariant::ToolCall);
    assert_eq!(event.display_status, EventDisplayStatus::Completed);
    assert_eq!(event.file_path, Some("/src/main.rs".to_string()));
    assert_eq!(event.source, EventSource::Assistant);
}

#[test]
fn test_normalize_tool_call_accepts_cursor_camel_case_target_file() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-camel-read".to_string()),
        action_type: Some("tool_call".to_string()),
        function: Some("Read".to_string()),
        args: Some(
            serde_json::json!({"targetFile": "/Users/vinceorz/Projects/ORGII/src/app/root.tsx"}),
        ),
        result: Some(serde_json::json!({"content": "export {};"})),
        created_at: Some("2025-01-15T10:30:00.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.function_name, "read_file");
    assert_eq!(
        event.file_path,
        Some("/Users/vinceorz/Projects/ORGII/src/app/root.tsx".to_string())
    );
}

#[test]
fn test_normalize_thinking() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-2".to_string()),
        action_type: Some("llm_thinking".to_string()),
        result: Some(serde_json::json!({"thought": "Let me analyze this..."})),
        created_at: Some("2025-01-15T10:30:01.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.function_name, "thinking");
    assert_eq!(event.display_variant, EventDisplayVariant::Thinking);
    assert_eq!(event.display_text, "Let me analyze this...");
}

#[test]
fn test_normalize_assistant_message() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-3".to_string()),
        action_type: Some("assistant".to_string()),
        result: Some(serde_json::json!({"content": "Here is the solution..."})),
        created_at: Some("2025-01-15T10:30:02.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_variant, EventDisplayVariant::Message);
    assert_eq!(event.display_text, "Here is the solution...");
    assert_eq!(event.source, EventSource::Assistant);
}

#[test]
fn test_normalize_user_message() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-4".to_string()),
        action_type: Some("raw".to_string()),
        result: Some(serde_json::json!({
            "type": "user",
            "message": {
                "content": [{"type": "text", "text": "Fix the bug"}]
            }
        })),
        created_at: Some("2025-01-15T10:30:03.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.source, EventSource::User);
    assert_eq!(event.display_variant, EventDisplayVariant::Message);
    assert_eq!(event.display_text, "Fix the bug");
    // User messages must be Completed (not Running) to pass simulator visibility filter
    assert_eq!(
        event.display_status,
        EventDisplayStatus::Completed,
        "User messages must have Completed status to be visible in simulator"
    );
}

#[test]
fn test_normalize_shell_command() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-5".to_string()),
        action_type: Some("run_command_line".to_string()),
        function: Some("Shell".to_string()),
        args: Some(serde_json::json!({"command": "npm install"})),
        result: Some(serde_json::json!({"exit_code": 0, "stdout": "done"})),
        created_at: Some("2025-01-15T10:30:04.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.function_name, "run_command_line");
    assert_eq!(event.display_text, "Command: npm install");
    assert_eq!(event.command, Some("npm install".to_string()));
    assert_eq!(event.display_status, EventDisplayStatus::Completed);
}

#[test]
fn test_normalize_session_start() {
    let chunk = make_chunk("session_start", "");
    let mut chunk = chunk;
    chunk.args = Some(serde_json::json!({"model": "claude-4"}));
    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_variant, EventDisplayVariant::Session);
    assert_eq!(event.display_status, EventDisplayStatus::Completed);
    assert!(event.display_text.contains("claude-4"));
}

#[test]
fn test_normalize_error() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-err".to_string()),
        action_type: Some("error".to_string()),
        result: Some(serde_json::json!({"error": "Connection timeout"})),
        created_at: Some("2025-01-15T10:30:05.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_variant, EventDisplayVariant::Error);
    assert_eq!(event.display_text, "Connection timeout");
}

#[test]
fn test_normalize_approval() {
    let chunk = make_chunk("approval_request", "");
    let mut chunk = chunk;
    chunk.args = Some(serde_json::json!({"tool_name": "delete_file"}));
    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_variant, EventDisplayVariant::Approval);
    assert!(event.display_text.contains("delete_file"));
}

#[test]
fn test_normalize_ask_user_permissions() {
    let chunk = make_chunk("ask_user_permissions", "");
    let mut chunk = chunk;
    chunk.args = Some(serde_json::json!({"tool_name": "delete_file"}));
    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_variant, EventDisplayVariant::Approval);
    assert!(event.display_text.contains("delete_file"));
}

#[test]
fn test_display_status_success_object() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-s".to_string()),
        action_type: Some("tool_call".to_string()),
        function: Some("read_file".to_string()),
        result: Some(serde_json::json!({"success": {"content": "file data"}})),
        created_at: Some("2025-01-15T10:30:06.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_status, EventDisplayStatus::Completed);
}

#[test]
fn test_display_status_failed() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-f".to_string()),
        action_type: Some("tool_call".to_string()),
        result: Some(serde_json::json!({"success": false})),
        created_at: Some("2025-01-15T10:30:07.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_status, EventDisplayStatus::Failed);
}

#[test]
fn test_display_status_pending() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-p".to_string()),
        action_type: Some("tool_call".to_string()),
        result: Some(serde_json::json!({"pending": true})),
        created_at: Some("2025-01-15T10:30:08.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.display_status, EventDisplayStatus::Pending);
}

#[test]
fn test_delta_detection() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-d".to_string()),
        action_type: Some("llm_thinking_delta".to_string()),
        result: Some(serde_json::json!({"thought": "..."})),
        created_at: Some("2025-01-15T10:30:09.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.is_delta, Some(true));
}

#[test]
fn test_delta_from_result_flag() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-d2".to_string()),
        action_type: Some("assistant".to_string()),
        result: Some(serde_json::json!({"content": "...", "is_delta": true})),
        created_at: Some("2025-01-15T10:30:10.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.is_delta, Some(true));
}

#[test]
fn test_batch_normalize() {
    let chunks = vec![
        make_chunk("assistant", "message"),
        make_chunk("llm_thinking", "thinking"),
        make_chunk("tool_call", "Read"),
    ];

    let events = normalize_chunks(&chunks, "sess-1");
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].display_variant, EventDisplayVariant::Message);
    assert_eq!(events[1].display_variant, EventDisplayVariant::Thinking);
    assert_eq!(events[2].display_variant, EventDisplayVariant::ToolCall);
}

#[test]
fn test_tool_call_extracts_nested_args() {
    let chunk = RawActivityChunk {
        chunk_id: Some("chunk-tc".to_string()),
        action_type: Some("tool_call".to_string()),
        function: Some("read_file".to_string()),
        args: Some(serde_json::json!({
            "input": {"file_path": "/src/lib.rs", "offset": 0}
        })),
        result: Some(serde_json::json!({})),
        created_at: Some("2025-01-15T10:30:11.000Z".to_string()),
        ..Default::default()
    };

    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(
        event
            .args
            .as_object()
            .unwrap()
            .get("file_path")
            .unwrap()
            .as_str(),
        Some("/src/lib.rs")
    );
    assert_eq!(event.file_path.as_deref(), Some("/src/lib.rs"));
}

#[test]
fn test_ui_canonical_precomputed() {
    let chunk = make_chunk("tool_call", "Read");
    let event = normalize_chunk(&chunk, "sess-1");
    assert_eq!(event.function_name, "read_file");
    assert_eq!(event.ui_canonical, "read_file");

    let chunk_edit = make_chunk("tool_call", "Edit");
    let event_edit = normalize_chunk(&chunk_edit, "sess-1");
    assert_eq!(event_edit.function_name, "edit_file_by_replace");
    assert_eq!(event_edit.ui_canonical, "edit_file");

    let chunk_shell = make_chunk("tool_call", "Bash");
    let event_shell = normalize_chunk(&chunk_shell, "sess-1");
    assert_eq!(event_shell.function_name, "run_command_line");
    assert_eq!(event_shell.ui_canonical, "run_shell");

    let chunk_await = make_chunk("tool_call", "Await");
    let event_await = normalize_chunk(&chunk_await, "sess-1");
    assert_eq!(event_await.function_name, "await_output");
    assert_eq!(event_await.ui_canonical, "await_output");

    let chunk_await_tool_call = make_chunk("tool_call", "awaitToolCall");
    let event_await_tool_call = normalize_chunk(&chunk_await_tool_call, "sess-1");
    assert_eq!(event_await_tool_call.function_name, "await_output");
    assert_eq!(event_await_tool_call.ui_canonical, "await_output");

    let chunk_msg = make_chunk("assistant", "message");
    let event_msg = normalize_chunk(&chunk_msg, "sess-1");
    assert_eq!(event_msg.ui_canonical, "agent_message");

    let chunk_thinking = make_chunk("llm_thinking", "thinking");
    let event_thinking = normalize_chunk(&chunk_thinking, "sess-1");
    assert_eq!(event_thinking.ui_canonical, "thinking");
}
