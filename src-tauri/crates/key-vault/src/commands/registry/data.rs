//! Static registry data for CLI agents and API providers.
//!
//! Pure data — no Tauri dependency, no runtime I/O.
//! To add or remove an agent/provider, edit the vectors returned by
//! `cli_agent_registry()` / `api_provider_registry()`.

use super::{AgentEnvConfig, CliInstallMethod};

// ============================================
// Internal entry types (not serialized)
// ============================================

pub(super) struct CliAgentEntry {
    pub name: &'static str,
    pub display_name: &'static str,
    pub binary: &'static str,
    pub description: &'static str,
    pub brand_color: &'static str,
    pub docs_url: &'static str,
    pub has_subscription_plan: bool,
    pub compatible_api_providers: &'static [&'static str],
    pub is_complex_setup: bool,
    pub default_setup_method: Option<&'static str>,
    pub popular: bool,
    pub icon_provider: &'static str,
    pub paired_api_provider: Option<&'static str>,
    pub supports_rust_agents: bool,
}

pub(super) struct ApiProviderEntry {
    pub name: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub brand_color: &'static str,
    pub docs_url: &'static str,
    pub icon_provider: &'static str,
    pub paired_cli_agent: Option<&'static str>,
    pub popular: bool,
    pub supports_rust_agents: bool,
}

// ============================================
// Registry data
// ============================================

pub(super) fn cli_agent_registry() -> Vec<CliAgentEntry> {
    vec![
        CliAgentEntry {
            name: "cursor_cli",
            display_name: "Cursor CLI",
            binary: "cursor",
            description: "Cursor's command-line agent for AI-assisted coding",
            brand_color: "#00A67E",
            docs_url: "https://cursor.com/docs/cli/overview",
            has_subscription_plan: true,
            compatible_api_providers: &[],
            is_complex_setup: true,
            default_setup_method: Some("guided"),
            popular: true,
            icon_provider: "cursor",
            paired_api_provider: None,
            supports_rust_agents: false,
        },
        CliAgentEntry {
            name: "claude_code",
            display_name: "Claude Code",
            binary: "claude",
            description: "Anthropic's Claude Code CLI for Claude models",
            brand_color: "#D97706",
            docs_url: "https://docs.anthropic.com/en/docs/claude-code",
            has_subscription_plan: true,
            compatible_api_providers: &["anthropic_api", "moonshot_api"],
            is_complex_setup: false,
            default_setup_method: None,
            popular: true,
            icon_provider: "claude_code",
            paired_api_provider: Some("anthropic_api"),
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "codex",
            display_name: "Codex",
            binary: "codex",
            description: "OpenAI's Codex CLI for GPT models",
            brand_color: "#10A37F",
            docs_url: "https://github.com/openai/codex",
            has_subscription_plan: true,
            compatible_api_providers: &["openai_api"],
            is_complex_setup: false,
            default_setup_method: None,
            popular: true,
            icon_provider: "openai",
            paired_api_provider: Some("openai_api"),
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "gemini_cli",
            display_name: "Gemini CLI",
            binary: "gemini",
            description: "Google's Gemini CLI for Gemini models",
            brand_color: "#4285F4",
            docs_url: "https://github.com/google-gemini/gemini-cli",
            has_subscription_plan: true,
            compatible_api_providers: &["gemini_api"],
            is_complex_setup: false,
            default_setup_method: None,
            popular: false,
            icon_provider: "gemini",
            paired_api_provider: Some("gemini_api"),
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "kiro",
            display_name: "Amazon Kiro",
            binary: "kiro-cli-chat",
            description: "Amazon's Bedrock-powered AI coding assistant",
            brand_color: "#9046FF",
            docs_url: "https://kiro.dev/docs/cli/installation",
            has_subscription_plan: true,
            compatible_api_providers: &[],
            is_complex_setup: true,
            default_setup_method: Some("autodetect"),
            popular: false,
            icon_provider: "kiro",
            paired_api_provider: None,
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "copilot",
            display_name: "GitHub Copilot",
            binary: "copilot",
            description: "GitHub's AI coding assistant",
            brand_color: "#0066FF",
            docs_url:
                "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-in-the-cli",
            has_subscription_plan: true,
            compatible_api_providers: &[],
            is_complex_setup: true,
            default_setup_method: None,
            popular: true,
            icon_provider: "copilot",
            paired_api_provider: None,
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "kimi_cli",
            display_name: "Kimi Code CLI",
            binary: "kimi",
            description: "Moonshot's Kimi Code CLI for AI-assisted coding in the terminal",
            brand_color: "#000000",
            docs_url: "https://www.kimi.com/code/docs/en/",
            has_subscription_plan: false,
            compatible_api_providers: &["moonshot_api"],
            is_complex_setup: false,
            default_setup_method: None,
            popular: false,
            icon_provider: "kimi",
            paired_api_provider: Some("moonshot_api"),
            supports_rust_agents: true,
        },
        CliAgentEntry {
            name: "opencode",
            display_name: "OpenCode",
            binary: "opencode",
            description: "Open source AI coding agent for the terminal (75+ providers)",
            brand_color: "#FF6B35",
            docs_url: "https://opencode.ai/docs/cli/",
            has_subscription_plan: false,
            compatible_api_providers: &[
                "anthropic_api",
                "openai_api",
                "deepseek_api",
                "gemini_api",
                "openrouter_api",
                "moonshot_api",
            ],
            is_complex_setup: false,
            default_setup_method: None,
            popular: false,
            icon_provider: "opencode",
            paired_api_provider: None,
            supports_rust_agents: true,
        },
    ]
}

pub(super) fn api_provider_registry() -> Vec<ApiProviderEntry> {
    vec![
        ApiProviderEntry {
            name: "openai_api",
            display_name: "OpenAI",
            description: "OpenAI's GPT models via API",
            brand_color: "#10A37F",
            docs_url: "https://platform.openai.com/docs",
            icon_provider: "openai",
            paired_cli_agent: Some("codex"),
            popular: true,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "anthropic_api",
            display_name: "Anthropic",
            description: "Anthropic's Claude models via API",
            brand_color: "#D97706",
            docs_url: "https://docs.anthropic.com",
            icon_provider: "claude",
            paired_cli_agent: Some("claude_code"),
            popular: true,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "gemini_api",
            display_name: "Google Gemini",
            description: "Google's Gemini models via API",
            brand_color: "#4285F4",
            docs_url: "https://ai.google.dev/docs",
            icon_provider: "gemini",
            paired_cli_agent: Some("gemini_cli"),
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "deepseek_api",
            display_name: "DeepSeek",
            description: "DeepSeek's models via API",
            brand_color: "#0066FF",
            docs_url: "https://platform.deepseek.com/docs",
            icon_provider: "deepseek",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "groq_api",
            display_name: "Groq",
            description: "Groq's fast inference API",
            brand_color: "#F55036",
            docs_url: "https://console.groq.com/docs",
            icon_provider: "groq",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "xai_api",
            display_name: "xAI Grok",
            description: "xAI's Grok models via API",
            brand_color: "#111111",
            docs_url: "https://docs.x.ai/docs",
            icon_provider: "grok",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "zhipu_api",
            display_name: "Zhipu AI",
            description: "Zhipu's GLM models via API",
            brand_color: "#4A6CF7",
            docs_url: "https://open.bigmodel.cn/docs",
            icon_provider: "zhipu",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "dashscope_api",
            display_name: "Qwen (DashScope)",
            description: "Alibaba's Qwen models via DashScope",
            brand_color: "#FF6A00",
            docs_url: "https://help.aliyun.com/document_detail/2712195.html",
            icon_provider: "qwen",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "moonshot_api",
            display_name: "Kimi Moonshot",
            description: "Moonshot's Kimi models via API",
            brand_color: "#000000",
            docs_url: "https://platform.moonshot.cn/docs",
            icon_provider: "kimi",
            paired_cli_agent: Some("kimi_cli"),
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "openrouter_api",
            display_name: "OpenRouter",
            description: "Multi-provider API gateway",
            brand_color: "#6366F1",
            docs_url: "https://openrouter.ai/docs",
            icon_provider: "openrouter",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "aihubmix_api",
            display_name: "AiHubMix",
            description: "Multi-provider API gateway",
            brand_color: "#10B981",
            docs_url: "https://aihubmix.com/docs",
            icon_provider: "aihubmix",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "minimax_api",
            display_name: "MiniMax",
            description: "MiniMax's models via API",
            brand_color: "#1A1A2E",
            docs_url: "https://platform.minimaxi.com/document/introduction",
            icon_provider: "minimax",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "vllm_api",
            display_name: "vLLM / Local",
            description: "Self-hosted vLLM or local API endpoint",
            brand_color: "#7C3AED",
            docs_url: "https://docs.vllm.ai",
            icon_provider: "vllm",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "azure_openai_api",
            display_name: "Azure OpenAI",
            description: "OpenAI models via Azure",
            brand_color: "#0078D4",
            docs_url: "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
            icon_provider: "azure",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "azure_anthropic_api",
            display_name: "Azure Anthropic",
            description: "Anthropic models via Azure",
            brand_color: "#0078D4",
            docs_url: "https://learn.microsoft.com/en-us/azure/ai-services/",
            icon_provider: "azure",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: true,
        },
        ApiProviderEntry {
            name: "orgii_orchestrator",
            display_name: "ORGII Token Market",
            description: "Pay-per-use via ORGII Token Market",
            brand_color: "#F59E0B",
            docs_url: "https://soyd.ai/docs/token-market",
            icon_provider: "orgii",
            paired_cli_agent: None,
            popular: false,
            supports_rust_agents: false,
        },
    ]
}

// ============================================
// Install / uninstall / env config helpers
// ============================================

pub(super) fn cli_install_methods(name: &str) -> Vec<CliInstallMethod> {
    let m = |id: &str, label: &str, cmd: &str| CliInstallMethod {
        id: id.into(),
        label: label.into(),
        command: cmd.into(),
    };
    match name {
        "claude_code" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://claude.ai/install.sh | bash",
            ),
            m(
                "powershell",
                "PowerShell",
                "irm https://claude.ai/install.ps1 | iex",
            ),
            m("homebrew", "Homebrew", "brew install --cask claude-code"),
            m("npm", "npm", "npm install -g @anthropic-ai/claude-code"),
        ],
        "codex" => vec![
            m("npm", "npm", "npm install -g @openai/codex"),
            m("homebrew", "Homebrew", "brew install --cask codex"),
        ],
        "cursor_cli" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://cursor.com/install | bash",
            ),
            m("npm", "npm", "npm install -g cursor-cli"),
        ],
        "kiro" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://cli.kiro.dev/install | bash",
            ),
            m(
                "appimage",
                "AppImage",
                "curl -L https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.appimage -o kiro-cli.appimage && chmod +x kiro-cli.appimage",
            ),
            m(
                "deb",
                ".deb",
                "wget https://desktop-release.q.us-east-1.amazonaws.com/latest/kiro-cli.deb && sudo dpkg -i kiro-cli.deb && sudo apt-get install -f",
            ),
            m(
                "zip-x64",
                "Linux x86-64",
                "curl --proto '=https' --tlsv1.2 -sSf 'https://desktop-release.q.us-east-1.amazonaws.com/latest/kirocli-x86_64-linux.zip' -o kirocli.zip && unzip kirocli.zip && ./kirocli/install.sh",
            ),
        ],
        "copilot" => vec![
            m("npm", "npm", "npm install -g @github/copilot"),
            m(
                "curl",
                "curl",
                "curl -fsSL https://gh.io/copilot-install | bash",
            ),
            m("homebrew", "Homebrew", "brew install copilot-cli"),
            m("winget", "WinGet", "winget install GitHub.Copilot"),
        ],
        "gemini_cli" => vec![
            m("npm", "npm", "npm install -g @google/gemini-cli"),
            m(
                "npx",
                "npx",
                "npx https://github.com/google-gemini/gemini-cli",
            ),
        ],
        "kimi_cli" => vec![
            m(
                "curl",
                "curl",
                "curl -LsSf https://code.kimi.com/install.sh | bash",
            ),
            m(
                "powershell",
                "PowerShell",
                "irm https://code.kimi.com/install.ps1 | iex",
            ),
            m("uv", "uv", "uv tool install --python 3.13 kimi-cli"),
        ],
        "opencode" => vec![
            m(
                "curl",
                "curl",
                "curl -fsSL https://opencode.ai/install | bash",
            ),
            m("npm", "npm", "npm install -g opencode-ai"),
            m("homebrew", "Homebrew", "brew install anomalyco/tap/opencode"),
        ],
        // The caller iterates `cli_agent_registry()` entries, so any
        // CLI agent that ships in the registry but has no install_methods
        // entry here would silently render the "Install" UI as a no-op.
        // Warn so a future registry addition surfaces in logs.
        other => {
            tracing::warn!(
                "[key_vault::registry] cli_install_methods has no entry for CLI agent {:?}; \
                 the Install UI will show no options",
                other
            );
            Vec::new()
        }
    }
}

pub(super) fn cli_uninstall_methods(name: &str) -> Vec<CliInstallMethod> {
    let m = |id: &str, label: &str, cmd: &str| CliInstallMethod {
        id: id.into(),
        label: label.into(),
        command: cmd.into(),
    };
    match name {
        "claude_code" => vec![
            m("native", "Native", "claude uninstall"),
            m("homebrew", "Homebrew", "brew uninstall --cask claude-code"),
            m("npm", "npm", "npm uninstall -g @anthropic-ai/claude-code"),
        ],
        "codex" => vec![
            m("npm", "npm", "npm uninstall -g @openai/codex"),
            m("homebrew", "Homebrew", "brew uninstall --cask codex"),
        ],
        "cursor_cli" => vec![
            m("npm", "npm", "npm uninstall -g cursor-cli"),
            m(
                "curl",
                "curl",
                "rm -rf ~/.local/bin/cursor ~/.local/share/cursor",
            ),
        ],
        "kiro" => vec![
            m("cli", "Native", "kiro-cli uninstall"),
            m("apt", "apt", "sudo apt-get remove kiro-cli"),
        ],
        "copilot" => vec![
            m("npm", "npm", "npm uninstall -g @github/copilot"),
            m("homebrew", "Homebrew", "brew uninstall copilot-cli"),
            m("winget", "WinGet", "winget uninstall GitHub.Copilot"),
        ],
        "gemini_cli" => vec![m("npm", "npm", "npm uninstall -g @google/gemini-cli")],
        "kimi_cli" => vec![m("uv", "uv", "uv tool uninstall kimi-cli")],
        "opencode" => vec![
            m("native", "Native", "opencode uninstall"),
            m("npm", "npm", "npm uninstall -g opencode-ai"),
            m(
                "homebrew",
                "Homebrew",
                "brew uninstall anomalyco/tap/opencode",
            ),
        ],
        // Same fail-loud principle as `cli_install_methods` above.
        other => {
            tracing::warn!(
                "[key_vault::registry] cli_uninstall_methods has no entry for CLI agent {:?}; \
                 the Uninstall UI will show no options",
                other
            );
            Vec::new()
        }
    }
}

pub(super) fn cli_env_config(name: &str) -> Option<AgentEnvConfig> {
    let cfg = |key_var: &str,
               base_var: Option<&str>,
               supports: bool,
               placeholder_key: &str,
               base_placeholder: Option<&str>| AgentEnvConfig {
        api_key_env_var: key_var.into(),
        base_url_env_var: base_var.map(String::from),
        supports_base_url: supports,
        api_key_placeholder_key: placeholder_key.into(),
        base_url_placeholder: base_placeholder.map(String::from),
    };
    match name {
        "cursor_cli" => Some(cfg(
            "CURSOR_API_KEY",
            None,
            false,
            "codeAccounts.apiKeyPlaceholder.cursor_cli",
            None,
        )),
        "claude_code" => Some(cfg(
            "ANTHROPIC_API_KEY",
            Some("ANTHROPIC_BASE_URL"),
            true,
            "codeAccounts.apiKeyPlaceholder.claude_code",
            Some("https://api.example.com"),
        )),
        "codex" => Some(cfg(
            "OPENAI_API_KEY",
            Some("OPENAI_BASE_URL"),
            true,
            "codeAccounts.apiKeyPlaceholder.codex",
            Some("https://api.example.com/v1"),
        )),
        "gemini_cli" => Some(cfg(
            "GEMINI_API_KEY",
            Some("GOOGLE_GEMINI_BASE_URL"),
            true,
            "codeAccounts.apiKeyPlaceholder.gemini_cli",
            Some("https://geminicode.net"),
        )),
        "copilot" => Some(cfg(
            "GH_TOKEN",
            None,
            false,
            "codeAccounts.apiKeyPlaceholder.copilot",
            None,
        )),
        "kiro" => Some(cfg(
            "KIRO_API_KEY",
            None,
            false,
            "codeAccounts.apiKeyPlaceholder.kiro",
            None,
        )),
        "kimi_cli" => Some(cfg(
            "MOONSHOT_API_KEY",
            Some("MOONSHOT_BASE_URL"),
            true,
            "codeAccounts.apiKeyPlaceholder.kimi_cli",
            Some("https://api.moonshot.cn/v1"),
        )),
        "opencode" => Some(cfg(
            "OPENCODE_API_KEY",
            None,
            false,
            "codeAccounts.apiKeyPlaceholder.opencode",
            None,
        )),
        // The caller iterates `cli_agent_registry()` entries, so a CLI
        // agent that ships in the registry but has no env config here
        // would silently let the API-key dialog render with no env-var
        // hint. Warn so a future registry addition surfaces in logs.
        other => {
            tracing::warn!(
                "[key_vault::registry] cli_env_config has no entry for CLI agent {:?}; \
                 the API-key dialog will render without an env-var hint",
                other
            );
            None
        }
    }
}

// ============================================
// Install method inference
// ============================================

/// Infer install method from the binary path returned by `which`/`where`.
///
/// Resolves symlinks first so that e.g. `~/.local/bin/poetry` →
/// `~/.local/pipx/venvs/poetry/bin/poetry` is detected as pip, while
/// `~/.local/bin/cursor` (a plain shell script from a curl installer) is
/// detected as curl.
pub(crate) fn infer_install_method(binary_path: &str) -> Option<String> {
    let resolved = std::fs::canonicalize(binary_path)
        .ok()
        .and_then(|p| p.to_str().map(String::from));
    let resolved_lower = resolved.as_deref().map(|s| s.to_lowercase());
    let original_lower = binary_path.to_lowercase();

    let either_contains = |pattern: &str| -> bool {
        original_lower.contains(pattern)
            || resolved_lower
                .as_deref()
                .is_some_and(|r| r.contains(pattern))
    };

    #[cfg(not(windows))]
    {
        if either_contains("/homebrew/")
            || either_contains("/cellar/")
            || either_contains("/linuxbrew/")
        {
            return Some("homebrew".into());
        }
        if either_contains("/node_modules/")
            || either_contains("/lib/node_modules/")
            || either_contains("/.nvm/")
            || either_contains("/.fnm/")
            || either_contains("/.volta/")
        {
            return Some("npm".into());
        }
        if either_contains("/.cargo/bin/") {
            return Some("cargo".into());
        }
        if either_contains("/snap/bin/") || either_contains("/snap/") {
            return Some("snap".into());
        }
        if either_contains("/pipx/")
            || either_contains("/pyenv/")
            || either_contains("/.pyenv/")
            || either_contains("/library/python/")
            || either_contains("/lib/python")
        {
            return Some("pip".into());
        }
        if either_contains("/.local/bin/") {
            return Some("curl".into());
        }
        if original_lower.starts_with("/usr/local/bin/") || original_lower.starts_with("/usr/bin/")
        {
            return Some("curl".into());
        }
    }

    #[cfg(windows)]
    {
        if either_contains(r"\node_modules\")
            || either_contains(r"\npm\")
            || either_contains(r"\nvm\")
            || either_contains(r"\fnm\")
            || either_contains(r"\volta\")
        {
            return Some("npm".into());
        }
        if either_contains(r"\scoop\") {
            return Some("scoop".into());
        }
        if either_contains(r"\cargo\bin\") {
            return Some("cargo".into());
        }
        if either_contains(r"\pipx\") || either_contains(r"\python") || either_contains(r"\pyenv\")
        {
            return Some("pip".into());
        }
        if either_contains(r"\program files") || either_contains(r"\appdata\local\programs") {
            return Some("native".into());
        }
    }

    None
}
