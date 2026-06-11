use super::*;

#[test]
fn parses_codex_jsonl_into_replay_chunks() {
    let temp_dir =
        std::env::temp_dir().join(format!("orgii-codex-history-test-{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let path = temp_dir.join("rollout-test.jsonl");
    let content = r#"{"timestamp":"2026-02-11T06:16:06.458Z","type":"event_msg","payload":{"type":"user_message","message":"hello codex","images":[],"local_images":[],"text_elements":[]}}
{"timestamp":"2026-02-11T06:16:07.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":\"pwd\"}","call_id":"call_1"}}
{"timestamp":"2026-02-11T06:16:08.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"/tmp/project"}}
{"timestamp":"2026-02-11T06:16:09.000Z","type":"event_msg","payload":{"type":"agent_message","message":"done"}}
"#;
    std::fs::write(&path, content).expect("write fixture");

    let chunks = load_codex_app_from_path("codexapp-rollout-test", &path).expect("parse");

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
fn parses_codex_session_metadata() {
    let temp_dir = std::env::temp_dir().join(format!(
        "orgii-codex-history-meta-test-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let path = temp_dir.join("rollout-meta.jsonl");
    let content = r#"{"timestamp":"2026-02-11T06:16:06.458Z","type":"session_meta","payload":{"cwd":"/Users/me/project","id":"abc"}}
{"timestamp":"2026-02-11T06:16:07.000Z","type":"turn_context","payload":{"cwd":"/Users/me/project","model":"gpt-5.3-codex"}}
{"timestamp":"2026-02-11T06:16:08.000Z","type":"event_msg","payload":{"type":"user_message","message":"build this","images":[],"local_images":[],"text_elements":[]}}
{"timestamp":"2026-02-11T06:16:09.000Z","type":"event_msg","payload":{"type":"token_count","total_token_usage":{"input_tokens":12,"output_tokens":34}}}
"#;
    std::fs::write(&path, content).expect("write fixture");

    let meta = parse_codex_session_meta(&path)
        .expect("parse")
        .expect("session meta");

    assert_eq!(meta.session_id, "codexapp-rollout-meta");
    assert_eq!(meta.name, "build this");
    assert_eq!(meta.model.as_deref(), Some("gpt-5.3-codex"));
    assert_eq!(meta.repo_path.as_deref(), Some("/Users/me/project"));
    assert_eq!(meta.input_tokens, 12);
    assert_eq!(meta.output_tokens, 34);

    std::fs::remove_file(&path).expect("remove fixture");
    std::fs::remove_dir(&temp_dir).expect("remove temp dir");
}
