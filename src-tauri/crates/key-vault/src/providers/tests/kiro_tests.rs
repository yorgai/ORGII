use crate::providers::kiro::{KiroToken, KiroValidator};

#[test]
fn test_token_format_validation() {
    let validator = KiroValidator::new();

    // Valid access token
    let (valid, _) = validator.validate_format("aoaAAAAA...");
    assert!(valid);

    // Valid refresh token
    let (valid, _) = validator.validate_format("aorAAAAA...");
    assert!(valid);

    // Valid JSON
    let json = r#"{"access_token":"aoaAAAAA...","refresh_token":"aorAAAAA..."}"#;
    let (valid, _) = validator.validate_format(json);
    assert!(valid);

    // Invalid
    let (valid, _) = validator.validate_format("invalid_token");
    assert!(!valid);
}

#[test]
fn test_token_expiration() {
    // Expired token
    let token = KiroToken {
        access_token: "test".to_string(),
        refresh_token: None,
        expires_at: Some("2020-01-01T00:00:00Z".to_string()),
        region: None,
        start_url: None,
        oauth_flow: None,
        scopes: None,
        client_id: None,
        client_secret: None,
    };
    assert!(token.is_expired());

    // Future token
    let token = KiroToken {
        access_token: "test".to_string(),
        refresh_token: None,
        expires_at: Some("2099-01-01T00:00:00Z".to_string()),
        region: None,
        start_url: None,
        oauth_flow: None,
        scopes: None,
        client_id: None,
        client_secret: None,
    };
    assert!(!token.is_expired());
}
