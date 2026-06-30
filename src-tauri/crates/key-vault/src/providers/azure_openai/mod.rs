//! Azure OpenAI API Key Validation
//!
//! Validates Azure OpenAI API keys against the user's Azure endpoint.
//! Azure uses `api-key` header (not Bearer) and requires a base URL.

use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

use crate::types::ValidationResult;

const DEFAULT_TIMEOUT_SECS: u64 = 15;
const AZURE_API_VERSION: &str = "2024-12-01-preview";

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Option<Vec<ModelInfo>>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
    #[serde(default)]
    context_length: Option<u64>,
}

pub struct AzureOpenAIValidator {
    client: Client,
    timeout: Duration,
}

impl AzureOpenAIValidator {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        }
    }

    pub async fn validate(&self, api_key: &str, base_url: Option<&str>) -> ValidationResult {
        if api_key.is_empty() {
            return ValidationResult::failure("No API key provided");
        }

        let Some(base_url) = base_url else {
            return ValidationResult::failure(
                "Azure endpoint URL is required. Enter it in the Base URL field.",
            );
        };

        let base_url = base_url.trim_end_matches('/');

        // Try listing models via the OpenAI-compatible models endpoint
        match self.get_models(api_key, base_url).await {
            Ok((models, contexts)) => {
                if models.is_empty() {
                    // Models endpoint worked but returned empty — key is valid
                    ValidationResult::success(
                        "API key valid (no models listed — specify model names manually)",
                    )
                } else {
                    ValidationResult::success("API key valid")
                        .with_models(models)
                        .with_contexts(contexts)
                }
            }
            Err(err) => {
                // Models listing failed — try a lightweight probe to distinguish
                // auth failure from "endpoint doesn't support /models"
                if err.contains("401") || err.contains("403") || err.contains("Invalid") {
                    ValidationResult::failure(&format!("Authentication failed: {}", err))
                } else {
                    // Endpoint might not support /models but key could still be valid.
                    // Return success with a note that models should be specified manually.
                    ValidationResult::success(
                        "Connected to Azure endpoint (model listing not available — specify model names manually)",
                    )
                }
            }
        }
    }

    async fn get_models(
        &self,
        api_key: &str,
        base_url: &str,
    ) -> Result<(Vec<String>, HashMap<String, u64>), String> {
        // Try two URL variants:
        // 1. Traditional Azure: {base}/models?api-version=...
        // 2. AI Foundry / plain OpenAI-compat: {base}/models (no api-version)
        let urls = [
            format!("{}/models?api-version={}", base_url, AZURE_API_VERSION),
            format!("{}/models", base_url),
        ];

        let mut last_err = String::new();
        for endpoint in &urls {
            match self.try_get_models(api_key, endpoint).await {
                Ok(models) => return Ok(models),
                Err(err) => {
                    if err.contains("401") || err.contains("403") || err.contains("Invalid") {
                        return Err(err);
                    }
                    last_err = err;
                }
            }
        }
        Err(last_err)
    }

    async fn try_get_models(
        &self,
        api_key: &str,
        endpoint: &str,
    ) -> Result<(Vec<String>, HashMap<String, u64>), String> {
        let response = self
            .client
            .get(endpoint)
            .header("api-key", api_key)
            .header("Authorization", format!("Bearer {}", api_key))
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|err| format!("Request failed: {}", err))?;

        let status = response.status().as_u16();

        if status == 401 || status == 403 {
            return Err(format!("Invalid API key (HTTP {})", status));
        }

        if !response.status().is_success() {
            return Err(format!("HTTP {}", status));
        }

        let data: ModelsResponse = response
            .json()
            .await
            .map_err(|err| format!("Failed to parse response: {}", err))?;

        let mut ids: Vec<String> = Vec::new();
        let mut contexts: HashMap<String, u64> = HashMap::new();
        for m in data.data.unwrap_or_default() {
            if let Some(ctx) = m.context_length.filter(|ctx| *ctx > 0) {
                contexts.insert(m.id.clone(), ctx);
            }
            ids.push(m.id);
        }

        Ok((ids, contexts))
    }

    pub fn validate_format(&self, api_key: &str) -> (bool, String) {
        if api_key.is_empty() {
            return (false, "API key is required".to_string());
        }

        if api_key.len() < 8 {
            return (false, "API key is too short".to_string());
        }

        (true, "Format OK".to_string())
    }
}

impl Default for AzureOpenAIValidator {
    fn default() -> Self {
        Self::new()
    }
}
