//! Shared HTTP request setup for Anthropic Messages API.
//!
//! Both the streaming and non-streaming paths construct exactly the same
//! `MessagesRequest` and use the same auth/header conventions; the only
//! difference is the `stream: bool` flag and what they do with the response
//! body. Centralizing the construction here keeps the two paths from
//! drifting on protocol details (anthropic-version, prompt-caching beta,
//! Azure Bearer vs x-api-key auth, extra header pass-through).

use serde_json::{json, Value};

use super::client::{AnthropicAuthMode, AnthropicClient};
use super::messages::extract_system;
use super::thinking::build_thinking_params;
use super::tools::convert_tools;
use super::types::MessagesRequest;
/// All inputs to a Messages API request, post-resolution.
///
/// The caller has already resolved the model alias and run the messages
/// through `extract_system` — this struct just bundles the result so the
/// streaming/non-streaming entry points can hand it to the request builder
/// without re-doing the same extraction.
pub(super) struct PreparedRequest {
    pub url: String,
    pub body: MessagesRequest,
    pub resolved_model: String,
}

/// Build the request body and resolve the URL/model for a chat call.
///
/// `stream` is the only thing that differs between the two paths — the
/// thinking/temperature/max_tokens triad is computed identically.
pub(super) fn prepare_request(
    client: &AnthropicClient,
    messages: &[Value],
    tools: Option<&[Value]>,
    model: &str,
    max_tokens: u32,
    temperature: f32,
    stream: bool,
) -> PreparedRequest {
    let resolved_model =
        crate::providers::model_hints::wire_model_name(client.provider_spec, model);
    let (system, anthropic_messages) = extract_system(messages);

    // Extract tool_choice override (from side_query structured output)
    // before converting tools to Anthropic format.
    let (tool_choice_override, clean_tools) = if let Some(t) = tools {
        let (ovr, cleaned) = crate::core::side_query::extract_tool_choice_override(t);
        (ovr, Some(cleaned))
    } else {
        (None, None)
    };
    let anthropic_tools = clean_tools.as_deref().map(convert_tools);

    let caps = crate::providers::model_capabilities::resolve(&resolved_model, None);
    let directive = if tool_choice_override.is_some() || clean_tools.is_some() {
        // When tools are present (including structured output), use Auto
        // directive — we want the model to respond, not suppress thinking.
        crate::providers::anthropic_native::thinking::ThinkingDirective::Auto
    } else {
        // Plain side queries: suppress thinking when possible.
        crate::providers::anthropic_native::thinking::ThinkingDirective::PlainText
    };
    let (thinking, effective_temp, effective_max_tokens) =
        build_thinking_params(&caps, directive, max_tokens, temperature);

    let tool_choice = if let Some(ovr) = tool_choice_override {
        // Forced tool_choice from structured output
        Some(ovr)
    } else if clean_tools.is_some() {
        Some(json!({"type": "auto"}))
    } else {
        None
    };

    let body = MessagesRequest {
        model: resolved_model.clone(),
        max_tokens: effective_max_tokens,
        system: claude_oauth_system(system, client.auth_mode),
        messages: anthropic_messages,
        tools: anthropic_tools,
        tool_choice,
        temperature: effective_temp,
        stream,
        thinking,
        metadata: claude_oauth_metadata(client.auth_mode),
    };

    PreparedRequest {
        url: client.messages_url(),
        body,
        resolved_model,
    }
}

const PROMPT_CACHING_BETA: &str = "prompt-caching-2024-07-31";
const CLAUDE_OAUTH_BETA: &str = "oauth-2025-04-20";
const CLAUDE_OAUTH_USER_AGENT: &str = "claude-cli/2.1.78 (orgii, cli)";

fn claude_oauth_metadata(auth_mode: AnthropicAuthMode) -> Option<Value> {
    if auth_mode != AnthropicAuthMode::ClaudeOauth {
        return None;
    }

    let device_id = uuid::Uuid::new_v4().simple().to_string().repeat(2);
    let session_id = uuid::Uuid::new_v4().to_string();
    Some(json!({
        "user_id": json!({
            "device_id": device_id,
            "account_uuid": "",
            "session_id": session_id,
        })
        .to_string()
    }))
}

fn claude_oauth_system(system: Option<Value>, auth_mode: AnthropicAuthMode) -> Option<Value> {
    if auth_mode != AnthropicAuthMode::ClaudeOauth {
        return system;
    }

    let identity_block = json!({
        "type": "text",
        "text": "You are Claude Code, Anthropic's official CLI for Claude."
    });

    match system {
        Some(Value::Array(mut entries)) => {
            entries.insert(0, identity_block);
            Some(Value::Array(entries))
        }
        Some(existing) => Some(Value::Array(vec![identity_block, existing])),
        None => Some(Value::Array(vec![identity_block])),
    }
}

/// Apply the Anthropic-specific auth + header set to a `RequestBuilder`.
///
/// Direct Anthropic API keys use `x-api-key`; Azure AI Foundry and Claude
/// OAuth use Bearer auth but are separate modes because they require different
/// beta/header sets.
pub(super) fn apply_headers(
    client: &AnthropicClient,
    builder: reqwest::RequestBuilder,
) -> reqwest::RequestBuilder {
    let mut req = builder
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json");

    req = match client.auth_mode {
        AnthropicAuthMode::ApiKey => req
            .header("x-api-key", &client.config.api_key)
            .header("anthropic-beta", PROMPT_CACHING_BETA),
        AnthropicAuthMode::AzureBearer => req
            .header(
                "Authorization",
                format!("Bearer {}", &client.config.api_key),
            )
            .header("anthropic-beta", PROMPT_CACHING_BETA),
        AnthropicAuthMode::ClaudeOauth => {
            let token = client
                .current_access_token()
                .unwrap_or_else(|_| client.config.api_key.clone());
            req.header("Authorization", format!("Bearer {}", token))
                .header("anthropic-beta", CLAUDE_OAUTH_BETA)
                .header("accept-encoding", "identity")
                .header("User-Agent", CLAUDE_OAUTH_USER_AGENT)
                .header("x-app", "cli")
        }
    };

    for (key, value) in &client.config.extra_headers {
        req = req.header(key, value);
    }
    req
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_oauth_metadata_matches_claude_code_shape() {
        let metadata = claude_oauth_metadata(AnthropicAuthMode::ClaudeOauth)
            .expect("Claude OAuth requests include metadata");
        let user_id = metadata["user_id"]
            .as_str()
            .expect("user_id is JSON string");
        let parsed: Value = serde_json::from_str(user_id).expect("user_id parses as JSON");

        assert_eq!(parsed["device_id"].as_str().unwrap().len(), 64);
        assert_eq!(parsed["account_uuid"], "");
        assert!(uuid::Uuid::parse_str(parsed["session_id"].as_str().unwrap()).is_ok());
    }

    #[test]
    fn api_key_requests_do_not_include_claude_oauth_metadata() {
        assert!(claude_oauth_metadata(AnthropicAuthMode::ApiKey).is_none());
    }

    #[test]
    fn claude_oauth_system_prepends_identity_without_dropping_existing_blocks() {
        let original = json!([
            {
                "type": "text",
                "text": "ORGII system prompt",
                "cache_control": { "type": "ephemeral" }
            }
        ]);

        let system = claude_oauth_system(Some(original), AnthropicAuthMode::ClaudeOauth)
            .expect("Claude OAuth requests always include system");
        let entries = system.as_array().expect("system remains an array");

        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0]["text"],
            "You are Claude Code, Anthropic's official CLI for Claude."
        );
        assert!(entries[0].get("cache_control").is_none());
        assert_eq!(entries[1]["text"], "ORGII system prompt");
        assert_eq!(entries[1]["cache_control"]["type"], "ephemeral");
    }

    #[test]
    fn api_key_system_is_not_rewritten() {
        let original = json!([{ "type": "text", "text": "ORGII system prompt" }]);
        let system = claude_oauth_system(Some(original.clone()), AnthropicAuthMode::ApiKey);

        assert_eq!(system, Some(original));
    }

    #[test]
    fn claude_oauth_user_agent_uses_claude_cli_semver_shape() {
        assert!(CLAUDE_OAUTH_USER_AGENT.starts_with("claude-cli/"));
        let version = CLAUDE_OAUTH_USER_AGENT
            .strip_prefix("claude-cli/")
            .unwrap()
            .split(' ')
            .next()
            .unwrap();
        let parts: Vec<&str> = version.split('.').collect();
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|part| part.parse::<u64>().is_ok()));
    }
}
