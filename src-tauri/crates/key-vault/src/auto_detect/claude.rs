use std::env;
use std::fs;

use super::helpers::{
    create_detected_key, extract_export_value, get_claude_config_paths, get_home_dir,
    validate_anthropic_key, ClaudeConfig,
};
use super::DetectedKey;

/// Detect Claude Code API keys from local config and environment
pub(super) async fn detect_claude_keys() -> Vec<DetectedKey> {
    let mut keys = vec![];

    // Environment variable names to check (in priority order)
    let env_vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

    // 1. Check runtime environment variables
    for env_name in &env_vars {
        if let Ok(api_key) = env::var(env_name) {
            if !api_key.is_empty() {
                let base_url = env::var("ANTHROPIC_BASE_URL").ok();
                let mut cred = create_detected_key(
                    &format!("env_{}", env_name.to_lowercase()),
                    &format!("Environment Variable ({})", env_name),
                    "api_key",
                );
                cred.api_key = Some(api_key.clone());
                cred.base_url = base_url.clone();

                // Validate the key
                let validation = validate_anthropic_key(&api_key, base_url.as_deref()).await;
                cred.validated = Some(validation.0);
                cred.validation_message = validation.1;
                cred.available_models = validation.2;

                keys.push(cred);
                break; // Only use first found
            }
        }
    }

    // 2. Check shell config files (~/.zshrc, ~/.bashrc, ~/.bash_profile)
    // This is useful when GUI apps don't inherit shell environment
    if keys.is_empty() {
        if let Some(cred) = read_anthropic_from_shell_config().await {
            keys.push(cred);
        }
    }

    // 3. Check JSON config files
    let config_paths = get_claude_config_paths();
    for path in config_paths {
        if let Some(cred) = read_claude_config(&path).await {
            // Don't add duplicate keys
            let already_has = keys
                .iter()
                .any(|c| c.api_key.as_ref() == cred.api_key.as_ref());
            if !already_has {
                keys.push(cred);
            }
        }
    }

    keys
}

/// Parse shell config files for Anthropic keys
/// Looks for: export ANTHROPIC_API_KEY=xxx or export ANTHROPIC_AUTH_TOKEN=xxx
async fn read_anthropic_from_shell_config() -> Option<DetectedKey> {
    let home = get_home_dir()?;

    // Shell config files to check (in priority order)
    let shell_configs = [
        home.join(".zshrc"),
        home.join(".bashrc"),
        home.join(".bash_profile"),
        home.join(".profile"),
    ];

    let env_vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

    for config_path in &shell_configs {
        if let Ok(content) = fs::read_to_string(config_path) {
            // Try to find API key
            for env_name in &env_vars {
                if let Some(api_key) = extract_export_value(&content, env_name) {
                    if !api_key.is_empty() {
                        // Also try to extract base URL
                        let base_url = extract_export_value(&content, "ANTHROPIC_BASE_URL");

                        let config_name = config_path.file_name()?.to_string_lossy();
                        let mut cred = create_detected_key(
                            &format!("shell_{}", config_name.replace('.', "_")),
                            &format!("Shell Config (~/{}) - {}", config_name, env_name),
                            "api_key",
                        );
                        cred.api_key = Some(api_key.clone());
                        cred.base_url = base_url.clone();

                        // Validate the key
                        let validation =
                            validate_anthropic_key(&api_key, base_url.as_deref()).await;
                        cred.validated = Some(validation.0);
                        cred.validation_message = validation.1;
                        cred.available_models = validation.2;

                        return Some(cred);
                    }
                }
            }
        }
    }

    None
}

async fn read_claude_config(path: &std::path::PathBuf) -> Option<DetectedKey> {
    // A missing config file is a normal "no detection" outcome and stays
    // silent (Rule 6 — missing ⇒ empty). Read errors and JSON-parse
    // errors instead surface via `warn!` so a corrupt or unreadable
    // config file is visible to the user instead of silently producing
    // a "no Claude key found" result that the user can't debug.
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "auto_detect::claude: config read failed; skipping"
            );
            return None;
        }
    };
    let config: ClaudeConfig = match serde_json::from_str(&content) {
        Ok(c) => c,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "auto_detect::claude: config JSON parse failed; skipping"
            );
            return None;
        }
    };
    let api_key = config.api_key?;

    if api_key.is_empty() {
        return None;
    }

    let mut cred = create_detected_key(
        &format!("file_{}", path.file_name()?.to_string_lossy()),
        &format!("Config File ({})", path.display()),
        "api_key",
    );
    cred.api_key = Some(api_key.clone());
    cred.base_url = config.base_url.clone();

    // Validate
    let validation = validate_anthropic_key(&api_key, config.base_url.as_deref()).await;
    cred.validated = Some(validation.0);
    cred.validation_message = validation.1;
    cred.available_models = validation.2;

    Some(cred)
}
