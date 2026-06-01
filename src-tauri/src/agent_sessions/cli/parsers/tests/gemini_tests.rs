use super::*;
use crate::agent_sessions::cli::parsers::CliAgentParser;
use serde_json::json;

// Access private methods via the parent module. Tests are a child of gemini, so we can call
// GeminiParser::tool_name_from_id and GeminiParser::normalize_args.

// -- tool_name_from_id --

#[test]
fn tool_name_from_id_with_older_dash_format_preserves_name() {
    assert_eq!(
        GeminiParser::tool_name_from_id("read_file-1234567890-abc123"),
        "read_file"
    );
}

#[test]
fn tool_name_from_id_with_newer_underscore_format_preserves_name() {
    assert_eq!(
        GeminiParser::tool_name_from_id("read_file_1779387903565_0"),
        "read_file"
    );
}

#[test]
fn tool_name_from_id_replace_no_underscore() {
    assert_eq!(
        GeminiParser::tool_name_from_id("replace-123-abc"),
        "replace"
    );
}

#[test]
fn tool_name_from_id_unknown_no_separator() {
    assert_eq!(GeminiParser::tool_name_from_id("unknown"), "unknown");
}

#[test]
fn tool_name_from_id_empty() {
    assert_eq!(GeminiParser::tool_name_from_id(""), "");
}

// -- normalize_args Shell --

#[test]
fn normalize_args_shell_command_and_working_directory() {
    let args = json!({
        "command": "ls",
        "working_directory": "/tmp"
    });
    let out = GeminiParser::normalize_args("Shell", &args);
    assert_eq!(out.get("command").and_then(|v| v.as_str()), Some("ls"));
    assert_eq!(
        out.get("workingDirectory").and_then(|v| v.as_str()),
        Some("/tmp")
    );
}

#[test]
fn normalize_args_shell_with_cwd_instead_of_working_directory() {
    let args = json!({
        "command": "pwd",
        "cwd": "/home/user"
    });
    let out = GeminiParser::normalize_args("Shell", &args);
    assert_eq!(out.get("command").and_then(|v| v.as_str()), Some("pwd"));
    assert_eq!(
        out.get("workingDirectory").and_then(|v| v.as_str()),
        Some("/home/user")
    );
}

// -- normalize_args Edit --

#[test]
fn normalize_args_edit_with_old_string_new_string() {
    let args = json!({
        "file_path": "/foo/bar.rs",
        "old_string": "fn old()",
        "new_string": "fn new()"
    });
    let out = GeminiParser::normalize_args("Edit", &args);
    assert_eq!(
        out.get("path").and_then(|v| v.as_str()),
        Some("/foo/bar.rs")
    );
    assert_eq!(
        out.get("old_string").and_then(|v| v.as_str()),
        Some("fn old()")
    );
    assert_eq!(
        out.get("new_string").and_then(|v| v.as_str()),
        Some("fn new()")
    );
}

#[test]
fn normalize_args_edit_without_old_string_write_file() {
    let args = json!({
        "path": "/foo/bar.rs",
        "content": "full file content"
    });
    let out = GeminiParser::normalize_args("Edit", &args);
    assert_eq!(
        out.get("path").and_then(|v| v.as_str()),
        Some("/foo/bar.rs")
    );
    assert_eq!(out.get("old_string").and_then(|v| v.as_str()), Some(""));
    assert_eq!(
        out.get("new_string").and_then(|v| v.as_str()),
        Some("full file content")
    );
}

// -- normalize_args Read --

#[test]
fn normalize_args_read_from_file_path() {
    let args = json!({"file_path": "/foo/bar.rs"});
    let out = GeminiParser::normalize_args("Read", &args);
    assert_eq!(
        out.get("path").and_then(|v| v.as_str()),
        Some("/foo/bar.rs")
    );
}

#[test]
fn normalize_args_read_from_path_field() {
    let args = json!({"path": "/foo/bar.rs"});
    let out = GeminiParser::normalize_args("Read", &args);
    assert_eq!(
        out.get("path").and_then(|v| v.as_str()),
        Some("/foo/bar.rs")
    );
}

// -- normalize_args UpdateTodos --

#[test]
fn normalize_args_update_todos_description_to_content() {
    let args = json!({
        "todos": [
            {"id": "1", "description": "Task one", "status": "pending"},
            {"id": "2", "content": "Task two", "status": "done"}
        ]
    });
    let out = GeminiParser::normalize_args("UpdateTodos", &args);
    let todos = out.get("todos").and_then(|v| v.as_array()).unwrap();
    assert_eq!(todos.len(), 2);
    assert_eq!(
        todos[0].get("content").and_then(|v| v.as_str()),
        Some("Task one")
    );
    assert_eq!(todos[0].get("id").and_then(|v| v.as_str()), Some("1"));
    assert_eq!(
        todos[0].get("status").and_then(|v| v.as_str()),
        Some("pending")
    );
    assert_eq!(
        todos[1].get("content").and_then(|v| v.as_str()),
        Some("Task two")
    );
    assert_eq!(
        todos[1].get("status").and_then(|v| v.as_str()),
        Some("done")
    );
}

#[test]
fn result_flushes_streaming_assistant_delta_to_persistable_chunk() {
    let mut parser = GeminiParser::new("session-1");
    let delta_chunks =
        parser.parse_line(r#"{"type":"message","role":"assistant","content":"12","delta":true}"#);
    assert_eq!(delta_chunks.len(), 1);
    assert!(delta_chunks[0].broadcast_only);

    let result_chunks = parser.parse_line(
        r#"{"type":"result","status":"success","stats":{"total_tokens":3,"input_tokens":2,"output_tokens":1}}"#,
    );
    assert_eq!(result_chunks.len(), 2);
    assert_eq!(result_chunks[0].action_type, "assistant");
    assert!(!result_chunks[0].broadcast_only);
    assert_eq!(
        result_chunks[0]
            .result
            .get("content")
            .and_then(|value| value.as_str()),
        Some("12")
    );
    assert_eq!(result_chunks[1].action_type, "session_end");
}

#[test]
fn on_exit_flushes_streaming_assistant_delta_without_result_event() {
    let mut parser = GeminiParser::new("session-2");
    parser.parse_line(r#"{"type":"message","role":"assistant","content":"ok","delta":true}"#);

    let exit_chunks = parser.on_exit(0);
    assert_eq!(exit_chunks.len(), 2);
    assert_eq!(exit_chunks[0].action_type, "assistant");
    assert_eq!(
        exit_chunks[0]
            .result
            .get("content")
            .and_then(|value| value.as_str()),
        Some("ok")
    );
    assert_eq!(exit_chunks[1].action_type, "session_end");
}
