use std::env;
use std::fs;

use super::helpers::{create_detected_key, get_home_dir, validate_github_token};
use super::DetectedKey;

/// Detect Copilot tokens from environment and GitHub CLI config
pub(super) async fn detect_copilot_keys() -> Vec<DetectedKey> {
    let mut keys = vec![];

    // 1. Check environment variables
    for env_name in ["GITHUB_TOKEN", "GH_TOKEN"] {
        if let Ok(token) = env::var(env_name) {
            if !token.is_empty() {
                let mut cred = create_detected_key(
                    &format!("env_{}", env_name.to_lowercase()),
                    &format!("Environment Variable ({})", env_name),
                    "api_key",
                );
                cred.api_key = Some(token.clone());

                // Validate the token
                let validation = validate_github_token(&token).await;
                cred.validated = Some(validation.0);
                cred.validation_message = validation.1;

                keys.push(cred);
                break; // Only use first found
            }
        }
    }

    // 2. Check GitHub CLI config
    if let Some(cred) = read_github_cli_config().await {
        keys.push(cred);
    }

    keys
}

async fn read_github_cli_config() -> Option<DetectedKey> {
    let home = get_home_dir()?;
    let config_path = home.join(".config/gh/hosts.yml");

    let content = fs::read_to_string(&config_path).ok()?;

    // Parse YAML to find oauth_token for github.com
    // Simple regex-based extraction (avoiding yaml dependency)
    let token = extract_github_token_from_config(&content)?;

    let mut cred = create_detected_key("gh_cli", "GitHub CLI", "oauth");
    cred.session_token = Some(token.clone());

    // Validate
    let validation = validate_github_token(&token).await;
    cred.validated = Some(validation.0);
    cred.validation_message = validation.1;

    Some(cred)
}

pub(crate) fn extract_github_token_from_config(content: &str) -> Option<String> {
    // Look for oauth_token: <token> in the YAML
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("oauth_token:") {
            let token = line.strip_prefix("oauth_token:")?.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}
