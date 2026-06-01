use super::helpers::strip_ide_context;

// ============================================
// strip_ide_context
// ============================================

#[test]
fn strip_ide_context_no_tag() {
    assert_eq!(strip_ide_context("Hello world"), "Hello world");
}

#[test]
fn strip_ide_context_with_tag() {
    let input = "<ide_context>some data</ide_context>Actual message";
    assert_eq!(strip_ide_context(input), "Actual message");
}

#[test]
fn strip_ide_context_in_middle() {
    let input = "Before <ide_context>data</ide_context> After";
    assert_eq!(strip_ide_context(input), "Before After");
}

#[test]
fn strip_ide_context_trailing_whitespace_newlines() {
    let input = "<ide_context>data</ide_context>\n\nHello";
    assert_eq!(strip_ide_context(input), "Hello");
}

#[test]
fn strip_ide_context_missing_close_tag() {
    let input = "<ide_context>data without close";
    assert_eq!(strip_ide_context(input), "<ide_context>data without close");
}

#[test]
fn strip_ide_context_missing_open_tag() {
    let input = "just text</ide_context>";
    assert_eq!(strip_ide_context(input), "just text</ide_context>");
}

#[test]
fn strip_ide_context_empty() {
    let input = "<ide_context></ide_context>Content";
    assert_eq!(strip_ide_context(input), "Content");
}

#[test]
fn strip_ide_context_only_tag() {
    let input = "<ide_context>data</ide_context>";
    assert_eq!(strip_ide_context(input), "");
}
