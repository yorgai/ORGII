use crate::lineage::event_hook::{
    count_patch_content_lines, get_content_field, is_edit_event_function, parse_hunk_header,
    CLI_EDIT_FUNCTIONS,
};
use core_types::tool_names;
use serde_json::json;

// ============================================
// parse_hunk_header
// ============================================

#[test]
fn parse_hunk_header_full_format() {
    assert_eq!(parse_hunk_header("@@ -1,5 +10,20 @@"), Some((10, 20)));
}

#[test]
fn parse_hunk_header_no_comma_in_new() {
    assert_eq!(parse_hunk_header("@@ -1 +5,3 @@"), Some((5, 3)));
}

#[test]
fn parse_hunk_header_no_comma_count_one() {
    assert_eq!(parse_hunk_header("@@ -1,5 +10 @@"), Some((10, 1)));
}

#[test]
fn parse_hunk_header_add_file() {
    assert_eq!(parse_hunk_header("@@ -0,0 +1,100 @@"), Some((1, 100)));
}

#[test]
fn parse_hunk_header_zero_clamped_to_one() {
    assert_eq!(parse_hunk_header("@@ -0,0 +0,5 @@"), Some((1, 5)));
}

#[test]
fn parse_hunk_header_no_plus_returns_none() {
    assert_eq!(parse_hunk_header("no plus sign"), None);
}

#[test]
fn parse_hunk_header_empty_returns_none() {
    assert_eq!(parse_hunk_header(""), None);
}

// ============================================
// count_patch_content_lines
// ============================================

#[test]
fn count_patch_content_lines_target_file() {
    let patch = "*** Add File: src/main.rs\nline1\nline2\n*** End of File";
    assert_eq!(count_patch_content_lines(patch, "src/main.rs"), 2);
}

#[test]
fn count_patch_content_lines_different_target() {
    let patch = "*** Add File: src/main.rs\nline1\nline2\n*** End of File";
    assert_eq!(count_patch_content_lines(patch, "other.rs"), 0);
}

#[test]
fn count_patch_content_lines_multiple_files_count_target_only() {
    let patch =
        "*** Add File: a.rs\nline1\n*** End of File\n*** Add File: b.rs\nx\ny\nz\n*** End of File";
    assert_eq!(count_patch_content_lines(patch, "a.rs"), 1);
    assert_eq!(count_patch_content_lines(patch, "b.rs"), 3);
}

#[test]
fn count_patch_content_lines_empty_patch() {
    assert_eq!(count_patch_content_lines("", "src/main.rs"), 0);
}

// ============================================
// get_content_field
// ============================================

#[test]
fn get_content_field_new_string() {
    let args = json!({"new_string": "hello"});
    assert_eq!(get_content_field(&args), "hello");
}

#[test]
fn get_content_field_content() {
    let args = json!({"content": "world"});
    assert_eq!(get_content_field(&args), "world");
}

#[test]
fn get_content_field_insert_text() {
    let args = json!({"insert_text": "foo"});
    assert_eq!(get_content_field(&args), "foo");
}

#[test]
fn get_content_field_file_text() {
    let args = json!({"file_text": "bar"});
    assert_eq!(get_content_field(&args), "bar");
}

#[test]
fn get_content_field_empty_object() {
    let args = json!({});
    assert_eq!(get_content_field(&args), "");
}

// ============================================
// Edit function detection
// ============================================

#[test]
fn edit_function_names_contains_expected() {
    assert!(is_edit_event_function(tool_names::EDIT_FILE));
    assert!(is_edit_event_function(tool_names::STORAGE_WRITE_FILE));
    assert!(is_edit_event_function(tool_names::APPLY_PATCH));
    assert!(is_edit_event_function("file_diff"));
}

#[test]
fn cli_edit_functions_contains_expected() {
    assert!(CLI_EDIT_FUNCTIONS.contains(&"Edit"));
    assert!(CLI_EDIT_FUNCTIONS.contains(&"Write"));
    assert!(CLI_EDIT_FUNCTIONS.contains(&"Patch"));
    assert!(CLI_EDIT_FUNCTIONS.contains(&"Create"));
}
