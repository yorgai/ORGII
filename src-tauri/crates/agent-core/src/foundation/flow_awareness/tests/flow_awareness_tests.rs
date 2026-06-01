//! Tests for flow awareness system.

use super::types::*;
use super::FlowStore;

#[test]
fn test_activity_creation() {
    let activity = Activity::file_edit("src/main.rs", FileEditType::Modify);
    assert!(matches!(
        activity.activity_type,
        ActivityType::FileEdit { path, edit_type, .. }
        if path == "src/main.rs" && edit_type == FileEditType::Modify
    ));
}

#[test]
fn test_activity_with_session() {
    let activity = Activity::file_open("src/lib.rs").with_session("session-123");
    assert_eq!(activity.session_id, Some("session-123".to_string()));
}

#[test]
fn test_store_record_and_retrieve() {
    let store = FlowStore::new();

    // Record some activities
    store.record(Activity::file_edit("file1.rs", FileEditType::Modify));
    store.record(Activity::file_open("file2.rs"));
    store.record(Activity::terminal_command(
        "npm test",
        Some("/project"),
        Some(0),
    ));

    // Retrieve recent activities
    let recent = store.get_recent(None, 10, Some(3600)); // 1 hour max age
    assert_eq!(recent.len(), 3);
}

#[test]
fn test_store_fifo_eviction() {
    let store = FlowStore::new();

    // Record more than MAX_GLOBAL_ACTIVITIES
    for idx in 0..250 {
        store.record(Activity::file_open(format!("file{}.rs", idx)));
    }

    // Should be capped at MAX_GLOBAL_ACTIVITIES (200)
    let recent = store.get_recent(None, 1000, Some(3600));
    assert!(recent.len() <= 200);
}

#[test]
fn test_session_activities() {
    let store = FlowStore::new();

    // Record session-scoped activities
    store.record(Activity::file_edit("a.rs", FileEditType::Create).with_session("sess-1"));
    store.record(Activity::file_edit("b.rs", FileEditType::Modify).with_session("sess-1"));
    store.record(Activity::file_edit("c.rs", FileEditType::Modify).with_session("sess-2"));

    // Retrieve for session-1
    let sess1 = store.get_recent(Some("sess-1"), 10, Some(3600));
    assert_eq!(sess1.len(), 2);

    // Retrieve for session-2
    let sess2 = store.get_recent(Some("sess-2"), 10, Some(3600));
    assert_eq!(sess2.len(), 1);

    // Global should be empty (all were session-scoped)
    let global = store.get_recent(None, 10, Some(3600));
    assert_eq!(global.len(), 0);
}

#[test]
fn test_clear_session() {
    let store = FlowStore::new();

    store.record(Activity::file_edit("a.rs", FileEditType::Modify).with_session("sess-1"));
    store.record(Activity::file_edit("b.rs", FileEditType::Modify).with_session("sess-1"));

    // Clear session
    store.clear_session("sess-1");

    // Should be empty now
    let sess1 = store.get_recent(Some("sess-1"), 10, Some(3600));
    assert_eq!(sess1.len(), 0);
}

#[test]
fn test_summarize() {
    let store = FlowStore::new();

    // Simulate debugging activity
    store.record(Activity::file_edit("src/bug.rs", FileEditType::Modify));
    store.record(Activity::error(
        ErrorType::Build,
        "cannot find value `x`",
        Some("src/bug.rs"),
        Some(42),
    ));
    store.record(Activity::debug(
        DebugAction::SetBreakpoint,
        Some("src/bug.rs"),
        Some(40),
    ));

    let summary = store.summarize(None, 50);

    // Should infer debugging intent
    assert_eq!(summary.intent, Some(InferredIntent::Debugging));
    assert!(!summary.recent_edits.is_empty());
    assert!(!summary.current_errors.is_empty());
}

#[test]
fn test_format_context() {
    let store = FlowStore::new();

    store.record(Activity::file_edit("src/main.rs", FileEditType::Modify));
    store.record(Activity::terminal_command(
        "cargo build",
        Some("/project"),
        Some(0),
    ));
    store.record(Activity::search("handleClick", SearchScope::Codebase));

    let context = store.format_context(None, 50);

    // Should contain formatted sections
    assert!(context.contains("User Activity Context"));
    assert!(context.contains("main.rs"));
}

#[test]
fn test_inferred_intents() {
    let store = FlowStore::new();

    // Writing scenario: many edits
    store.record(Activity::file_edit("a.rs", FileEditType::Create));
    store.record(Activity::file_edit("a.rs", FileEditType::Modify));
    store.record(Activity::file_edit("a.rs", FileEditType::Modify));
    store.record(Activity::file_edit("a.rs", FileEditType::Modify));
    store.record(Activity::file_edit("a.rs", FileEditType::Modify));

    let summary = store.summarize(None, 50);
    assert_eq!(summary.intent, Some(InferredIntent::Writing));

    // Clear and test exploring
    store.clear_global();
    store.record(Activity::search("getUserById", SearchScope::Codebase));
    store.record(Activity::search("auth middleware", SearchScope::Codebase));
    store.record(Activity::search("JWT", SearchScope::Codebase));
    store.record(Activity::file_open("src/auth.rs"));

    let summary = store.summarize(None, 50);
    assert_eq!(summary.intent, Some(InferredIntent::Exploring));
}

#[test]
fn test_clipboard_truncation() {
    let long_content = "a".repeat(500);
    let activity = Activity::clipboard(
        ClipboardOp::Copy,
        Some(long_content.clone()),
        None::<String>,
    );

    if let ActivityType::Clipboard {
        content_preview, ..
    } = activity.activity_type
    {
        let preview = content_preview.unwrap();
        assert!(preview.len() <= MAX_PREVIEW_CHARS + 3); // +3 for "..."
        assert!(preview.ends_with("..."));
    } else {
        panic!("Expected Clipboard activity type");
    }
}
