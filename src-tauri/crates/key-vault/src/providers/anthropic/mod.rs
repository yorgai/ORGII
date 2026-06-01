//! Anthropic API Key Validation
//!
//! Validates Anthropic API keys and fetches available models.
//!
//! Supported token formats:
//! - `sk-ant-*` - Standard Anthropic API key
//! - `sk_*` - Alternative format
//!
//! Proxy support:
//! When a custom base_url is provided (proxy mode), the validator first tries
//! GET /v1/models to auto-detect models. If that fails (many proxies don't
//! implement /v1/models), it falls back to a lightweight POST /v1/messages
//! call using a `test_model` name (from the user's manual model mapping).
//! This validates the API key without requiring /v1/models support.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, info, warn};

use crate::types::ValidationResult;

const DEFAULT_API_URL: &str = "https://api.anthropic.com";
const DEFAULT_TIMEOUT_SECS: u64 = 10;
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

/// Minimal messages request for proxy fallback validation
#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

/// Anthropic credential validator
pub struct AnthropicValidator {
    client: Client,
    timeout: Duration,
}

impl AnthropicValidator {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        }
    }

    pub fn with_timeout(timeout_secs: u64) -> Self {
        Self {
            client: Client::new(),
            timeout: Duration::from_secs(timeout_secs),
        }
    }

    /// Validate an Anthropic API key
    ///
    /// # Arguments
    /// * `api_key` - The API key to validate
    /// * `base_url` - Optional custom base URL (for proxies)
    /// * `test_model` - Optional model name to test with (from user's manual model mapping).
    ///   Used as fallback when /v1/models is not supported by the proxy.
    pub async fn validate(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        test_model: Option<&str>,
    ) -> ValidationResult {
        let key_preview = if api_key.len() > 12 {
            format!("{}...{}", &api_key[..8], &api_key[api_key.len() - 4..])
        } else {
            api_key.to_string()
        };
        debug!(
            "[Anthropic] Validating key: {}, base_url: {:?}, test_model: {:?}",
            key_preview,
            base_url.unwrap_or("(official)"),
            test_model.unwrap_or("(none)")
        );

        // Format validation
        if api_key.is_empty() {
            warn!("[Anthropic] Empty API key");
            return ValidationResult::failure("No API key provided");
        }

        // Skip format check if custom base_url is provided (proxy mode)
        if base_url.is_none() && !api_key.starts_with("sk-ant-") && !api_key.starts_with("sk_") {
            warn!("[Anthropic] Invalid key format: {}", key_preview);
            return ValidationResult::failure("Anthropic key should start with 'sk-ant-' or 'sk_'");
        }

        // Get available models — auth and model discovery are decoupled:
        // 401 = key invalid, other failures = key may work, user can add models manually.
        match self.get_models(api_key, base_url).await {
            Ok(models) => {
                if models.is_empty() {
                    warn!("[Anthropic] No models returned for key: {}", key_preview);
                    let mut result = ValidationResult::success(
                        "API key valid (no models auto-detected — add models manually)",
                    );
                    result.is_degraded = true;
                    result
                } else if base_url.is_some() {
                    // Proxy mode: /v1/models may be public, verify auth with
                    // a lightweight /v1/messages call using the first model.
                    let probe_model = test_model.unwrap_or(&models[0]);
                    debug!(
                        "[Anthropic] Proxy mode — verifying auth via /v1/messages with model: {}",
                        probe_model
                    );
                    match self.test_messages(api_key, base_url, probe_model).await {
                        Ok(()) => {
                            info!(
                                "[Anthropic] ✅ Valid! {} models available: {:?}",
                                models.len(),
                                &models[..models.len().min(3)]
                            );
                            ValidationResult::success("API key valid").with_models(models)
                        }
                        Err(e) if e == "Invalid API key" => {
                            warn!("[Anthropic] Proxy auth verification failed: {}", e);
                            ValidationResult::failure("Invalid API key")
                        }
                        Err(_) => {
                            // Non-auth error — key might still work
                            info!(
                                "[Anthropic] Auth probe inconclusive, accepting with {} models",
                                models.len()
                            );
                            let mut result =
                                ValidationResult::success("API key valid").with_models(models);
                            result.is_degraded = true;
                            result
                        }
                    }
                } else {
                    // Official API: /v1/models already validates auth
                    info!(
                        "[Anthropic] ✅ Valid! {} models available: {:?}",
                        models.len(),
                        &models[..models.len().min(3)]
                    );
                    ValidationResult::success("API key valid").with_models(models)
                }
            }
            Err(models_err) if models_err == "Invalid API key" => {
                warn!("[Anthropic] Auth failed: {}", models_err);
                ValidationResult::failure("Invalid API key")
            }
            Err(models_err) if models_err.starts_with("Request failed:") => {
                warn!("[Anthropic] Cannot reach endpoint: {}", models_err);
                ValidationResult::failure(&format!("Cannot reach endpoint: {}", models_err))
            }
            Err(models_err) => {
                // /v1/models returned non-401 error (404, 405, etc.)
                // Try messages fallback if we have proxy + test_model
                if base_url.is_some() {
                    if let Some(model) = test_model {
                        debug!(
                            "[Anthropic] /v1/models failed ({}), trying /v1/messages fallback with model: {}",
                            models_err, model
                        );
                        match self.test_messages(api_key, base_url, model).await {
                            Ok(()) => {
                                debug!(
                                    "[Anthropic] Messages fallback succeeded for key: {}",
                                    key_preview
                                );
                                ValidationResult::success("API key valid (proxy)")
                            }
                            Err(msg_err) if msg_err == "Invalid API key" => {
                                warn!("[Anthropic] Messages fallback auth failed: {}", msg_err);
                                ValidationResult::failure("Invalid API key")
                            }
                            Err(_msg_err) => {
                                // Messages also failed but not auth — key might still work
                                let mut result = ValidationResult::success(
                                    "API key accepted (model listing not available — add models manually)",
                                );
                                result.is_degraded = true;
                                result
                            }
                        }
                    } else {
                        // Proxy but no test_model — accept key, let user add models manually
                        debug!(
                            "[Anthropic] /v1/models failed on proxy ({}), accepting key as degraded",
                            models_err
                        );
                        let mut result = ValidationResult::success(
                            "API key accepted (model listing not available — add models manually)",
                        );
                        result.is_degraded = true;
                        result
                    }
                } else {
                    // Official API — non-auth error is unusual, still accept as degraded
                    warn!(
                        "[Anthropic] /v1/models failed ({}), accepting as degraded",
                        models_err
                    );
                    let mut result = ValidationResult::success(
                        "API key accepted (model listing not available — add models manually)",
                    );
                    result.is_degraded = true;
                    result
                }
            }
        }
    }

    /// Get list of Anthropic models from API
    async fn get_models(
        &self,
        api_key: &str,
        base_url: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let url = base_url.unwrap_or(DEFAULT_API_URL);
        let endpoint = format!("{}/v1/models", url);
        debug!("[Anthropic] Fetching models from: {}", endpoint);

        let response = self
            .client
            .get(&endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if response.status() == 401 {
            return Err("Invalid API key".to_string());
        }

        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status().as_u16()));
        }

        let data: ModelsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let models: Vec<String> = data.data.into_iter().map(|m| m.id).collect();

        Ok(models)
    }

    /// Test the API key by sending a minimal messages request.
    /// Used as fallback when /v1/models is not supported (common with proxies).
    /// Sends max_tokens=1 to minimize cost — we only care whether the key is accepted.
    pub async fn test_messages(
        &self,
        api_key: &str,
        base_url: Option<&str>,
        model: &str,
    ) -> Result<(), String> {
        let url = base_url.unwrap_or(DEFAULT_API_URL);
        let endpoint = format!("{}/v1/messages", url);
        debug!(
            "[Anthropic] Testing messages endpoint: {} with model: {}",
            endpoint, model
        );

        let body = MessagesRequest {
            model: model.to_string(),
            max_tokens: 1,
            messages: vec![Message {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
        };

        let response = self
            .client
            .post(&endpoint)
            .header("x-api-key", api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();

        if status == 401 {
            return Err("Invalid API key".to_string());
        }

        // 200 = success, but also treat other "not auth failure" codes as partial success:
        // - 400 = bad request (model may be wrong, but key is valid)
        // - 429 = rate limited (key is valid, just throttled)
        // - 404 = model not found on this proxy (key may be valid)
        if status.is_success() || status.as_u16() == 429 {
            return Ok(());
        }

        // Read body for better error messages. A body-read failure
        // here is itself diagnostic — preserve it in the debug log
        // and the returned error so the user sees "HTTP 502 (body
        // read failed: ...)" instead of a bare "HTTP 502" with no
        // hint that the response body was unreachable.
        let body_text = match response.text().await {
            Ok(t) => t,
            Err(err) => format!("(body read failed: {})", err),
        };
        if !body_text.is_empty() {
            debug!("[Anthropic] Messages response body: {}", body_text);
        }

        Err(format!("HTTP {}", status.as_u16()))
    }

    /// Validate token format without making API calls
    pub fn validate_format(&self, api_key: &str) -> (bool, String) {
        if api_key.is_empty() {
            return (false, "API key is required".to_string());
        }

        if api_key.len() < 10 {
            return (false, "API key is too short".to_string());
        }

        if !api_key.starts_with("sk-ant-") && !api_key.starts_with("sk_") {
            return (
                false,
                "Anthropic key should start with 'sk-ant-' or 'sk_'".to_string(),
            );
        }

        (true, "Format OK".to_string())
    }
}

impl Default for AnthropicValidator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "../tests/anthropic_tests.rs"]
mod tests;
