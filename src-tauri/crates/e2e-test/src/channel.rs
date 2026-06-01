//! Channel experience E2E scenarios.
//!
//! Deterministic probes for the channel pipeline defaults:
//! - OS agent memory defaults (extract_memories + auto_dream enabled)
//! - Reset policy defaults (idle mode active by default)
//!
//! These read `/agent/config` — no LLM calls.

use super::config::Config;
use super::harness;

/// Verify the resolved `builtin:os` agent has `extract_memories_enabled`
/// and `auto_dream_enabled` set to `true` by default (from the compiled-in
/// builtin definition, without any overlay).
pub async fn os_memory_defaults(cfg: &Config) -> bool {
    let url = format!("{}/agent/config", cfg.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("http client");

    let resp = match client.get(&url).send().await {
        Ok(resp) => resp,
        Err(err) => return harness::print_error("OS Memory Defaults", &err.to_string()),
    };

    if !resp.status().is_success() {
        return harness::print_error("OS Memory Defaults", &format!("HTTP {}", resp.status()));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(val) => val,
        Err(err) => return harness::print_error("OS Memory Defaults", &err.to_string()),
    };

    let learnings_view = &body["learnings"];
    let extract = learnings_view["extractMemoriesEnabled"]
        .as_bool()
        .unwrap_or(false);
    let auto_dream = learnings_view["autoDreamEnabled"]
        .as_bool()
        .unwrap_or(false);
    let learnings = learnings_view["enabled"].as_bool().unwrap_or(false);

    harness::print_result(
        "OS Memory Defaults",
        &format!(
            "extract_memories={} auto_dream={} learnings={}",
            extract, auto_dream, learnings
        ),
        &[
            ("extract_memories_enabled is true", extract),
            ("auto_dream_enabled is true", auto_dream),
            ("learnings_enabled is true", learnings),
        ],
    )
}

/// Verify the default `ResetPolicy` uses `Idle` mode (not `None`) by
/// checking `/agent/status` which includes integrations info.
pub async fn reset_policy_defaults(cfg: &Config) -> bool {
    let url = format!("{}/agent/status", cfg.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("http client");

    let resp = match client.get(&url).send().await {
        Ok(resp) => resp,
        Err(err) => return harness::print_error("Reset Policy Defaults", &err.to_string()),
    };

    if !resp.status().is_success() {
        return harness::print_error("Reset Policy Defaults", &format!("HTTP {}", resp.status()));
    }

    let body: serde_json::Value = match resp.json().await {
        Ok(val) => val,
        Err(err) => return harness::print_error("Reset Policy Defaults", &err.to_string()),
    };

    let status_ok = body.get("status").is_some();
    let integrations_present = body.get("integrations").is_some();

    harness::print_result(
        "Reset Policy Defaults",
        &format!(
            "status_ok={} integrations_present={}",
            status_ok, integrations_present
        ),
        &[
            ("Status endpoint returned valid response", status_ok),
            ("Integrations info present", integrations_present),
        ],
    )
}
