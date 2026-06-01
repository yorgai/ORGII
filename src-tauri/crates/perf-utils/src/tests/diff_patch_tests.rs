use crate::diff_patch::*;

// ============================================
// compute_diff tests
// ============================================

#[test]
fn test_compute_diff() {
    let old = "line1\nline2\nline3";
    let new = "line1\nmodified\nline3";

    let result = compute_diff(old.to_string(), new.to_string(), None, None, None).unwrap();

    assert!(result.diff.contains("-line2"));
    assert!(result.diff.contains("+modified"));
    assert_eq!(result.stats.lines_added, 1);
    assert_eq!(result.stats.lines_removed, 1);
}

#[test]
fn test_parse_patch() {
    let patch = r#"
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

    let hunks = parse_patch(patch).unwrap();
    assert_eq!(hunks.len(), 1);
    assert_eq!(hunks[0].old_start, 1);
    assert_eq!(hunks[0].lines.len(), 4); // context + removed + added
}

#[test]
fn test_apply_patch() {
    let original = "line1\nline2\nline3";
    let patch = r#"
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

    let result = apply_patch(original.to_string(), patch.to_string()).unwrap();
    assert!(result.success);
    assert!(result.content.contains("modified"));
    assert!(!result.content.contains("line2"));
}

#[test]
fn test_fuzzy_patch_with_offset() {
    // Original has extra lines at the beginning
    let original = "extra1\nextra2\nline1\nline2\nline3";
    // Patch expects line1 at line 1, but it's at line 3
    let patch = r#"
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
"#;

    let result = apply_fuzzy_patch(
        original.to_string(),
        patch.to_string(),
        Some(FuzzyPatchOptions {
            fuzz_factor: Some(10),
            min_similarity: Some(0.6),
            ignore_whitespace: Some(true),
        }),
    )
    .unwrap();

    assert!(result.success);
    assert!(result.content.contains("modified"));
    // The offset should be +2 (moved 2 lines down)
    assert_eq!(result.hunks[0].offset_applied, 2);
}

#[test]
fn test_merge_no_conflict() {
    let base = "line1\nline2\nline3";
    let ours = "line1\nmodified\nline3";
    let theirs = "line1\nline2\nline3"; // unchanged

    let result = merge_three_way(
        base.to_string(),
        ours.to_string(),
        theirs.to_string(),
        None,
        None,
    )
    .unwrap();

    assert!(result.clean);
    assert!(result.content.contains("modified"));
}

#[test]
fn test_merge_with_conflict() {
    let base = "line1\nline2\nline3";
    let ours = "line1\nours_change\nline3";
    let theirs = "line1\ntheirs_change\nline3";

    let result = merge_three_way(
        base.to_string(),
        ours.to_string(),
        theirs.to_string(),
        None,
        None,
    )
    .unwrap();

    assert!(!result.clean);
    assert_eq!(result.conflict_count, 1);
    assert!(result.content.contains("<<<<<<<"));
    assert!(result.content.contains("======="));
    assert!(result.content.contains(">>>>>>>"));
}

// ============================================
// compute_diff_with_hunks tests
// ============================================

#[test]
fn test_diff_with_hunks_basic() {
    let old = "line1\nline2\nline3";
    let new = "line1\nmodified\nline3";

    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), None);

    assert_eq!(result.hunks.len(), 1);
    assert_eq!(result.stats.additions, 1);
    assert_eq!(result.stats.deletions, 1);
    assert_eq!(result.stats.total_changes, 2);
}

#[test]
fn test_diff_with_hunks_split_rows() {
    let old = "line1\nline2\nline3";
    let new = "line1\nmodified\nline3";

    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), Some(1));

    // Should have split rows for the diff
    assert!(!result.split_rows.is_empty());

    // Find the removed/added rows
    let has_remove = result
        .split_rows
        .iter()
        .any(|row| row.left.cell_type == "remove");
    let has_add = result
        .split_rows
        .iter()
        .any(|row| row.right.cell_type == "add");

    assert!(has_remove);
    assert!(has_add);
}

#[test]
fn test_diff_with_hunks_multiple_changes() {
    let old = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    let new = "line1\nchanged2\nline3\nline4\nline5\nline6\nline7\nchanged8\nline9\nline10";

    // With 1 context line, changes far apart should create 2 hunks
    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), Some(1));

    assert_eq!(result.hunks.len(), 2);
    assert_eq!(result.stats.additions, 2);
    assert_eq!(result.stats.deletions, 2);
}

#[test]
fn test_diff_with_hunks_no_changes() {
    let text = "line1\nline2\nline3";

    let result = compute_diff_with_hunks(text.to_string(), text.to_string(), None);

    assert!(result.hunks.is_empty());
    assert!(result.split_rows.is_empty());
    assert_eq!(result.stats.additions, 0);
    assert_eq!(result.stats.deletions, 0);
}

#[test]
fn test_diff_with_hunks_additions_only() {
    let old = "line1\nline3";
    let new = "line1\nline2\nline3";

    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), None);

    assert_eq!(result.stats.additions, 1);
    assert_eq!(result.stats.deletions, 0);
}

#[test]
fn test_diff_with_hunks_deletions_only() {
    let old = "line1\nline2\nline3";
    let new = "line1\nline3";

    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), None);

    assert_eq!(result.stats.additions, 0);
    assert_eq!(result.stats.deletions, 1);
}

#[test]
fn test_diff_with_hunks_context_lines() {
    let old = "ctx1\nctx2\nold\nctx3\nctx4";
    let new = "ctx1\nctx2\nnew\nctx3\nctx4";

    // With 1 context line
    let result = compute_diff_with_hunks(old.to_string(), new.to_string(), Some(1));

    // Hunk should include ctx2, old/new, ctx3 (1 context each side)
    assert_eq!(result.hunks.len(), 1);
    let hunk = &result.hunks[0];
    // 1 context before + 1 remove + 1 add + 1 context after = 4 lines
    assert_eq!(hunk.lines.len(), 4);
}
