use std::env;

use super::helpers::{create_detected_key, validate_google_key};
use super::DetectedKey;

/// Detect Gemini API keys from environment
pub(super) async fn detect_gemini_keys() -> Vec<DetectedKey> {
    let mut keys = vec![];

    // 1. Check environment variables
    for env_name in ["GEMINI_API_KEY", "GOOGLE_API_KEY"] {
        if let Ok(api_key) = env::var(env_name) {
            if !api_key.is_empty() {
                let mut cred = create_detected_key(
                    &format!("env_{}", env_name.to_lowercase()),
                    &format!("Environment Variable ({})", env_name),
                    "api_key",
                );
                cred.api_key = Some(api_key.clone());

                // Validate the key
                let validation = validate_google_key(&api_key, None).await;
                cred.validated = Some(validation.0);
                cred.validation_message = validation.1;
                cred.available_models = validation.2;

                keys.push(cred);
                break; // Only use first found
            }
        }
    }

    keys
}
