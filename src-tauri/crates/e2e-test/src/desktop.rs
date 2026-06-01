//! Desktop configuration E2E scenarios.
//!
//! Deterministic probes for app-owned desktop support that remains after
//! agent-facing desktop automation moved to the bundled Peekaboo CLI. Runs
//! without TCC permissions, without a live macOS app, and without the LLM.

use crate::config::Config;
use crate::harness;

async fn parse_desktop_config(cfg: &Config, content: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/desktop/config/parse", cfg.base_url);
    let response = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({ "content": content }))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

pub async fn desktop_config_invalid_json_rejected(cfg: &Config) -> bool {
    match parse_desktop_config(cfg, "{ invalid").await {
        Err(err) => harness::print_error("Desktop config invalid JSON rejected", &err),
        Ok(json) => {
            let error = json.get("error").and_then(|value| value.as_str());
            harness::print_result(
                "Desktop config invalid JSON rejected",
                &json.to_string(),
                &[
                    (
                        "response ok=false",
                        json.get("ok").and_then(|value| value.as_bool()) == Some(false),
                    ),
                    (
                        "invalid JSON returned explicit parse error",
                        error.is_some_and(|message| {
                            message.contains("Failed to parse desktop config")
                        }),
                    ),
                ],
            )
        }
    }
}
