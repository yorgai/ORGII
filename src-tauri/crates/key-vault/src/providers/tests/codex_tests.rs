use crate::providers::codex::CodexValidator;

#[test]
fn test_validate_format_jwt() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test");
    assert!(valid);
}

#[test]
fn test_validate_format_api_key() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("sk-proj-abc123");
    assert!(valid);
}

#[test]
fn test_validate_format_empty() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("");
    assert!(!valid);
}
