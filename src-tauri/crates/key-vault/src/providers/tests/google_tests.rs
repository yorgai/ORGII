use crate::providers::google::GoogleValidator;

#[test]
fn test_validate_format() {
    let validator = GoogleValidator::new();

    let (valid, _) = validator.validate_format("AIza1234567890abcdefghij");
    assert!(valid);

    // Relaxed validation: any key >= 10 chars is accepted (proxy APIs use varied formats)
    let (valid, _) = validator.validate_format("sk-1234567890abcdefghij");
    assert!(valid);

    let (valid, _) = validator.validate_format("custom-key-format-12345");
    assert!(valid);

    let (valid, msg) = validator.validate_format("short");
    assert!(!valid);
    assert!(msg.contains("too short"));

    let (valid, msg) = validator.validate_format("");
    assert!(!valid);
    assert!(msg.contains("required"));
}
