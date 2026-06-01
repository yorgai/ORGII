use crate::tools::impls::coding::apply_patch::{
    derive_new_contents, parse_patch, seek_sequence, ApplyPatchTool, Hunk, UpdateChunk,
};
use crate::tools::traits::Tool;

#[test]
fn test_parse_add_file() {
    let patch = "*** Begin Patch\n*** Add File: src/new.rs\n+fn main() {}\n*** End Patch";
    let hunks = parse_patch(patch).unwrap();
    assert_eq!(hunks.len(), 1);
    match &hunks[0] {
        Hunk::Add { path, contents } => {
            assert_eq!(path, "src/new.rs");
            assert_eq!(contents, "fn main() {}");
        }
        _ => panic!("Expected Add hunk"),
    }
}

#[test]
fn test_parse_delete_file() {
    let patch = "*** Begin Patch\n*** Delete File: old.rs\n*** End Patch";
    let hunks = parse_patch(patch).unwrap();
    assert_eq!(hunks.len(), 1);
    match &hunks[0] {
        Hunk::Delete { path } => assert_eq!(path, "old.rs"),
        _ => panic!("Expected Delete hunk"),
    }
}

#[test]
fn test_parse_update_file() {
    let patch = "\
*** Begin Patch
*** Update File: src/lib.rs
@@ fn main
-    old_line();
+    new_line();
*** End Patch";
    let hunks = parse_patch(patch).unwrap();
    assert_eq!(hunks.len(), 1);
    match &hunks[0] {
        Hunk::Update { path, chunks, .. } => {
            assert_eq!(path, "src/lib.rs");
            assert_eq!(chunks.len(), 1);
            assert_eq!(chunks[0].old_lines, vec!["    old_line();"]);
            assert_eq!(chunks[0].new_lines, vec!["    new_line();"]);
            assert_eq!(chunks[0].change_context.as_deref(), Some("fn main"));
        }
        _ => panic!("Expected Update hunk"),
    }
}

#[test]
fn test_seek_sequence_exact() {
    let lines: Vec<String> = vec!["a", "b", "c", "d"]
        .into_iter()
        .map(String::from)
        .collect();
    let pattern: Vec<String> = vec!["b", "c"].into_iter().map(String::from).collect();
    assert_eq!(seek_sequence(&lines, &pattern, 0, false), 1);
}

#[test]
fn test_seek_sequence_trimmed() {
    let lines: Vec<String> = vec!["  a  ", "  b  "]
        .into_iter()
        .map(String::from)
        .collect();
    let pattern: Vec<String> = vec!["a", "b"].into_iter().map(String::from).collect();
    assert_eq!(seek_sequence(&lines, &pattern, 0, false), 0);
}

#[test]
fn test_derive_new_contents() {
    let original = "line1\nline2\nline3\n";
    let chunks = vec![UpdateChunk {
        old_lines: vec!["line2".to_string()],
        new_lines: vec!["replaced".to_string()],
        change_context: None,
        is_end_of_file: false,
    }];
    let result = derive_new_contents(original, "test.rs", &chunks).unwrap();
    assert!(result.contains("replaced"));
    assert!(!result.contains("line2"));
}

#[test]
fn test_missing_markers() {
    let result = parse_patch("no markers here");
    assert!(result.is_err());
}

#[tokio::test]
async fn test_apply_patch_returns_unified_diff_with_context() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("sample.rs");
    tokio::fs::write(&file_path, "line1\nline2\nline3\nline4\nline5\n")
        .await
        .unwrap();

    let tool = ApplyPatchTool::new(temp_dir.path().to_path_buf());
    let result = tool
        .execute_text(serde_json::json!({
            "patch_text": "*** Begin Patch\n*** Update File: sample.rs\n@@\n-line3\n+changed3\n*** End Patch"
        }))
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_str(&result).unwrap();
    let diff = value
        .get("diffString")
        .and_then(|value| value.as_str())
        .unwrap();

    assert!(diff.contains("--- a/sample.rs"));
    assert!(diff.contains("+++ b/sample.rs"));
    assert!(diff.contains(" line1"));
    assert!(diff.contains(" line2"));
    assert!(diff.contains("-line3"));
    assert!(diff.contains("+changed3"));
    assert!(diff.contains(" line4"));
    assert!(diff.contains(" line5"));
    assert_eq!(
        value.get("linesAdded").and_then(|value| value.as_u64()),
        Some(1)
    );
    assert_eq!(
        value.get("linesRemoved").and_then(|value| value.as_u64()),
        Some(1)
    );
}
