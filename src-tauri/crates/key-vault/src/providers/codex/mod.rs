//! Codex CLI credential validation.
//!
//! Validates Codex credentials supporting:
//! - OAuth authentication (ChatGPT Plus/Pro subscription via chatgpt.com)
//! - API key authentication (OpenAI API key via api.openai.com)
//! - Quota fetching from ChatGPT usage API

use crate::providers::openai::OpenAIValidator;
use crate::types::{QuotaInfo, UsageItem, ValidationResult};
use serde::Deserialize;

/// ChatGPT usage API endpoint
const USAGE_API_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_MODELS_API_URL: &str = "https://chatgpt.com/backend-api/codex/models";
const CODEX_MODELS_CLIENT_VERSION: &str = "0.124.0";
const CODEX_USER_AGENT: &str = "codex_cli_rs/0.124.0 (orgii, cli)";

#[derive(Debug, Deserialize)]
struct CodexModelsResponse {
    #[serde(default)]
    models: Vec<CodexModelInfo>,
}

#[derive(Debug, Deserialize)]
struct CodexModelInfo {
    slug: String,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    supported_in_api: Option<bool>,
}

/// Codex CLI validator
pub struct CodexValidator {
    timeout: std::time::Duration,
}

impl CodexValidator {
    pub fn new() -> Self {
        Self {
            timeout: std::time::Duration::from_secs(10),
        }
    }

    /// Validate Codex credential (OAuth or API key)
    ///
    /// If session_token (OAuth) is provided, validates against ChatGPT API.
    /// Otherwise falls back to OpenAI API key validation.
    pub async fn validate(
        &self,
        api_key: &str,
        session_token: Option<&str>,
        base_url: Option<&str>,
    ) -> ValidationResult {
        // OAuth takes priority if session_token is provided
        if let Some(token) = session_token {
            if !token.is_empty() {
                return self.validate_oauth(token).await;
            }
        }

        // Fall back to OpenAI API key validation
        if !api_key.is_empty() {
            let openai = OpenAIValidator::new();
            return openai
                .validate(api_key, base_url, Some("openai_api"), None)
                .await;
        }

        ValidationResult::failure("No API key or OAuth token provided")
    }

    /// Validate OAuth token against ChatGPT usage API
    ///
    /// Codex OAuth tokens (from `codex auth login`) work with chatgpt.com,
    /// not api.openai.com. The token is a JWT from OpenAI's Auth0.
    pub async fn validate_oauth(&self, access_token: &str) -> ValidationResult {
        let client = reqwest::Client::new();
        let response = client
            .get(USAGE_API_URL)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Accept", "application/json")
            .timeout(self.timeout)
            .send()
            .await;

        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let mut result = self.parse_usage_response(resp).await;
                    if result.valid {
                        match self.list_models(access_token, None).await {
                            Ok(models) if !models.is_empty() => {
                                result = result.with_models(models);
                            }
                            Ok(_) => {}
                            Err(err) => {
                                log::warn!("[CodexValidation] Model discovery failed: {}", err);
                            }
                        }
                    }
                    result
                } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED
                    || resp.status() == reqwest::StatusCode::FORBIDDEN
                {
                    ValidationResult::failure(
                        "OAuth token expired - please run 'codex auth login' again",
                    )
                } else {
                    ValidationResult::success("Codex CLI session (validation skipped)")
                }
            }
            Err(err) => {
                log::warn!("[CodexValidation] Usage API request failed: {}", err);
                ValidationResult::failure(&format!("Could not reach Codex usage API: {}", err))
            }
        }
    }

    /// Fetch the account-visible Codex model list from ChatGPT's Codex backend.
    ///
    /// This mirrors Codex CLI's `/models?client_version=...` discovery path.
    /// `id_token` is optional for older/local credentials, but when present we
    /// extract the ChatGPT account id and send it so multi-account sessions are
    /// scoped the same way runtime Codex requests are scoped.
    pub async fn list_models(
        &self,
        access_token: &str,
        id_token: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let token = access_token.trim();
        if token.is_empty() {
            return Err("Codex OAuth access token is empty".to_string());
        }

        let mut request = reqwest::Client::new()
            .get(CODEX_MODELS_API_URL)
            .query(&[("client_version", CODEX_MODELS_CLIENT_VERSION)])
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", CODEX_USER_AGENT)
            .header("originator", "codex_cli_rs")
            .header("Accept", "application/json")
            .timeout(self.timeout);

        if let Some(account_id) = id_token.and_then(extract_account_id_from_id_token) {
            request = request.header("ChatGPT-Account-ID", account_id);
        }

        let response = request
            .send()
            .await
            .map_err(|err| format!("Codex OAuth model discovery request failed: {err}"))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| format!("Codex OAuth model discovery body read failed: {err}"))?;

        if !status.is_success() {
            return Err(format!(
                "Codex OAuth model discovery failed: HTTP {}: {}",
                status.as_u16(),
                body
            ));
        }

        parse_codex_models_response(&body)
    }

    /// Parse ChatGPT usage API response
    async fn parse_usage_response(&self, resp: reqwest::Response) -> ValidationResult {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            let plan_type = data
                .get("plan_type")
                .and_then(|p| p.as_str())
                .unwrap_or("plus");

            // Try to extract quota info
            let quota_info = self.extract_quota_info(&data);

            let mut result =
                ValidationResult::success(&format!("Valid Codex session ({})", plan_type));

            if let Some(quota) = quota_info {
                result = result.with_quota(quota);
            }

            result
        } else {
            ValidationResult::failure("Failed to parse Codex usage API response")
        }
    }

    /// Extract quota information from ChatGPT usage API response
    ///
    /// API returns:
    /// ```json
    /// {
    ///   "rate_limit": {
    ///     "primary_window": { "used_percent": 0, "reset_at": 1234567890 },
    ///     "secondary_window": { "used_percent": 0, "reset_at": 1234567890 },
    ///     "limit_reached": false
    ///   },
    ///   "plan_type": "plus"
    /// }
    /// ```
    fn extract_quota_info(&self, data: &serde_json::Value) -> Option<QuotaInfo> {
        let rate_limit = data.get("rate_limit")?;

        let primary_window = rate_limit.get("primary_window");
        let secondary_window = rate_limit.get("secondary_window");

        // Get usage percentages (used_percent is 0-100)
        let session_usage = primary_window
            .and_then(|w| w.get("used_percent"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        let weekly_usage = secondary_window
            .and_then(|w| w.get("used_percent"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // Get reset time from primary window
        let reset_time = primary_window
            .and_then(|w| w.get("reset_at"))
            .and_then(|v| {
                if let Some(ts) = v.as_i64() {
                    // Convert Unix timestamp to ISO string
                    use chrono::{DateTime, Utc};
                    DateTime::from_timestamp(ts, 0).map(|dt: DateTime<Utc>| dt.to_rfc3339())
                } else {
                    v.as_str().map(|s| s.to_string())
                }
            });

        let plan_type = data
            .get("plan_type")
            .and_then(|v| v.as_str())
            .unwrap_or("plus")
            .to_lowercase();

        // Build usage items
        let mut usage_items = Vec::new();

        // Session usage (3-hour window)
        let mut session_item = UsageItem::new("session");
        session_item.enabled = true;
        session_item.used = Some(session_usage as i64);
        session_item.limit = Some(100);
        session_item.remaining = Some((100.0 - session_usage) as i64);
        session_item.remaining_percentage = 100.0 - session_usage;
        usage_items.push(session_item);

        // Weekly usage
        let mut weekly_item = UsageItem::new("weekly");
        weekly_item.enabled = true;
        weekly_item.used = Some(weekly_usage as i64);
        weekly_item.limit = Some(100);
        weekly_item.remaining = Some((100.0 - weekly_usage) as i64);
        weekly_item.remaining_percentage = 100.0 - weekly_usage;
        usage_items.push(weekly_item);

        // Overall remaining is the minimum of session and weekly remaining
        let remaining_pct = 100.0 - session_usage.max(weekly_usage);

        Some(QuotaInfo {
            remaining_percentage: remaining_pct,
            used: Some(session_usage.max(weekly_usage) as i64),
            limit: Some(100),
            remaining: Some(remaining_pct as i64),
            reset_time,
            plan_type: Some(plan_type),
            is_unlimited: false,
            usage_items,
            ..Default::default()
        })
    }

    /// Validate token format (fast check, no API call)
    pub fn validate_format(&self, token: &str) -> (bool, String) {
        if token.is_empty() {
            return (false, "Token is empty".to_string());
        }

        // Codex OAuth tokens are JWTs (start with "eyJ")
        if token.starts_with("eyJ") {
            return (true, "Valid JWT format".to_string());
        }

        // OpenAI API keys start with "sk-"
        if token.starts_with("sk-") {
            return (true, "Valid OpenAI API key format".to_string());
        }

        (false, "Unknown token format".to_string())
    }
}

fn extract_account_id_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    value
        .get("https://api.openai.com/auth.chatgpt_account_id")
        .or_else(|| value.get("chatgpt_account_id"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
}

fn parse_codex_models_response(body: &str) -> Result<Vec<String>, String> {
    let parsed: CodexModelsResponse = serde_json::from_str(body)
        .map_err(|err| format!("Codex OAuth model discovery parse failed: {err}"))?;
    let mut models = Vec::new();
    for model in parsed.models {
        if model.slug.is_empty() {
            continue;
        }
        if model.visibility.as_deref() == Some("hidden") {
            continue;
        }
        if model.supported_in_api == Some(false) {
            continue;
        }
        if !models.contains(&model.slug) {
            models.push(model.slug);
        }
    }
    Ok(models)
}

impl Default for CodexValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "../tests/codex_tests.rs"]
mod tests;

#[cfg(test)]
mod model_discovery_tests {
    use super::*;

    #[test]
    fn codex_models_response_parses_filters_and_deduplicates() {
        let models = parse_codex_models_response(
            r#"{
                "models": [
                    { "slug": "gpt-5.5", "visibility": "list", "supported_in_api": true },
                    { "slug": "gpt-5.2-codex", "visibility": "list", "supported_in_api": true },
                    { "slug": "gpt-5.2-codex", "visibility": "list", "supported_in_api": true },
                    { "slug": "hidden-model", "visibility": "hidden", "supported_in_api": true },
                    { "slug": "unsupported", "visibility": "list", "supported_in_api": false },
                    { "slug": "" }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            models,
            vec!["gpt-5.5".to_string(), "gpt-5.2-codex".to_string()]
        );
    }

    #[test]
    fn codex_models_response_rejects_invalid_json() {
        let err = parse_codex_models_response("not json").unwrap_err();
        assert!(err.contains("parse failed"));
    }
}
