use crate::auto_detect::auto_detect_key;
use crate::auto_detect::copilot::extract_github_token_from_config;
use crate::auto_detect::helpers::{create_detected_key, extract_export_value};
use crate::test_support::install_crypto_provider_for_tests;

#[tokio::test]
async fn test_auto_detect_unknown_agent() {
    let result = auto_detect_key("unknown_agent").await;
    assert!(!result.success);
    assert!(result.message.contains("Unknown agent type"));
}

#[tokio::test]
async fn test_auto_detect_cursor() {
    install_crypto_provider_for_tests();
    // Cursor detection reads from local state.vscdb database
    // Success depends on whether user is logged in to Cursor IDE
    let result = auto_detect_key("cursor_cli").await;

    // Either succeeds with detected keys OR fails with "No keys found"
    if result.success {
        assert!(!result.keys.is_empty());
        // Should have a session token
        let entry = &result.keys[0];
        assert!(entry.session_token.is_some());
        println!("Found Cursor key entry: validated={:?}", entry.validated);
    } else {
        // No keys found (user not logged in or Cursor not installed)
        assert!(result.keys.is_empty());
    }
}

#[test]
fn test_extract_github_token() {
    let config = r#"
github.com:
    user: testuser
    oauth_token: ghp_xxxxxxxxxxxx
    git_protocol: https
"#;
    let token = extract_github_token_from_config(config);
    assert_eq!(token, Some("ghp_xxxxxxxxxxxx".to_string()));
}

#[test]
fn test_create_detected_key() {
    let cred = create_detected_key("test_id", "Test Name", "api_key");
    assert_eq!(cred.id, "test_id");
    assert_eq!(cred.name, "Test Name");
    assert_eq!(cred.auth_method, "api_key");
    assert!(cred.api_key.is_none());
}

#[test]
fn test_extract_export_value() {
    // Basic export
    let content = "export ANTHROPIC_API_KEY=sk-ant-xxx";
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("sk-ant-xxx".to_string())
    );

    // Double-quoted value
    let content = r#"export ANTHROPIC_API_KEY="sk-ant-xxx""#;
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("sk-ant-xxx".to_string())
    );

    // Single-quoted value
    let content = "export ANTHROPIC_API_KEY='sk-ant-xxx'";
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("sk-ant-xxx".to_string())
    );

    // With inline comment
    let content = r#"export ANTHROPIC_API_KEY="sk-ant-xxx" # my key"#;
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("sk-ant-xxx".to_string())
    );

    // Without export keyword
    let content = "ANTHROPIC_API_KEY=sk-ant-xxx";
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("sk-ant-xxx".to_string())
    );

    // Skip commented lines
    let content = "# export ANTHROPIC_API_KEY=old\nexport ANTHROPIC_API_KEY=new";
    assert_eq!(
        extract_export_value(content, "ANTHROPIC_API_KEY"),
        Some("new".to_string())
    );

    // Skip variable references
    let content = "export ANTHROPIC_API_KEY=$OTHER_VAR";
    assert_eq!(extract_export_value(content, "ANTHROPIC_API_KEY"), None);

    // Not found
    let content = "export OTHER_VAR=value";
    assert_eq!(extract_export_value(content, "ANTHROPIC_API_KEY"), None);
}

// ── extract_export_value ──

#[test]
fn extract_export_value_double_quoted() {
    let content = r#"export FOO="bar baz""#;
    assert_eq!(
        extract_export_value(content, "FOO").as_deref(),
        Some("bar baz")
    );
}

#[test]
fn extract_export_value_single_quoted() {
    let content = "export FOO='bar'";
    assert_eq!(extract_export_value(content, "FOO").as_deref(), Some("bar"));
}

#[test]
fn extract_export_value_inline_comment_after_quoted() {
    let content = r#"export FOO="bar" # comment"#;
    assert_eq!(extract_export_value(content, "FOO").as_deref(), Some("bar"));
}

#[test]
fn extract_export_value_unquoted_strips_trailing_comment() {
    let content = "export FOO=bar # comment";
    assert_eq!(extract_export_value(content, "FOO").as_deref(), Some("bar"));
}

#[test]
fn extract_export_value_skips_commented_line() {
    let content = "# export FOO=ignored\nexport FOO=real";
    assert_eq!(
        extract_export_value(content, "FOO").as_deref(),
        Some("real")
    );
}

#[test]
fn extract_export_value_rejects_variable_reference() {
    let content = "export FOO=$BAR";
    assert!(extract_export_value(content, "FOO").is_none());
}

#[test]
fn extract_export_value_without_export_keyword() {
    let content = "FOO=bar";
    assert_eq!(extract_export_value(content, "FOO").as_deref(), Some("bar"));
}

#[test]
fn extract_export_value_returns_none_when_missing() {
    let content = "export OTHER=value\nexport ANOTHER=thing";
    assert!(extract_export_value(content, "FOO").is_none());
}

#[test]
fn extract_export_value_empty_value_returns_none() {
    let content = "export FOO=";
    assert!(extract_export_value(content, "FOO").is_none());
}

#[test]
fn extract_export_value_picks_first_match() {
    // The loop iterates lines in order and returns on the first valid match.
    let content = "export FOO=first\nexport FOO=second";
    assert_eq!(
        extract_export_value(content, "FOO").as_deref(),
        Some("first")
    );
}

#[test]
fn extract_export_value_handles_leading_whitespace() {
    // The impl calls `line.trim()` before matching, so leading spaces/tabs are fine.
    let content = "   export FOO=bar";
    assert_eq!(extract_export_value(content, "FOO").as_deref(), Some("bar"));
}

#[test]
fn extract_export_value_other_var_not_picked_up() {
    // The impl's prefix is `format!("export {}=", var_name)`, so searching for
    // "FOO" against `export FOOBAR=x` does NOT match because the trailing `=`
    // forces the variable name boundary. Confirmed by reading helpers.rs.
    let content = "export FOOBAR=x";
    assert!(extract_export_value(content, "FOO").is_none());
}
