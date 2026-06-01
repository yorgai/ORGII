use crate::providers::openai::OpenAIValidator;

#[test]
fn test_validate_format() {
    let validator = OpenAIValidator::new();

    let (valid, _) = validator.validate_format("sk-1234567890abcdefghij");
    assert!(valid);

    let (valid, _) = validator.validate_format("sk-proj-1234567890");
    assert!(valid);

    let (valid, _) = validator.validate_format("invalid-key");
    assert!(!valid);

    let (valid, _) = validator.validate_format("");
    assert!(!valid);
}
