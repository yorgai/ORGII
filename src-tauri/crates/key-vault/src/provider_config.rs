//! Provider configuration module.
//!
//! Single source of truth for provider-specific settings:
//! - Default base URLs for API providers
//! - Environment variable names for API keys and base URLs
//! - Provider capabilities (supports custom base URL, auth method, etc.)

use serde::Serialize;

/// Provider configuration returned to frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderConfig {
    /// Default env var name for API key (e.g., "ANTHROPIC_API_KEY")
    pub api_key_env_var: String,
    /// Default env var name for base URL (e.g., "AZURE_OPENAI_ENDPOINT")
    pub base_url_env_var: Option<String>,
    /// Whether this provider supports custom base URL (proxy)
    pub supports_base_url: bool,
    /// Default base URL for API calls (used when user doesn't provide one)
    pub default_base_url: Option<String>,
}

/// Get provider configuration for a given model type.
///
/// Returns configuration including env var names and default base URLs.
/// This is the single source of truth - frontend should NOT duplicate these values.
pub fn get_provider_config(model_type: &str) -> ProviderConfig {
    match model_type.to_lowercase().as_str() {
        // === CLI Agents ===
        "cursor_cli" => ProviderConfig {
            api_key_env_var: "CURSOR_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
        "claude_code" => ProviderConfig {
            api_key_env_var: "ANTHROPIC_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
        "codex" => ProviderConfig {
            api_key_env_var: "OPENAI_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
        "gemini_cli" => ProviderConfig {
            api_key_env_var: "GEMINI_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
        "copilot" => ProviderConfig {
            api_key_env_var: "GITHUB_TOKEN".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
        "kiro" => ProviderConfig {
            api_key_env_var: "KIRO_SESSION_TOKEN".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },

        // === Direct API Key Providers ===
        "anthropic_api" => ProviderConfig {
            api_key_env_var: "ANTHROPIC_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.anthropic.com/v1".to_string()),
        },
        "openai_api" => ProviderConfig {
            api_key_env_var: "OPENAI_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.openai.com/v1".to_string()),
        },
        "deepseek_api" => ProviderConfig {
            api_key_env_var: "DEEPSEEK_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.deepseek.com".to_string()),
        },
        "gemini_api" => ProviderConfig {
            api_key_env_var: "GEMINI_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://generativelanguage.googleapis.com/v1beta".to_string()),
        },
        "groq_api" => ProviderConfig {
            api_key_env_var: "GROQ_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.groq.com/openai/v1".to_string()),
        },
        "zhipu_api" => ProviderConfig {
            api_key_env_var: "ZHIPU_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
        },
        "dashscope_api" => ProviderConfig {
            api_key_env_var: "DASHSCOPE_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
        },
        "moonshot_api" => ProviderConfig {
            api_key_env_var: "MOONSHOT_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.moonshot.cn/v1".to_string()),
        },
        "openrouter_api" => ProviderConfig {
            api_key_env_var: "OPENROUTER_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://openrouter.ai/api/v1".to_string()),
        },
        "aihubmix_api" => ProviderConfig {
            api_key_env_var: "AIHUBMIX_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://aihubmix.com/v1".to_string()),
        },
        "minimax_api" => ProviderConfig {
            api_key_env_var: "MINIMAX_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.minimax.chat/v1".to_string()),
        },
        "vllm_api" => ProviderConfig {
            api_key_env_var: "VLLM_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("http://localhost:8000/v1".to_string()),
        },
        "azure_openai_api" => ProviderConfig {
            api_key_env_var: "AZURE_OPENAI_API_KEY".to_string(),
            base_url_env_var: Some("AZURE_OPENAI_ENDPOINT".to_string()),
            supports_base_url: true,
            // No default - user must provide their Azure resource endpoint
            default_base_url: None,
        },
        "azure_anthropic_api" => ProviderConfig {
            api_key_env_var: "AZURE_ANTHROPIC_API_KEY".to_string(),
            base_url_env_var: Some("AZURE_ANTHROPIC_ENDPOINT".to_string()),
            supports_base_url: true,
            // No default - user must provide their Azure resource endpoint
            default_base_url: None,
        },
        "orgii_orchestrator" => ProviderConfig {
            api_key_env_var: "ORGII_API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: true,
            default_base_url: Some("https://api.orgii.ai/v1".to_string()),
        },

        // Unknown provider - return generic defaults
        _ => ProviderConfig {
            api_key_env_var: "API_KEY".to_string(),
            base_url_env_var: None,
            supports_base_url: false,
            default_base_url: None,
        },
    }
}

/// Get all provider configs at once.
/// Frontend can cache this on startup instead of making per-provider calls.
pub fn get_all_provider_configs() -> Vec<(String, ProviderConfig)> {
    let model_types = vec![
        // CLI agents
        "cursor_cli",
        "claude_code",
        "codex",
        "gemini_cli",
        "copilot",
        "kiro",
        // API providers
        "anthropic_api",
        "openai_api",
        "deepseek_api",
        "gemini_api",
        "groq_api",
        "zhipu_api",
        "dashscope_api",
        "moonshot_api",
        "openrouter_api",
        "aihubmix_api",
        "minimax_api",
        "vllm_api",
        "azure_openai_api",
        "azure_anthropic_api",
        "orgii_orchestrator",
    ];

    model_types
        .into_iter()
        .map(|mt| (mt.to_string(), get_provider_config(mt)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_provider_config_openai() {
        let config = get_provider_config("openai_api");
        assert_eq!(config.api_key_env_var, "OPENAI_API_KEY");
        assert!(config.supports_base_url);
        assert_eq!(
            config.default_base_url,
            Some("https://api.openai.com/v1".to_string())
        );
    }

    #[test]
    fn test_get_provider_config_case_insensitive() {
        let config = get_provider_config("OPENAI_API");
        assert_eq!(config.api_key_env_var, "OPENAI_API_KEY");
    }

    #[test]
    fn test_get_provider_config_azure() {
        let config = get_provider_config("azure_openai_api");
        assert_eq!(config.api_key_env_var, "AZURE_OPENAI_API_KEY");
        assert_eq!(
            config.base_url_env_var,
            Some("AZURE_OPENAI_ENDPOINT".to_string())
        );
        assert!(config.supports_base_url);
        assert!(config.default_base_url.is_none()); // No default for Azure
    }

    #[test]
    fn test_get_all_provider_configs() {
        let configs = get_all_provider_configs();
        assert!(!configs.is_empty());
        // Should have at least the main providers
        assert!(configs.iter().any(|(k, _)| k == "openai_api"));
        assert!(configs.iter().any(|(k, _)| k == "anthropic_api"));
        assert!(configs.iter().any(|(k, _)| k == "cursor_cli"));
    }
}
