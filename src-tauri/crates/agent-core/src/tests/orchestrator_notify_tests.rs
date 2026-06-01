use core_types::workflow::ReviewCommentSeverity;

use crate::orchestrator_notify::{
    extract_first_sentence, parse_file_location, parse_issue_line, parse_structured_review_block,
};

// -- parse_file_location --

#[test]
fn parse_file_location_with_line() {
    let (path, line) = parse_file_location("src/foo.ts:42");
    assert_eq!(path, Some("src/foo.ts".to_string()));
    assert_eq!(line, Some(42));
}

#[test]
fn parse_file_location_no_line() {
    let (path, line) = parse_file_location("src/foo.ts");
    assert_eq!(path, Some("src/foo.ts".to_string()));
    assert_eq!(line, None);
}

#[test]
fn parse_file_location_empty() {
    let (path, line) = parse_file_location("");
    assert!(path.is_none());
    assert!(line.is_none());
}

#[test]
fn parse_file_location_non_numeric_after_colon() {
    let (path, line) = parse_file_location("src/foo.ts:bar");
    assert_eq!(path, Some("src/foo.ts:bar".to_string()));
    assert_eq!(line, None);
}

#[test]
fn parse_file_location_windows_path_with_drive() {
    let (path, line) = parse_file_location("C:\\src\\foo.ts:10");
    assert_eq!(path, Some("C:\\src\\foo.ts".to_string()));
    assert_eq!(line, Some(10));
}

// -- parse_issue_line --

#[test]
fn parse_issue_line_error_with_location() {
    let comment = parse_issue_line("- [ERROR] src/foo.ts:42 — missing null check").unwrap();
    assert_eq!(comment.severity, ReviewCommentSeverity::Error);
    assert_eq!(comment.file_path, Some("src/foo.ts".to_string()));
    assert_eq!(comment.line, Some(42));
    assert_eq!(comment.message, "missing null check");
}

#[test]
fn parse_issue_line_warning_em_dash() {
    let comment = parse_issue_line("- [WARNING] src/bar.rs — potential race condition").unwrap();
    assert_eq!(comment.severity, ReviewCommentSeverity::Warning);
    assert_eq!(comment.file_path, Some("src/bar.rs".to_string()));
    assert!(comment.line.is_none());
}

#[test]
fn parse_issue_line_suggestion_hyphen_dash() {
    let comment = parse_issue_line("- [SUGGESTION] src/lib.rs - consider using iterators").unwrap();
    assert_eq!(comment.severity, ReviewCommentSeverity::Suggestion);
    assert_eq!(comment.message, "consider using iterators");
}

#[test]
fn parse_issue_line_praise() {
    let comment = parse_issue_line("- [PRAISE] src/test.rs — excellent test coverage").unwrap();
    assert_eq!(comment.severity, ReviewCommentSeverity::Praise);
}

#[test]
fn parse_issue_line_unknown_severity() {
    assert!(parse_issue_line("- [INFO] something").is_none());
}

#[test]
fn parse_issue_line_no_dash_prefix() {
    assert!(parse_issue_line("[ERROR] missing dash prefix").is_none());
}

// -- extract_first_sentence --

#[test]
fn extract_first_sentence_period() {
    let result = extract_first_sentence("This is a sentence. And another one.");
    assert_eq!(result, "This is a sentence.");
}

#[test]
fn extract_first_sentence_newline() {
    let result = extract_first_sentence("First line here\nSecond line");
    assert!(result.contains("First line here"));
}

#[test]
fn extract_first_sentence_short_content() {
    let result = extract_first_sentence("Short.");
    assert_eq!(result, "Short.");
}

#[test]
fn extract_first_sentence_long_no_period() {
    let long = "a".repeat(500);
    let result = extract_first_sentence(&long);
    assert!(result.len() < 500, "should truncate long content");
}

#[test]
fn extract_first_sentence_empty() {
    let result = extract_first_sentence("");
    assert!(result.is_empty());
}

// -- parse_structured_review_block --

#[test]
fn parse_review_block_approved() {
    let content = "\
Some analysis here.

---REVIEW_START---
VERDICT: APPROVED
SUMMARY: Everything looks good
---REVIEW_END---
";
    let feedback = parse_structured_review_block(content, "sess-1").unwrap();
    assert_eq!(
        feedback.outcome,
        project_management::projects::types::ReviewOutcome::Approved
    );
    assert_eq!(feedback.summary, "Everything looks good");
    assert!(feedback.comments.is_empty());
    assert_eq!(feedback.session_id, "sess-1");
}

#[test]
fn parse_review_block_changes_requested_with_issues() {
    let content = "\
---REVIEW_START---
VERDICT: CHANGES_REQUESTED
SUMMARY: Several issues found
ISSUES:
- [ERROR] src/main.rs:10 — null pointer
- [WARNING] src/lib.rs — performance concern
- [PRAISE] src/test.rs — good coverage
---REVIEW_END---
";
    let feedback = parse_structured_review_block(content, "sess-2").unwrap();
    assert_eq!(
        feedback.outcome,
        project_management::projects::types::ReviewOutcome::ChangesRequested
    );
    assert_eq!(feedback.comments.len(), 3);
    assert_eq!(feedback.comments[0].severity, ReviewCommentSeverity::Error);
    assert_eq!(
        feedback.comments[1].severity,
        ReviewCommentSeverity::Warning
    );
    assert_eq!(feedback.comments[2].severity, ReviewCommentSeverity::Praise);
}

#[test]
fn parse_review_block_missing_markers() {
    assert!(parse_structured_review_block("no markers here", "sess").is_none());
}

#[test]
fn parse_review_block_no_verdict() {
    let content = "\
---REVIEW_START---
SUMMARY: Missing verdict line
---REVIEW_END---
";
    assert!(parse_structured_review_block(content, "sess").is_none());
}
