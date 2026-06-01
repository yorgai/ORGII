//! `/agent/test/desktop/*` endpoints (debug-only).
//!
//! Deterministic probes for app-owned desktop support that remains after
//! agent-facing desktop automation moved to the bundled Peekaboo CLI.

#![cfg(debug_assertions)]

use axum::Json;

pub async fn test_desktop_config_parse(
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let content = body
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    match agent_core::state::commands::desktop::debug_parse_desktop_config(content) {
        Ok(config) => Json(serde_json::json!({
            "ok": true,
            "hide_before_action": config.hide_before_action,
            "anti_detection": config.anti_detection,
            "human_input_profile": config.human_input_profile,
            "escape_abort": config.escape_abort,
        })),
        Err(err) => Json(serde_json::json!({
            "ok": false,
            "error": err,
        })),
    }
}
