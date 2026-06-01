use std::env;

use super::helpers::create_detected_key;
use super::DetectedKey;

use crate::providers::kiro::get_local_kiro_token;

/// Detect Kiro OAuth tokens from local storage
pub(super) async fn detect_kiro_keys() -> Vec<DetectedKey> {
    let mut keys = vec![];

    // 1. Check environment variables
    for env_name in ["KIRO_ACCESS_TOKEN", "KIRO_REFRESH_TOKEN"] {
        if let Ok(token) = env::var(env_name) {
            if !token.is_empty() {
                let mut cred = create_detected_key(
                    &format!("env_{}", env_name.to_lowercase()),
                    &format!("Environment Variable ({})", env_name),
                    "oauth",
                );
                if env_name == "KIRO_ACCESS_TOKEN" {
                    cred.session_token = Some(token.clone());
                } else {
                    // Store refresh token in env_vars
                    let mut env_vars = std::collections::HashMap::new();
                    env_vars.insert("KIRO_REFRESH_TOKEN".to_string(), token);
                    cred.env_vars = Some(env_vars);
                }
                cred.validated = None;
                cred.validation_message =
                    Some("Token found in environment (not yet validated)".to_string());
                keys.push(cred);
                break;
            }
        }
    }

    // 2. Check local OAuth token storage (Keychain/Keyring/SQLite)
    if let Some(token) = get_local_kiro_token() {
        let mut cred = create_detected_key("local_oauth", "Local OAuth (kiro-cli login)", "oauth");

        // Store the full token JSON for validation. Serialization is
        // infallible for the typed `KiroOAuthToken` struct (Rule 41),
        // so a failure here is a logic bug — surface it via `expect`
        // instead of silently dumping an empty session token that
        // would later look like "no auth detected".
        let token_json =
            serde_json::to_string(&token).expect("auto_detect::kiro: KiroToken must serialize");
        cred.session_token = Some(token_json);

        // Check expiration
        let is_expired = token.is_expired();
        let has_refresh = token.refresh_token.is_some();

        if is_expired && has_refresh {
            cred.validated = Some(true);
            cred.validation_message = Some("Token expired but refresh token available".to_string());
        } else if is_expired {
            cred.validated = Some(false);
            cred.validation_message =
                Some("Token expired. Run 'kiro-cli login' to refresh.".to_string());
        } else {
            cred.validated = Some(true);
            cred.validation_message = Some("Valid OAuth token".to_string());
        }

        // Kiro uses credit-based system - no public API to fetch quota
        // Don't set quota_info to avoid showing misleading "Unlimited"
        // User should check Kiro dashboard for credit usage

        // Add available models
        cred.available_models = Some(crate::providers::kiro::get_kiro_models());

        keys.push(cred);
    }

    keys
}
