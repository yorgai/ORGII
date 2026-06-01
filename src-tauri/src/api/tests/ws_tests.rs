use crate::api::websocket_handler::extract_session_id;

// ============================================
// extract_session_id — top-level keys
// ============================================

#[test]
fn extracts_top_level_session_id() {
    let msg = r#"{"session_id": "sess-123", "type": "update"}"#;
    assert_eq!(extract_session_id(msg), Some("sess-123".to_string()));
}

#[test]
fn extracts_top_level_session_id_camel_case() {
    let msg = r#"{"sessionId": "sess-456", "type": "event"}"#;
    assert_eq!(extract_session_id(msg), Some("sess-456".to_string()));
}

#[test]
fn prefers_session_id_over_session_id_camel() {
    let msg = r#"{"session_id": "first", "sessionId": "second"}"#;
    assert_eq!(extract_session_id(msg), Some("first".to_string()));
}

// ============================================
// extract_session_id — nested payload
// ============================================

#[test]
fn extracts_nested_payload_session_id() {
    let msg = r#"{"type": "agent_event", "payload": {"session_id": "nested-1"}}"#;
    assert_eq!(extract_session_id(msg), Some("nested-1".to_string()));
}

#[test]
fn extracts_nested_payload_session_id_camel() {
    let msg = r#"{"type": "event", "payload": {"sessionId": "nested-2"}}"#;
    assert_eq!(extract_session_id(msg), Some("nested-2".to_string()));
}

// ============================================
// extract_session_id — edge cases
// ============================================

#[test]
fn returns_none_for_no_session_id() {
    let msg = r#"{"type": "ping", "data": "hello"}"#;
    assert_eq!(extract_session_id(msg), None);
}

#[test]
fn returns_none_for_empty_session_id() {
    let msg = r#"{"session_id": "", "sessionId": ""}"#;
    assert_eq!(extract_session_id(msg), None);
}

#[test]
fn returns_none_for_invalid_json() {
    assert_eq!(extract_session_id("not json at all"), None);
    assert_eq!(extract_session_id(""), None);
}

#[test]
fn returns_none_for_numeric_session_id() {
    let msg = r#"{"session_id": 12345}"#;
    assert_eq!(extract_session_id(msg), None);
}

#[test]
fn returns_none_for_null_session_id() {
    let msg = r#"{"session_id": null}"#;
    assert_eq!(extract_session_id(msg), None);
}

#[test]
fn ignores_empty_payload_session_id() {
    let msg = r#"{"type": "event", "payload": {"session_id": ""}}"#;
    assert_eq!(extract_session_id(msg), None);
}
