use super::*;

#[test]
fn test_strip_line_comments() {
    let input = r#"{
  // This is a comment
  "key": "value"
}"#;
    let result = strip_jsonc_comments(input);
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["key"], "value");
}

#[test]
fn test_strip_block_comments() {
    let input = r#"{
  /* block comment */
  "key": /* inline */ "value"
}"#;
    let result = strip_jsonc_comments(input);
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["key"], "value");
}

#[test]
fn test_preserve_strings_with_slashes() {
    let input = r#"{
  "url": "https://example.com" // comment
}"#;
    let result = strip_jsonc_comments(input);
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["url"], "https://example.com");
}

#[test]
fn test_empty_object() {
    let input = "{}";
    let result = strip_jsonc_comments(input);
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert!(parsed.is_object());
}
