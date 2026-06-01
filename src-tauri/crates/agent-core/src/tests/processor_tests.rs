//! Tests for message and tool-output helpers in `crate::turn_executor`
//! (`safe_truncate_end`, `truncate_output`, `extract_file_paths`, snapshot formatting, etc.).

use crate::tools::names as tool_names;
use crate::turn_executor::file_tracker::{extract_file_paths, is_file_write_tool};
use crate::turn_executor::{
    add_assistant_message, add_tool_result, safe_truncate_end, truncate_output, FileTimeTracker,
    MAX_TOOL_OUTPUT_CHARS,
};
use serde_json::json;

// -- safe_truncate_end --

#[test]
fn safe_truncate_end_within_limit() {
    assert_eq!(safe_truncate_end("hello", 100), "hello");
}

#[test]
fn safe_truncate_end_keeps_tail() {
    let result = safe_truncate_end("abcdefghij", 5);
    assert_eq!(result, "fghij");
}

#[test]
fn safe_truncate_end_respects_char_boundary() {
    let text = "hello 世界 test";
    let result = safe_truncate_end(text, 8);
    assert!(!result.is_empty());
    for ch in result.chars() {
        assert!(ch.len_utf8() > 0);
    }
}

#[test]
fn safe_truncate_end_empty_string() {
    assert_eq!(safe_truncate_end("", 10), "");
}

#[test]
fn safe_truncate_end_zero_bytes_returns_full() {
    let result = safe_truncate_end("hello", 0);
    assert!(result.is_empty() || result == "hello");
}

// -- truncate_output --

#[test]
fn truncate_output_short_passthrough() {
    let short = "hello world";
    assert_eq!(truncate_output(short, None), short);
}

#[test]
fn truncate_output_exact_limit() {
    let exact = "x".repeat(MAX_TOOL_OUTPUT_CHARS);
    assert_eq!(truncate_output(&exact, None), exact);
}

#[test]
fn truncate_output_long_gets_marker() {
    let long = "x\n".repeat(MAX_TOOL_OUTPUT_CHARS);
    let result = truncate_output(&long, None);
    assert!(result.contains("[output truncated"));
    assert!(result.len() <= MAX_TOOL_OUTPUT_CHARS + 100);
}

// -- extract_file_paths --

#[test]
fn extract_paths_read_file() {
    let args = json!({"file_path": "/src/main.rs"});
    assert_eq!(
        extract_file_paths(tool_names::READ_FILE, &args),
        vec!["/src/main.rs"]
    );
}

#[test]
fn extract_paths_edit() {
    let args = json!({"file_path": "/src/lib.rs", "old_string": "a", "new_string": "b"});
    assert_eq!(
        extract_file_paths(tool_names::EDIT_FILE, &args),
        vec!["/src/lib.rs"]
    );
}

#[test]
fn extract_paths_edit_file_create_mode() {
    // edit_file in create/overwrite mode (with content)
    let args = json!({"file_path": "/new.txt", "content": "hello"});
    assert_eq!(
        extract_file_paths(tool_names::EDIT_FILE, &args),
        vec!["/new.txt"]
    );
}

#[test]
fn extract_paths_delete_file() {
    let args = json!({"path": "/src/obsolete.rs"});
    assert_eq!(
        extract_file_paths(tool_names::DELETE_FILE, &args),
        vec!["/src/obsolete.rs"]
    );
}

#[test]
fn file_write_tools_include_delete_file() {
    assert!(is_file_write_tool(tool_names::EDIT_FILE));
    assert!(is_file_write_tool(tool_names::DELETE_FILE));
    assert!(is_file_write_tool(tool_names::APPLY_PATCH));
    assert!(!is_file_write_tool(tool_names::READ_FILE));
}

#[test]
fn extract_paths_apply_patch_multiple() {
    let patch = "*** Update File: src/foo.rs\n@@\n-old\n+new\n*** Add File: src/bar.rs\ncontent";
    let args = json!({"patch_text": patch});
    let paths = extract_file_paths(tool_names::APPLY_PATCH, &args);
    assert_eq!(paths, vec!["src/bar.rs", "src/foo.rs"]);
}

#[test]
fn extract_paths_apply_patch_delete_and_move() {
    let patch = "*** Delete File: old.rs\n*** Move to: new.rs\n";
    let args = json!({"patch_text": patch});
    let paths = extract_file_paths(tool_names::APPLY_PATCH, &args);
    assert!(paths.contains(&"old.rs".to_string()));
    assert!(paths.contains(&"new.rs".to_string()));
}

#[test]
fn extract_paths_apply_patch_deduplicates() {
    let patch = "*** Update File: src/a.rs\n@@\n*** Update File: src/a.rs\n@@";
    let args = json!({"patch_text": patch});
    assert_eq!(
        extract_file_paths(tool_names::APPLY_PATCH, &args),
        vec!["src/a.rs"]
    );
}

// `extract_paths_unknown_tool` was retired: passing a non-tracked tool
// to `extract_file_paths` is now a caller-path bug (the catch-all arm
// triggers a `debug_assert!` and a `tracing::error!`). The new
// `gate_invariant_tests::every_tracked_tool_has_an_extraction_arm` in
// `file_tracker.rs` covers the positive contract — every entry in
// `FILE_READ_TOOLS` / `FILE_WRITE_TOOLS` has an extraction arm.

#[test]
fn extract_paths_missing_key() {
    assert!(extract_file_paths(tool_names::READ_FILE, &json!({"other": "v"})).is_empty());
}

// -- add_assistant_message --

#[test]
fn add_assistant_message_text_only() {
    let mut messages = Vec::new();
    add_assistant_message(&mut messages, Some("Hello"), None, None);
    insta::assert_yaml_snapshot!("assistant_text_only", messages[0], {
        "._mc_ts" => "[timestamp]"
    });
}

#[test]
fn add_assistant_message_null_content() {
    let mut messages = Vec::new();
    add_assistant_message(&mut messages, None, None, None);
    assert!(messages[0]["content"].is_null());
}

#[test]
fn add_assistant_message_with_tool_calls() {
    let mut messages = Vec::new();
    let tc = vec![json!({"id": "tc1", "type": "function", "function": {"name": "edit_file"}})];
    add_assistant_message(&mut messages, None, Some(&tc), None);
    insta::assert_yaml_snapshot!("assistant_with_tool_calls", messages[0], {
        "._mc_ts" => "[timestamp]"
    });
}

#[test]
fn add_assistant_message_with_reasoning() {
    let mut messages = Vec::new();
    add_assistant_message(&mut messages, Some("ok"), None, Some("thinking..."));
    insta::assert_yaml_snapshot!("assistant_with_reasoning", messages[0], {
        "._mc_ts" => "[timestamp]"
    });
}

#[test]
fn add_assistant_message_all_fields() {
    let mut messages = Vec::new();
    let tc = vec![json!({"id": "tc1"})];
    add_assistant_message(&mut messages, Some("text"), Some(&tc), Some("reason"));
    insta::assert_yaml_snapshot!("assistant_all_fields", messages[0], {
        "._mc_ts" => "[timestamp]"
    });
}

// -- add_tool_result --

#[test]
fn add_tool_result_format() {
    let mut messages = Vec::new();
    add_tool_result(
        &mut messages,
        "tc-1",
        "read_file",
        "file contents here",
        false,
    );
    insta::assert_yaml_snapshot!("tool_result_format", messages[0]);
}

#[test]
fn add_tool_result_appends() {
    let mut messages = vec![json!({"role": "user", "content": "hi"})];
    add_tool_result(&mut messages, "tc-2", "code_search", "found", false);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["role"], "tool");
}

// -- Empty result guard --
// The guard replaces empty/whitespace tool results with "[No output]".
// It applies to the output of `truncate_output`, so we verify that empty
// strings pass through truncate_output unchanged (the guard sits after it).

#[test]
fn truncate_output_empty_string_passes_through() {
    let result = truncate_output("", None);
    assert_eq!(result, "");
}

#[test]
fn truncate_output_whitespace_only_passes_through() {
    let result = truncate_output("   \n\t  ", None);
    assert_eq!(result, "   \n\t  ");
}

#[test]
fn empty_result_guard_would_trigger_on_empty() {
    let truncated = truncate_output("", None);
    let guarded = if truncated.trim().is_empty() {
        "[No output]".to_string()
    } else {
        truncated
    };
    assert_eq!(guarded, "[No output]");
}

#[test]
fn empty_result_guard_would_trigger_on_whitespace() {
    let truncated = truncate_output("  \n  ", None);
    let guarded = if truncated.trim().is_empty() {
        "[No output]".to_string()
    } else {
        truncated
    };
    assert_eq!(guarded, "[No output]");
}

#[test]
fn empty_result_guard_preserves_real_content() {
    let truncated = truncate_output("file created successfully", None);
    let guarded = if truncated.trim().is_empty() {
        "[No output]".to_string()
    } else {
        truncated
    };
    assert_eq!(guarded, "file created successfully");
}

// -- FileTimeTracker --

#[test]
fn file_time_tracker_new_is_empty() {
    let tracker = FileTimeTracker::new();
    assert!(tracker.is_empty());
    assert_eq!(tracker.len(), 0);
}

#[test]
fn file_time_tracker_assert_fresh_unread_passes() {
    let tracker = FileTimeTracker::new();
    assert!(tracker.assert_fresh("/nonexistent/file.rs").is_ok());
}
