use crate::providers::anthropic::AnthropicValidator;

#[test]
fn test_validate_format() {
    let validator = AnthropicValidator::new();

    let (valid, _) = validator.validate_format("sk-ant-1234567890abcdefghij");
    assert!(valid);

    let (valid, _) = validator.validate_format("sk_1234567890abcdefghij");
    assert!(valid);

    let (valid, _) = validator.validate_format("invalid-key");
    assert!(!valid);
}
