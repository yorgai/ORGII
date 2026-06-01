use super::registry::ProviderSpec;

const CONTEXT_WINDOW_HINTS: &[(&str, usize)] = &[
    ("claude-opus-4", 200_000),
    ("claude-sonnet-4", 200_000),
    ("claude-haiku-4", 200_000),
    ("claude-3-7", 200_000),
    ("claude-3-5", 200_000),
    ("claude-3-opus", 200_000),
    ("claude-3-haiku", 200_000),
    ("claude", 200_000),
    ("gpt-5", 1_000_000),
    ("gpt-4.1", 1_000_000),
    ("o3", 200_000),
    ("o4", 200_000),
    ("o1", 200_000),
    ("gpt-4o", 128_000),
    ("gpt-4-turbo", 128_000),
    ("gpt-4", 128_000),
    ("gemini-2", 1_000_000),
    ("gemini-1.5", 1_000_000),
    ("gemini", 1_000_000),
    ("deepseek-r1", 128_000),
    ("deepseek-v3", 128_000),
    ("deepseek-coder", 128_000),
    ("deepseek-chat", 64_000),
    ("deepseek", 64_000),
    ("qwen-max", 128_000),
    ("qwen-plus", 128_000),
    ("qwen-turbo", 128_000),
    ("qwen", 32_000),
    ("kimi", 256_000),
    ("moonshot-v1-128k", 128_000),
    ("moonshot-v1-32k", 32_000),
    ("moonshot-v1-8k", 8_000),
    ("moonshot", 128_000),
    ("glm-4", 128_000),
    ("glm", 32_000),
    ("llama-4", 128_000),
    ("llama-3.3", 128_000),
    ("llama-3.1", 128_000),
    ("llama-3", 8_000),
    ("llama", 8_000),
    ("mixtral-8x22b", 65_000),
    ("mixtral", 32_000),
];

pub(crate) const DEFAULT_CONTEXT_WINDOW_HINT: usize = 128_000;

pub fn context_window_hint(model: &str) -> usize {
    let normalized = normalize_claude_shorthand(model);
    let model_lower = normalized.to_lowercase();
    for (pattern, window) in CONTEXT_WINDOW_HINTS {
        if model_lower.contains(pattern) {
            return *window;
        }
    }
    DEFAULT_CONTEXT_WINDOW_HINT
}

pub fn wire_model_name(spec: &ProviderSpec, model: &str) -> String {
    let stripped = {
        let mut result = model;
        for prefix in spec.skip_prefixes {
            if let Some(rest) = model.strip_prefix(prefix) {
                result = rest;
                break;
            }
        }
        result
    };

    let normalized = normalize_claude_shorthand(stripped);

    if let Some(prefix) = spec.litellm_prefix {
        if normalized.starts_with(prefix) {
            return normalized;
        }
        return format!("{}{}", prefix, normalized);
    }

    normalized
}

pub fn normalize_claude_shorthand(model: &str) -> String {
    if model.starts_with("claude-") {
        return model.to_string();
    }
    const CLAUDE_FAMILIES: &[&str] = &["sonnet-", "haiku-", "opus-"];
    for family in CLAUDE_FAMILIES {
        if model.starts_with(family) {
            return format!("claude-{}", model);
        }
    }
    model.to_string()
}

pub fn fast_model_hint(parent_model: &str) -> String {
    let lower = parent_model.to_lowercase();
    if lower.contains("claude")
        || lower.contains("anthropic")
        || lower.contains("sonnet")
        || lower.contains("haiku")
        || lower.contains("opus")
    {
        "anthropic/claude-3-5-haiku-20241022".to_string()
    } else if lower.contains("gpt-4") || lower.contains("openai") {
        "openai/gpt-4o-mini".to_string()
    } else if lower.contains("gemini") {
        "gemini/gemini-2.0-flash".to_string()
    } else if lower.contains("deepseek") {
        "deepseek/deepseek-chat".to_string()
    } else {
        parent_model.to_string()
    }
}
