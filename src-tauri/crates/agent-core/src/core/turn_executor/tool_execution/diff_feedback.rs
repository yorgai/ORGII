//! Diff-style feedback lines for file-modifying tool calls.

use serde_json::Value;

use crate::tools::names as tool_names;

/// Compute a short diff-style feedback line for file-modifying tool calls.
///
/// For `edit_file`: compares old_string vs new_string line counts.
/// For `apply_patch`: counts `+`/`-` lines in the unified-diff body.
pub(super) fn compute_diff_feedback(tool_name: &str, args: &Value) -> Option<String> {
    match tool_name {
        tool_names::EDIT_FILE => {
            let old_text = args
                .get("old_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let new_text = args
                .get("new_string")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let file_path = args
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("file");
            let old_lines = old_text.lines().count();
            let new_lines = new_text.lines().count();
            let added = new_lines.saturating_sub(old_lines);
            let removed = old_lines.saturating_sub(new_lines);
            let filename = std::path::Path::new(file_path)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or(file_path);
            Some(format!(
                "[Modified {} (+{}, -{})]",
                filename, added, removed
            ))
        }
        tool_names::APPLY_PATCH => {
            let patch = args.get("patch_text").and_then(|v| v.as_str())?;
            let mut added: usize = 0;
            let mut removed: usize = 0;
            let mut files: Vec<&str> = Vec::new();
            for line in patch.lines() {
                let trimmed = line.trim();
                if let Some(path) = trimmed
                    .strip_prefix("*** Add File:")
                    .or_else(|| trimmed.strip_prefix("*** Update File:"))
                {
                    files.push(path.trim());
                } else if trimmed.starts_with('+') && !trimmed.starts_with("+++") {
                    added += 1;
                } else if trimmed.starts_with('-') && !trimmed.starts_with("---") {
                    removed += 1;
                }
            }
            let file_count = files.len();
            Some(format!(
                "[Patched {} file{} (+{}, -{})]",
                file_count,
                if file_count == 1 { "" } else { "s" },
                added,
                removed,
            ))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_feedback_edit_file_addition() {
        let args = serde_json::json!({
            "file_path": "/src/main.rs",
            "old_string": "line1\nline2",
            "new_string": "line1\nline2\nline3\nline4\nline5"
        });
        let result = compute_diff_feedback("edit_file", &args).unwrap();
        assert_eq!(result, "[Modified main.rs (+3, -0)]");
    }

    #[test]
    fn diff_feedback_edit_file_removal() {
        let args = serde_json::json!({
            "file_path": "/src/utils.ts",
            "old_string": "a\nb\nc\nd",
            "new_string": "a"
        });
        let result = compute_diff_feedback("edit_file", &args).unwrap();
        assert_eq!(result, "[Modified utils.ts (+0, -3)]");
    }

    #[test]
    fn diff_feedback_edit_file_equal_lines() {
        let args = serde_json::json!({
            "file_path": "/foo/bar.rs",
            "old_string": "old line",
            "new_string": "new line"
        });
        let result = compute_diff_feedback("edit_file", &args).unwrap();
        assert_eq!(result, "[Modified bar.rs (+0, -0)]");
    }

    #[test]
    fn diff_feedback_apply_patch_counts() {
        let patch = "\
*** Update File: src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
-removed line
+added line 1
+added line 2
*** Add File: src/new.rs
+new content";
        let args = serde_json::json!({ "patch_text": patch });
        let result = compute_diff_feedback("apply_patch", &args).unwrap();
        assert_eq!(result, "[Patched 2 files (+3, -1)]");
    }

    #[test]
    fn diff_feedback_apply_patch_single_file() {
        let patch = "\
*** Update File: src/mod.rs
+one line added";
        let args = serde_json::json!({ "patch_text": patch });
        let result = compute_diff_feedback("apply_patch", &args).unwrap();
        assert_eq!(result, "[Patched 1 file (+1, -0)]");
    }

    #[test]
    fn diff_feedback_unknown_tool_returns_none() {
        let args = serde_json::json!({ "path": "/foo" });
        assert!(compute_diff_feedback("read_file", &args).is_none());
    }

    #[test]
    fn diff_feedback_edit_file_missing_args_still_works() {
        let args = serde_json::json!({});
        let result = compute_diff_feedback("edit_file", &args).unwrap();
        assert!(result.contains("[Modified"));
    }
}
