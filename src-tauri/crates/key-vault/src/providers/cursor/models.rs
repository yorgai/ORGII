//! Cursor model listing — native API + CLI fallback

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Stdio;
use tokio::process::Command;
use tokio::time::timeout;

use super::CursorValidator;

/// Native model entry from api2.cursor.sh/aiserver.v1.AiService/GetUsableModels
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorNativeModel {
    /// Stable model identifier (e.g. "claude-opus-4-7-xhigh", "gpt-5.4-nano-low")
    pub model_id: String,
    pub display_model_id: Option<String>,
    pub display_name: Option<String>,
    pub display_name_short: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub max_mode: bool,
}

/// Response envelope from GetUsableModels (aiserver.v1)
#[derive(Debug, Deserialize)]
struct GetUsableModelsResponse {
    #[serde(default)]
    models: Vec<CursorNativeModel>,
}

impl CursorValidator {
    /// Get available models via CLI
    ///
    /// Strategy:
    /// 1. Try `cursor agent --api-key KEY --list-models`
    /// 2. Fallback: use invalid model name to get error with model list
    pub async fn get_available_models(&self, api_key: &str) -> Result<Vec<String>, String> {
        // Strategy 1: Try --list-models directly
        log::info!("[CursorValidation] Trying --list-models...");
        if let Ok(models) = self.try_list_models(api_key).await {
            if !models.is_empty() {
                log::info!(
                    "[CursorValidation] ✅ Got {} models via --list-models",
                    models.len()
                );
                return Ok(models);
            }
        }

        // Strategy 2: Fallback - use invalid model to get error with model list
        log::info!("[CursorValidation] --list-models returned empty, trying fallback...");
        if let Ok(models) = self.try_invalid_model_fallback(api_key).await {
            if !models.is_empty() {
                log::info!(
                    "[CursorValidation] ✅ Got {} models via fallback",
                    models.len()
                );
                return Ok(models);
            }
        }

        log::warn!("[CursorValidation] ❌ Could not get model list via any method");
        Ok(Vec::new())
    }

    /// Try to get models via --list-models flag
    async fn try_list_models(&self, api_key: &str) -> Result<Vec<String>, String> {
        let mut command = Command::new("cursor");
        command
            .args(["agent", "--api-key", api_key, "--list-models"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Suppress the console window on Windows.
        #[cfg(windows)]
        command.creation_flags(app_platform::CREATE_NO_WINDOW);
        let result = timeout(self.cli_timeout, command.output()).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr);
                log::debug!(
                    "[CursorValidation] --list-models output: {}...",
                    &combined[..combined.len().min(500)]
                );
                let models = self.parse_model_list(&combined);
                log::info!(
                    "[CursorValidation] --list-models found {} models",
                    models.len()
                );
                Ok(models)
            }
            Ok(Err(e)) => {
                log::warn!("[CursorValidation] --list-models CLI error: {}", e);
                Err(format!("Failed to run cursor CLI: {}", e))
            }
            Err(_) => {
                log::warn!("[CursorValidation] --list-models timeout");
                Err("CLI timeout".to_string())
            }
        }
    }

    /// Fallback: Use invalid model name to get error with available models
    async fn try_invalid_model_fallback(&self, api_key: &str) -> Result<Vec<String>, String> {
        let mut command = Command::new("cursor");
        command
            .args([
                "agent",
                "--api-key",
                api_key,
                "-p",
                "--model",
                "___invalid_model_name___",
                "hi",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Suppress the console window on Windows.
        #[cfg(windows)]
        command.creation_flags(app_platform::CREATE_NO_WINDOW);
        let result = timeout(self.cli_timeout, command.output()).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = format!("{}{}", stdout, stderr);
                log::debug!(
                    "[CursorValidation] Invalid model output: {}...",
                    &combined[..combined.len().min(500)]
                );
                let models = self.parse_error_model_list(&combined);
                log::info!("[CursorValidation] Fallback found {} models", models.len());
                Ok(models)
            }
            Ok(Err(e)) => {
                log::warn!("[CursorValidation] Fallback CLI error: {}", e);
                Err(format!("Failed to run cursor CLI: {}", e))
            }
            Err(_) => {
                log::warn!("[CursorValidation] Fallback timeout");
                Err("CLI timeout".to_string())
            }
        }
    }

    /// Parse model list from CLI --list-models output
    ///
    /// Output format:
    /// Available models
    ///
    /// auto - Auto  (current)
    /// composer-1 - Composer 1
    /// gpt-5.1-codex-max - GPT-5.1 Codex Max
    /// ...
    ///
    /// Tip: use --model <id> ...
    pub(crate) fn parse_model_list(&self, output: &str) -> Vec<String> {
        let mut models = Vec::new();
        let mut in_models_section = false;

        // ANSI escape code pattern
        let ansi_pattern = Regex::new(r"\x1b\[[0-9;]*[mGKH]").unwrap();

        for line in output.lines() {
            let clean_line = ansi_pattern.replace_all(line, "").trim().to_string();

            if clean_line.is_empty() {
                continue;
            }

            if clean_line.contains("Available models") {
                in_models_section = true;
                continue;
            }

            if clean_line.starts_with("Tip:") {
                break;
            }

            if in_models_section && clean_line.contains(" - ") {
                if let Some(model_id) = clean_line.split(" - ").next() {
                    let model = model_id.trim().to_string();
                    if !model.is_empty() {
                        models.push(model);
                    }
                }
            }
        }

        models
    }

    /// Parse model list from error output when invalid model is used
    pub(crate) fn parse_error_model_list(&self, output: &str) -> Vec<String> {
        let output_lower = output.to_lowercase();
        let mut models: Vec<String> = Vec::new();

        // Pattern 1: "Available models: model1, model2, ..."
        if output_lower.contains("available models") {
            let pattern = Regex::new(r"(?i)available models?[:\s]*(.+?)(?:\n\n|\z)").unwrap();
            if let Some(captures) = pattern.captures(output) {
                if let Some(model_str) = captures.get(1) {
                    let split_pattern = Regex::new(r"[,\n|]+").unwrap();
                    models = split_pattern
                        .split(model_str.as_str().trim())
                        .map(|m| m.trim().to_string())
                        .filter(|m| !m.is_empty() && !m.starts_with('-'))
                        .map(|m| m.trim_end_matches(['.', ' ']).to_string())
                        .collect();
                }
            }
        }

        // Pattern 2: "Choose from: model1, model2, ..."
        if models.is_empty() && output_lower.contains("choose from") {
            let pattern = Regex::new(r"(?i)choose from[:\s]*(.+?)(?:\n\n|\z)").unwrap();
            if let Some(captures) = pattern.captures(output) {
                if let Some(model_str) = captures.get(1) {
                    let split_pattern = Regex::new(r"[,\n|]+").unwrap();
                    models = split_pattern
                        .split(model_str.as_str().trim())
                        .map(|m| m.trim().to_string())
                        .filter(|m| !m.is_empty() && !m.starts_with('-'))
                        .map(|m| m.trim_end_matches(['.', ' ']).to_string())
                        .collect();
                }
            }
        }

        // Pattern 3: "Valid models are: ..." or "Supported models: ..."
        if models.is_empty() {
            let pattern =
                Regex::new(r"(?i)(?:valid|supported)\s+models?\s*(?:are)?[:\s]*(.+?)(?:\n\n|\z)")
                    .unwrap();
            if let Some(captures) = pattern.captures(output) {
                if let Some(model_str) = captures.get(1) {
                    let split_pattern = Regex::new(r"[,\n|]+").unwrap();
                    models = split_pattern
                        .split(model_str.as_str().trim())
                        .map(|m| m.trim().to_string())
                        .filter(|m| !m.is_empty() && !m.starts_with('-'))
                        .map(|m| m.trim_end_matches(['.', ' ']).to_string())
                        .collect();
                }
            }
        }

        // Pattern 4: Fallback - look for model IDs anywhere
        if models.is_empty() {
            let model_pattern = Regex::new(
                r"\b(auto|composer-\d+|gpt-[\w.-]+|claude-[\w.-]+|opus-[\w.-]+|sonnet-[\w.-]+|haiku-[\w.-]+|gemini-[\w.-]+|grok-[\w.-]+|o1(?:-[\w.-]+)?|o3(?:-[\w.-]+)?|o4(?:-[\w.-]+)?)\b"
            ).unwrap();

            let mut seen: HashSet<String> = HashSet::new();
            for cap in model_pattern.captures_iter(output) {
                if let Some(m) = cap.get(1) {
                    let model = m.as_str().to_lowercase();
                    if !seen.contains(&model) && model != "___invalid_model_name___" {
                        seen.insert(model.clone());
                        models.push(m.as_str().to_string());
                    }
                }
            }
        }

        // Filter out invalid/test model names
        models
            .into_iter()
            .filter(|m| !m.starts_with("___") && m.len() >= 2)
            .collect()
    }

    /// Get available models by calling Cursor's native discovery API.
    ///
    /// Hits `POST https://api2.cursor.sh/aiserver.v1.AiService/GetUsableModels`
    /// with the session JWT as Bearer token. Returns the full model catalog
    /// visible to the account's subscription (Free tier also gets the full list;
    /// subscription gating happens at chat time, not discovery time).
    ///
    /// # Arguments
    /// * `session_token` - Cursor session token. Accepts both `userId%3A%3AJWT`
    ///   (webview-captured cookie format) and bare JWT (`cursorAuth/accessToken`
    ///   format). JWT is extracted via the same logic as quota.rs.
    pub async fn get_native_models(
        &self,
        session_token: &str,
    ) -> Result<Vec<CursorNativeModel>, String> {
        if session_token.is_empty() {
            return Err("No session token provided".to_string());
        }

        // Extract JWT from URL-encoded `userId%3A%3AJWT` if needed.
        let decoded = urlencoding::decode(session_token)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| session_token.to_string());
        let jwt = if decoded.contains("::") {
            decoded.split("::").last().unwrap_or(&decoded).to_string()
        } else {
            decoded
        };

        let url = "https://api2.cursor.sh/aiserver.v1.AiService/GetUsableModels";

        log::info!("[CursorNative] GET {}", url);
        let response = self
            .client
            .post(url)
            .header("authorization", format!("Bearer {}", jwt))
            .header("content-type", "application/json")
            .header("connect-protocol-version", "1")
            .header("x-cursor-client-type", "ide")
            .header("x-cursor-client-os", std::env::consts::OS)
            .header("x-ghost-mode", "false")
            .header("x-new-onboarding-completed", "true")
            .body("{}")
            .timeout(self.http_timeout)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();
        log::info!("[CursorNative] GetUsableModels status {}", status.as_u16());
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err("Session token expired or invalid".to_string());
        }
        if !status.is_success() {
            // Preserve a body-read failure as the body so the user
            // sees "HTTP <code>: (body read failed: <err>)" instead
            // of a bare "HTTP <code>: " with no hint that the body
            // itself was unreachable.
            let body = match response.text().await {
                Ok(t) => t,
                Err(err) => format!("(body read failed: {})", err),
            };
            return Err(format!(
                "HTTP {}: {}",
                status.as_u16(),
                &body[..body.len().min(300)]
            ));
        }

        let data: GetUsableModelsResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        log::info!("[CursorNative] ✅ Got {} models", data.models.len());
        Ok(data.models)
    }
}
