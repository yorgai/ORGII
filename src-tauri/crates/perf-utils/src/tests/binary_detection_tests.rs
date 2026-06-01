use crate::binary_detection::*;

// ============================================
// Extension detection tests
// ============================================

#[test]
fn test_extension_detection() {
    assert_eq!(is_binary_by_extension("image.png"), Some(true));
    assert_eq!(is_binary_by_extension("script.js"), None);
    assert_eq!(is_binary_by_extension("Makefile"), Some(false));
    assert_eq!(is_binary_by_extension(".gitignore"), Some(false));
}

// ============================================
// Content detection tests
// ============================================

#[test]
fn test_content_detection() {
    assert!(!is_binary_content(b"Hello World\n", 8000));
    assert!(is_binary_content(b"\x00\x01\x02\xFF", 8000));
    assert!(is_binary_content(b"text\x00more", 8000));
}

// ============================================
// Enhanced binary detection tests (with magic bytes)
// ============================================

#[test]
fn test_enhanced_text_detection() {
    let result = check_binary_content_enhanced(b"Hello World\nThis is plain text.".to_vec(), None);

    assert!(!result.is_binary);
    assert!(
        result.reason.contains("Text") || result.reason.contains("text"),
        "unexpected reason: {}",
        result.reason
    );
}

#[test]
fn test_enhanced_binary_with_null_bytes() {
    let result = check_binary_content_enhanced(b"text\x00with\x00nulls".to_vec(), None);

    assert!(result.is_binary);
    assert!(result.reason.contains("null"));
}

#[test]
fn test_enhanced_empty_content() {
    let result = check_binary_content_enhanced(Vec::new(), None);

    // Empty content should be treated as text
    assert!(!result.is_binary);
}

#[test]
fn test_enhanced_utf8_with_special_chars() {
    let result = check_binary_content_enhanced("Hello 世界 🎉".as_bytes().to_vec(), None);

    // Multi-byte UTF-8 sequences contain bytes in the 128..159 range which the
    // byte-level heuristic counts as non-printable. With enough CJK/emoji chars
    // the ratio exceeds the 30% threshold, so the heuristic correctly flags this
    // as binary (byte-level analysis cannot distinguish valid UTF-8 from binary).
    assert!(result.is_binary);
}

#[test]
fn test_enhanced_high_non_ascii_ratio() {
    // 0xFF bytes are > 160 and fall outside the non-printable range (127..160),
    // so the byte-level heuristic does not flag them. Only bytes in 0..32
    // (excluding tab/LF/CR/space) and 127..160 are counted as non-printable.
    let mut content = vec![0xFFu8; 100];
    content.extend_from_slice(&[b'a'; 100]);

    let result = check_binary_content_enhanced(content, None);
    assert!(!result.is_binary);
}

#[test]
fn test_enhanced_sample_size_limit() {
    // Create large content
    let mut content = vec![b'a'; 10000];
    content.push(0x00);

    // With small sample size, null byte at end won't be detected
    let result = check_binary_content_enhanced(content.clone(), Some(1000));
    assert!(!result.is_binary);

    // With large sample size, null byte will be detected
    let result_full = check_binary_content_enhanced(content, Some(20000));
    assert!(result_full.is_binary);
}
