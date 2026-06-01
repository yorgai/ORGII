use super::*;

fn system_msg(content: &str) -> Value {
    serde_json::json!({"role": "system", "content": content})
}

fn assistant_with_tools(tool_ids: &[&str]) -> Value {
    let calls: Vec<Value> = tool_ids
        .iter()
        .map(|id| serde_json::json!({"id": id, "type": "function", "function": {"name": "read_file", "arguments": "{}"}}))
        .collect();
    serde_json::json!({"role": "assistant", "content": null, "tool_calls": calls})
}

fn tool_result(tc_id: &str) -> Value {
    serde_json::json!({"role": "tool", "tool_call_id": tc_id, "name": "read_file", "content": "ok"})
}

fn user_msg(content: &str) -> Value {
    serde_json::json!({"role": "user", "content": content})
}

#[test]
fn removes_orphaned_tool_results() {
    let msgs = vec![
        system_msg("prompt"),
        assistant_with_tools(&["tc-1"]),
        tool_result("tc-1"),
        tool_result("tc-orphan"),
    ];
    let out = post_compact_cleanup(msgs);
    assert_eq!(out.len(), 3);
    assert!(out
        .iter()
        .all(|m| { m.get("tool_call_id").and_then(|v| v.as_str()) != Some("tc-orphan") }));
}

#[test]
fn preserves_valid_tool_results() {
    let msgs = vec![
        assistant_with_tools(&["tc-1", "tc-2"]),
        tool_result("tc-1"),
        tool_result("tc-2"),
    ];
    let out = post_compact_cleanup(msgs);
    assert_eq!(out.len(), 3);
}

#[test]
fn deduplicates_consecutive_system_messages() {
    let msgs = vec![
        system_msg("same prompt"),
        system_msg("same prompt"),
        user_msg("hello"),
    ];
    let out = post_compact_cleanup(msgs);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0]["content"].as_str().unwrap(), "same prompt");
    assert_eq!(out[1]["role"].as_str().unwrap(), "user");
}

#[test]
fn keeps_different_system_messages() {
    let msgs = vec![system_msg("prompt A"), system_msg("prompt B")];
    let out = post_compact_cleanup(msgs);
    assert_eq!(out.len(), 2);
}

#[test]
fn empty_messages_returns_empty() {
    let out = post_compact_cleanup(vec![]);
    assert!(out.is_empty());
}

#[test]
fn no_tool_messages_passes_through() {
    let msgs = vec![
        system_msg("sys"),
        user_msg("hi"),
        serde_json::json!({"role": "assistant", "content": "hello"}),
    ];
    let out = post_compact_cleanup(msgs.clone());
    assert_eq!(out.len(), msgs.len());
}

#[test]
fn tool_result_without_id_preserved() {
    let msgs = vec![serde_json::json!({"role": "tool", "name": "read_file", "content": "ok"})];
    let out = post_compact_cleanup(msgs);
    assert_eq!(out.len(), 1);
}
