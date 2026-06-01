use crate::providers::copilot::CopilotValidator;

#[test]
fn test_validate_format_fine_grained_pat() {
    let validator = CopilotValidator::new();

    // Valid fine-grained PAT
    let (valid, _) = validator.validate_format("github_pat_1234567890abcdefghij");
    assert!(valid);

    // Too short
    let (valid, _) = validator.validate_format("github_pat_123");
    assert!(!valid);
}

#[test]
fn test_validate_format_classic_pat() {
    let validator = CopilotValidator::new();

    // Valid classic PAT
    let (valid, _) = validator.validate_format("ghp_1234567890abcdefghij");
    assert!(valid);

    // Too short
    let (valid, _) = validator.validate_format("ghp_123");
    assert!(!valid);
}

#[test]
fn test_validate_format_oauth() {
    let validator = CopilotValidator::new();

    // Valid OAuth token
    let (valid, _) = validator.validate_format("gho_1234567890abcdefghij");
    assert!(valid);

    let (valid, _) = validator.validate_format("ghu_1234567890abcdefghij");
    assert!(valid);
}

#[test]
fn test_validate_format_empty() {
    let validator = CopilotValidator::new();
    let (valid, _) = validator.validate_format("");
    assert!(!valid);
}

#[test]
fn test_get_plan_display_name() {
    let validator = CopilotValidator::new();

    assert_eq!(validator.get_plan_display_name("individual", ""), "Pro");
    assert_eq!(validator.get_plan_display_name("", "free_limited"), "Free");
    assert_eq!(validator.get_plan_display_name("business", ""), "Business");
    assert_eq!(
        validator.get_plan_display_name("enterprise", ""),
        "Enterprise"
    );
}
