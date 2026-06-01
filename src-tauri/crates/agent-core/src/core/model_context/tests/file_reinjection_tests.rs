use super::super::file_reinjection::{
    build_file_reinjection_messages, build_file_reinjection_messages_with_preserved_tail,
    extract_recently_read_files,
};
use serde_json::json;

fn assistant_with_read_file(path: &str) -> serde_json::Value {
    json!({
        "role": "assistant",
        "content": "",
        "tool_calls": [{
            "id": format!("call_{}", path.replace('/', "_")),
            "type": "function",
            "function": {
                "name": "read_file",
                "arguments": json!({"file_path": path}).to_string()
            }
        }]
    })
}

fn user_msg(text: &str) -> serde_json::Value {
    json!({"role": "user", "content": text})
}

fn tool_result(call_id: &str, content: &str) -> serde_json::Value {
    json!({
        "role": "tool",
        "tool_call_id": call_id,
        "content": content
    })
}

#[test]
fn extracts_read_file_paths() {
    let messages = vec![
        user_msg("read foo"),
        assistant_with_read_file("/src/main.rs"),
        tool_result("call__src_main.rs", "fn main() {}"),
        user_msg("read bar"),
        assistant_with_read_file("/src/lib.rs"),
        tool_result("call__src_lib.rs", "pub mod foo;"),
    ];

    let files = extract_recently_read_files(&messages);
    assert_eq!(files.len(), 2);
    assert_eq!(files[0], "/src/lib.rs");
    assert_eq!(files[1], "/src/main.rs");
}

#[test]
fn deduplicates_repeated_reads() {
    let messages = vec![
        user_msg("read"),
        assistant_with_read_file("/src/main.rs"),
        tool_result("call__src_main.rs", "v1"),
        user_msg("read again"),
        assistant_with_read_file("/src/main.rs"),
        tool_result("call__src_main.rs", "v2"),
    ];

    let files = extract_recently_read_files(&messages);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0], "/src/main.rs");
}

#[test]
fn empty_when_no_reads() {
    let messages = vec![
        user_msg("hello"),
        json!({
            "role": "assistant",
            "content": "Hi there!"
        }),
    ];

    let files = extract_recently_read_files(&messages);
    assert!(files.is_empty());
}

#[test]
fn respects_max_files_limit() {
    let mut messages = Vec::new();
    for idx in 0..20 {
        messages.push(user_msg(&format!("read {}", idx)));
        messages.push(assistant_with_read_file(&format!("/src/file_{}.rs", idx)));
        messages.push(tool_result(&format!("call_{}", idx), "content"));
    }

    let files = extract_recently_read_files(&messages);
    assert!(files.len() <= 5);
}

/// Regression: truncation at the byte budget must not panic on multi-byte
/// UTF-8 content. Pre-fix this would index inside a multi-byte sequence
/// and crash the whole compaction path.
#[test]
fn build_does_not_panic_on_multibyte_truncation() {
    use std::io::Write;
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("multibyte.txt");
    // 15k copies of a 3-byte CJK character = 45k bytes, well over the 30k
    // byte budget; the budget edge falls inside a multi-byte sequence.
    let content: String = "日".repeat(15_000);
    {
        let mut f = std::fs::File::create(&path).expect("create");
        f.write_all(content.as_bytes()).expect("write");
    }

    let messages = build_file_reinjection_messages(&[path.to_string_lossy().to_string()]);
    assert_eq!(messages.len(), 1, "expected one re-injection message");
    let text = messages[0]["content"].as_str().expect("content string");
    assert!(text.contains("[truncated"), "should mark truncation");
}

#[test]
fn build_skips_files_already_present_in_preserved_tail() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("existing.txt");
    std::fs::write(&path, "content that should not be duplicated").expect("write");

    let path_text = path.to_string_lossy().to_string();
    let preserved = vec![json!({
        "role": "tool",
        "content": format!("previous context already includes {}", path_text),
    })];

    let messages = build_file_reinjection_messages_with_preserved_tail(&[path_text], &preserved);
    assert!(
        messages.is_empty(),
        "file already in preserved tail should be skipped"
    );
}

#[test]
fn build_respects_total_reinjection_budget() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut paths = Vec::new();
    for index in 0..5 {
        let path = dir.path().join(format!("budget_{index}.txt"));
        std::fs::write(&path, "x".repeat(20_000)).expect("write");
        paths.push(path.to_string_lossy().to_string());
    }

    let messages = build_file_reinjection_messages_with_preserved_tail(&paths, &[]);
    assert_eq!(messages.len(), 1, "expected one combined system message");
    let text = messages[0]["content"].as_str().expect("content string");
    assert!(
        text.len() <= 55_000,
        "reinjected context should stay close to budget, got {} bytes",
        text.len()
    );
}
