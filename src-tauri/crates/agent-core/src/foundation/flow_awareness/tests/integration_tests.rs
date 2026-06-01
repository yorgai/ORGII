//! Integration tests for Flow Awareness system.

use super::types::*;
use super::{record_activity, FlowStore};

#[test]
fn test_complete_flow_workflow() {
    let store = FlowStore::global();
    let session_id = "integration-test-001";

    store.clear_session(session_id);
    store.clear_global();

    record_activity(Activity::file_edit_with_lines(
        "src/components/Button.tsx",
        FileEditType::Modify,
        15,
    ));
    record_activity(Activity::file_open("src/utils/helpers.ts"));
    record_activity(Activity::file_edit_with_lines(
        "src/api/client.ts",
        FileEditType::Modify,
        8,
    ));
    record_activity(Activity::terminal_command(
        "npm test",
        Some("/project".to_string()),
        Some(0),
    ));
    record_activity(Activity::terminal_command(
        "npm run build",
        Some("/project".to_string()),
        Some(1),
    ));

    record_activity(Activity::error(
        ErrorType::TypeCheck,
        "Cannot find name 'foo'",
        Some("src/api/client.ts"),
        Some(42),
    ));
    record_activity(Activity::error(
        ErrorType::Lint,
        "Unexpected token",
        Some("src/components/Button.tsx"),
        Some(15),
    ));
    record_activity(Activity::debug(
        DebugAction::SetBreakpoint,
        Some("src/api/client.ts"),
        Some(42),
    ));
    record_activity(Activity::file_edit_with_lines(
        "src/api/client.ts",
        FileEditType::Modify,
        3,
    ));
    record_activity(Activity::terminal_command(
        "npm run type-check",
        Some("/project".to_string()),
        Some(0),
    ));

    let context = store.format_context(None, 20);
    assert!(!context.is_empty());

    let summary = store.summarize(None, 20);
    assert!(summary.intent.is_some());
}

#[test]
fn test_intent_inference_debugging() {
    let store = FlowStore::global();
    let session_id = "debug-test";

    store.clear_session(session_id);
    store.clear_global();

    record_activity(
        Activity::error(
            ErrorType::TypeCheck,
            "Type error",
            Some("file.ts"),
            Some(10),
        )
        .with_session(session_id),
    );
    record_activity(
        Activity::error(ErrorType::Lint, "Lint error", Some("file.ts"), Some(15))
            .with_session(session_id),
    );
    record_activity(
        Activity::debug(DebugAction::SetBreakpoint, Some("file.ts"), Some(10))
            .with_session(session_id),
    );

    let summary = store.summarize(Some(session_id), 10);
    assert_eq!(summary.intent, Some(InferredIntent::Debugging));
    assert!(!summary.current_errors.is_empty());
}

#[test]
fn test_intent_inference_writing() {
    let store = FlowStore::global();
    let session_id = "writing-test";

    store.clear_session(session_id);
    store.clear_global();

    for idx in 1..=10 {
        record_activity(
            Activity::file_edit_with_lines(format!("file{}.ts", idx), FileEditType::Modify, 20)
                .with_session(session_id),
        );
    }

    let summary = store.summarize(Some(session_id), 15);
    assert_eq!(summary.intent, Some(InferredIntent::Writing));
    assert!(!summary.recent_edits.is_empty());
}

#[test]
fn test_memory_limits() {
    let store = FlowStore::global();
    let session_id = "memory-test";

    store.clear_session(session_id);
    store.clear_global();

    for idx in 1..=200 {
        record_activity(
            Activity::file_edit_with_lines(format!("file{}.ts", idx), FileEditType::Create, 1)
                .with_session(session_id),
        );
    }

    let summary = store.summarize(Some(session_id), 200);
    assert!(summary.recent_edits.len() <= 100);
}
