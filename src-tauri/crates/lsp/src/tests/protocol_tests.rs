use super::*;

#[test]
fn test_format_lsp_message() {
    let json = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let formatted = format_lsp_message(json);

    assert!(formatted.starts_with("Content-Length: "));
    assert!(formatted.contains("\r\n\r\n"));
    assert!(formatted.ends_with(json));
}

#[test]
fn test_format_lsp_message_uses_byte_length_for_multibyte_bodies() {
    // Regression guard: the Content-Length header must count UTF-8
    // bytes, not characters. We use `str::len()` (which is bytes)
    // and cross-check that it differs from `chars().count()` so a
    // future "fix" to character count would break the assertion.
    let json = r#"{"msg":"héllo"}"#;
    assert_ne!(
        json.len(),
        json.chars().count(),
        "test body must be multibyte"
    );
    let formatted = format_lsp_message(json);
    let expected_prefix = format!("Content-Length: {}\r\n\r\n", json.len());
    assert!(formatted.starts_with(&expected_prefix));
}
