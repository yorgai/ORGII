use crate::github::detect::{extract_gh_cli_token, extract_gh_cli_username};

#[test]
fn extract_token_standard_yaml() {
    let content = "github.com:\n    oauth_token: gho_abc123\n    user: testuser\n";
    assert_eq!(
        extract_gh_cli_token(content),
        Some("gho_abc123".to_string())
    );
}

#[test]
fn extract_token_no_indentation() {
    let content = "oauth_token: gho_xyz789\n";
    assert_eq!(
        extract_gh_cli_token(content),
        Some("gho_xyz789".to_string())
    );
}

#[test]
fn extract_token_empty_value() {
    let content = "oauth_token: \n";
    assert_eq!(extract_gh_cli_token(content), None);
}

#[test]
fn extract_token_missing() {
    let content = "user: testuser\ngit_protocol: https\n";
    assert_eq!(extract_gh_cli_token(content), None);
}

#[test]
fn extract_token_empty_content() {
    assert_eq!(extract_gh_cli_token(""), None);
}

#[test]
fn extract_username_standard_yaml() {
    let content = "github.com:\n    user: octocat\n    oauth_token: gho_abc\n";
    assert_eq!(
        extract_gh_cli_username(content),
        Some("octocat".to_string())
    );
}

#[test]
fn extract_username_missing() {
    let content = "oauth_token: gho_abc\ngit_protocol: https\n";
    assert_eq!(extract_gh_cli_username(content), None);
}

#[test]
fn extract_username_empty_value() {
    let content = "user: \n";
    assert_eq!(extract_gh_cli_username(content), None);
}

#[test]
fn extract_username_with_extra_spaces() {
    let content = "    user:    spacey-user   \n";
    assert_eq!(
        extract_gh_cli_username(content),
        Some("spacey-user".to_string())
    );
}
