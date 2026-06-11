use super::*;

#[test]
fn parses_claude_jsonl_into_replay_chunks() {
    let temp_dir =
        std::env::temp_dir().join(format!("orgii-claude-history-test-{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let path = temp_dir.join("claude-replay.jsonl");
    let content = r#"{"type":"user","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:46.543Z","message":{"role":"user","content":"hello claude"}}
{"type":"assistant","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:47.000Z","message":{"role":"assistant","model":"claude-sonnet-4","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"pwd"}}],"usage":{"input_tokens":10,"output_tokens":2}}}
{"type":"user","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:48.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"/tmp/project"}]}}
{"type":"assistant","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:49.000Z","message":{"role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":3,"output_tokens":5}}}
"#;
    std::fs::write(&path, content).expect("write fixture");

    let chunks = load_claude_code_history_from_path("claudecodeapp-abc", &path).expect("parse");

    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].action_type, imported_history::ACTION_TYPE_RAW);
    assert_eq!(chunks[0].function, imported_history::FUNCTION_USER_MESSAGE);
    assert_eq!(
        chunks[1].action_type,
        imported_history::ACTION_TYPE_TOOL_CALL
    );
    assert_eq!(
        chunks[1].function,
        imported_history::FUNCTION_RUN_COMMAND_LINE
    );
    assert_eq!(
        chunks[1].args.get("command").and_then(Value::as_str),
        Some("pwd")
    );
    assert_eq!(
        chunks[1].result.get("output").and_then(Value::as_str),
        Some("/tmp/project")
    );
    assert_eq!(
        chunks[2].action_type,
        imported_history::ACTION_TYPE_ASSISTANT
    );
    assert_eq!(chunks[2].function, imported_history::FUNCTION_ASSISTANT);

    std::fs::remove_file(&path).expect("remove fixture");
    std::fs::remove_dir(&temp_dir).expect("remove temp dir");
}

#[test]
fn parses_claude_session_metadata() {
    let temp_dir = std::env::temp_dir().join(format!(
        "orgii-claude-history-meta-test-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let path = temp_dir.join("claude-meta.jsonl");
    let content = r#"{"type":"user","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:46.543Z","message":{"role":"user","content":"build this"}}
{"type":"assistant","sessionId":"abc","cwd":"/tmp/project","gitBranch":"main","timestamp":"2026-04-01T07:06:49.000Z","message":{"role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":12,"output_tokens":34,"cache_read_input_tokens":5,"cache_creation_input_tokens":6}}}
"#;
    std::fs::write(&path, content).expect("write fixture");

    let meta = parse_claude_session_meta(&path, "claude-meta")
        .expect("parse")
        .expect("session meta");

    assert_eq!(meta.session_id, "claudecodeapp-claude-meta");
    assert_eq!(meta.name, "build this");
    assert_eq!(meta.model.as_deref(), Some("claude-sonnet-4"));
    assert_eq!(meta.repo_path.as_deref(), Some("/tmp/project"));
    assert_eq!(meta.branch.as_deref(), Some("main"));
    assert_eq!(meta.input_tokens, 23);
    assert_eq!(meta.output_tokens, 34);

    std::fs::remove_file(&path).expect("remove fixture");
    std::fs::remove_dir(&temp_dir).expect("remove temp dir");
}
