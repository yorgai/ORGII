use crate::watch::debounce::truncate_preview;

// ============================================
// truncate_preview
// ============================================

#[test]
fn truncate_preview_short_string_unchanged() {
    assert_eq!(truncate_preview("hello", 100), "hello");
}

#[test]
fn truncate_preview_at_exact_limit() {
    assert_eq!(truncate_preview("abcde", 5), "abcde");
}

#[test]
fn truncate_preview_long_string_truncated() {
    let result = truncate_preview("hello world this is long", 10);
    assert!(result.ends_with("..."));
    assert!(result.len() <= 13); // 10 + "..."
}

#[test]
fn truncate_preview_empty_string() {
    assert_eq!(truncate_preview("", 10), "");
}

#[test]
fn truncate_preview_multibyte_respects_char_boundary() {
    let input = "你好世界";
    let result = truncate_preview(input, 7);
    assert!(result.ends_with("..."));
    // Each CJK character is 3 bytes; 6 bytes fits two characters, while
    // 7 bytes lands mid-character. The preview should snap back to two
    // complete characters plus the ellipsis.
    assert!(result.starts_with("你好"));
}

#[test]
fn truncate_preview_single_byte_limit() {
    let result = truncate_preview("hello", 1);
    assert_eq!(result, "h...");
}

#[test]
fn truncate_preview_emoji_respects_boundary() {
    let input = "🎉🎊🎈";
    let result = truncate_preview(input, 5);
    assert!(result.ends_with("..."));
    // 🎉 = 4 bytes, max 5 → snap back to 4
    assert!(result.starts_with("🎉"));
}
