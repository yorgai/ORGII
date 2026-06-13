use crate::agent_sessions::event_pipeline::ingestion::consolidator::consolidate_activity_chunks;
use crate::agent_sessions::event_pipeline::ingestion::types::RawActivityChunk;

fn thinking_delta(id: &str, content: &str, time: &str) -> RawActivityChunk {
    RawActivityChunk {
        chunk_id: Some(id.to_string()),
        action_type: Some("llm_thinking_delta".to_string()),
        result: Some(serde_json::json!({
            "thought": content,
            "is_delta": true
        })),
        created_at: Some(time.to_string()),
        session_id: Some("sess-1".to_string()),
        function: None,
        args: None,
        thread_id: None,
        process_id: None,
        call_id: None,
    }
}

fn message_delta(id: &str, content: &str, time: &str) -> RawActivityChunk {
    RawActivityChunk {
        chunk_id: Some(id.to_string()),
        action_type: Some("assistant_delta".to_string()),
        result: Some(serde_json::json!({
            "content": content,
            "role": "assistant",
            "is_delta": true
        })),
        created_at: Some(time.to_string()),
        session_id: Some("sess-1".to_string()),
        function: None,
        args: None,
        thread_id: None,
        process_id: None,
        call_id: None,
    }
}

fn tool_call_chunk(id: &str, function: &str, time: &str) -> RawActivityChunk {
    RawActivityChunk {
        chunk_id: Some(id.to_string()),
        action_type: Some("tool_call".to_string()),
        function: Some(function.to_string()),
        args: Some(serde_json::json!({"file_path": "/test.rs"})),
        result: Some(serde_json::json!({"content": "done"})),
        created_at: Some(time.to_string()),
        session_id: Some("sess-1".to_string()),
        thread_id: None,
        process_id: None,
        call_id: None,
    }
}

#[test]
fn test_consolidate_thinking_deltas() {
    let chunks = vec![
        thinking_delta("t1", "Hello ", "2025-01-15T10:00:01.000Z"),
        thinking_delta("t2", "world", "2025-01-15T10:00:02.000Z"),
    ];

    let result = consolidate_activity_chunks(&chunks);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].action_type.as_deref(), Some("llm_thinking"));
    assert!(result[0]
        .chunk_id
        .as_ref()
        .unwrap()
        .starts_with("merged:thinking:"));

    let thought = result[0]
        .result
        .as_ref()
        .unwrap()
        .as_object()
        .unwrap()
        .get("thought")
        .unwrap()
        .as_str()
        .unwrap();
    assert_eq!(thought, "Hello world");
    let duration_ms = result[0]
        .result
        .as_ref()
        .unwrap()
        .as_object()
        .unwrap()
        .get("durationMs")
        .unwrap()
        .as_i64()
        .unwrap();
    assert_eq!(duration_ms, 1000);
}

#[test]
fn test_consolidate_message_deltas() {
    let chunks = vec![
        message_delta("m1", "Part 1 ", "2025-01-15T10:00:01.000Z"),
        message_delta("m2", "Part 2", "2025-01-15T10:00:02.000Z"),
    ];

    let result = consolidate_activity_chunks(&chunks);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].action_type.as_deref(), Some("assistant"));
    assert!(result[0]
        .chunk_id
        .as_ref()
        .unwrap()
        .starts_with("merged:message:"));

    let content = result[0]
        .result
        .as_ref()
        .unwrap()
        .as_object()
        .unwrap()
        .get("content")
        .unwrap()
        .as_str()
        .unwrap();
    assert_eq!(content, "Part 1 Part 2");
}

#[test]
fn test_interleaved_thinking_and_messages() {
    let chunks = vec![
        thinking_delta("t1", "Think 1 ", "2025-01-15T10:00:01.000Z"),
        message_delta("m1", "Msg 1 ", "2025-01-15T10:00:02.000Z"),
        thinking_delta("t2", "Think 2", "2025-01-15T10:00:03.000Z"),
        message_delta("m2", "Msg 2", "2025-01-15T10:00:04.000Z"),
        tool_call_chunk("tc1", "read_file", "2025-01-15T10:00:05.000Z"),
    ];

    let result = consolidate_activity_chunks(&chunks);
    // thinking merged, messages merged, then tool call
    assert_eq!(result.len(), 3);
    assert_eq!(result[0].action_type.as_deref(), Some("llm_thinking"));
    assert_eq!(result[1].action_type.as_deref(), Some("assistant"));
    assert_eq!(result[2].action_type.as_deref(), Some("tool_call"));
}

#[test]
fn test_empty_chunks_filtered() {
    let chunks = vec![
        RawActivityChunk {
            chunk_id: Some("empty1".to_string()),
            action_type: Some("".to_string()),
            ..Default::default()
        },
        RawActivityChunk {
            chunk_id: Some("".to_string()),
            action_type: Some("tool_call".to_string()),
            ..Default::default()
        },
        tool_call_chunk("valid", "read_file", "2025-01-15T10:00:01.000Z"),
    ];

    let result = consolidate_activity_chunks(&chunks);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].chunk_id.as_deref(), Some("valid"));
}

#[test]
fn test_empty_thinking_filtered() {
    let chunks = vec![RawActivityChunk {
        chunk_id: Some("empty-think".to_string()),
        action_type: Some("llm_thinking".to_string()),
        result: Some(serde_json::json!({"thought": "  "})),
        created_at: Some("2025-01-15T10:00:01.000Z".to_string()),
        session_id: Some("sess-1".to_string()),
        function: None,
        args: None,
        thread_id: None,
        process_id: None,
        call_id: None,
    }];

    let result = consolidate_activity_chunks(&chunks);
    assert!(result.is_empty());
}

#[test]
fn test_dedup_assistant_messages() {
    let chunks = vec![
        RawActivityChunk {
            chunk_id: Some("msg1".to_string()),
            action_type: Some("assistant".to_string()),
            function: Some("message".to_string()),
            result: Some(serde_json::json!({
                "content": "Hello!",
                "is_delta": false
            })),
            created_at: Some("2025-01-15T10:00:01.000Z".to_string()),
            session_id: Some("sess-1".to_string()),
            args: None,
            thread_id: None,
            process_id: None,
            call_id: None,
        },
        RawActivityChunk {
            chunk_id: Some("msg2".to_string()),
            action_type: Some("assistant".to_string()),
            function: Some("message".to_string()),
            result: Some(serde_json::json!({
                "content": "Hello!",
                "is_delta": false
            })),
            created_at: Some("2025-01-15T10:00:02.000Z".to_string()),
            session_id: Some("sess-1".to_string()),
            args: None,
            thread_id: None,
            process_id: None,
            call_id: None,
        },
    ];

    let result = consolidate_activity_chunks(&chunks);
    assert_eq!(result.len(), 1);
}

#[test]
fn test_thinking_end_marker_flushes() {
    let chunks = vec![
        thinking_delta("t1", "Part 1 ", "2025-01-15T10:00:01.000Z"),
        thinking_delta("t2", "Part 2", "2025-01-15T10:00:02.000Z"),
        // End marker: thinking type, no is_delta, no content
        RawActivityChunk {
            chunk_id: Some("end".to_string()),
            action_type: Some("llm_thinking".to_string()),
            result: Some(serde_json::json!({})),
            created_at: Some("2025-01-15T10:00:03.000Z".to_string()),
            session_id: Some("sess-1".to_string()),
            function: None,
            args: None,
            thread_id: None,
            process_id: None,
            call_id: None,
        },
        tool_call_chunk("tc1", "read_file", "2025-01-15T10:00:04.000Z"),
    ];

    let result = consolidate_activity_chunks(&chunks);
    // merged thinking + tool_call (end marker itself is consumed by is_empty_chunk)
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].action_type.as_deref(), Some("llm_thinking"));
    assert_eq!(result[1].action_type.as_deref(), Some("tool_call"));
}
