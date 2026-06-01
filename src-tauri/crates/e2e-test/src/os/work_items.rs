use crate::config::Config;
use crate::harness;

async fn work_item_launch_parse(
    cfg: &Config,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/work-item-launch/parse", cfg.base_url);
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("client")
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;

    resp.json::<serde_json::Value>()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))
}

pub async fn work_item_launch_invalid_json_rejected(cfg: &Config) -> bool {
    let agent_defs = work_item_launch_parse(
        cfg,
        serde_json::json!({
            "kind": "agent_definitions",
            "content": "{ invalid",
        }),
    )
    .await;
    let orgs = work_item_launch_parse(
        cfg,
        serde_json::json!({
            "kind": "agent_orgs",
            "content": "{ invalid",
        }),
    )
    .await;

    let agent_defs_error = agent_defs
        .as_ref()
        .ok()
        .and_then(|json| json.get("error"))
        .and_then(|value| value.as_str());
    let orgs_error = orgs
        .as_ref()
        .ok()
        .and_then(|json| json.get("error"))
        .and_then(|value| value.as_str());
    let summary = format!("agent_defs_error={agent_defs_error:?} orgs_error={orgs_error:?}");

    harness::print_result(
        "Work Item Launch Invalid JSON Rejected",
        &summary,
        &[
            (
                "agent definitions invalid JSON returned explicit error",
                agent_defs_error.is_some_and(|err| {
                    err.contains("parse agent definitions for work-item launch")
                }),
            ),
            (
                "agent orgs invalid JSON returned explicit error",
                orgs_error.is_some_and(|err| {
                    err.contains("parse agent organizations for work-item launch")
                }),
            ),
        ],
    )
}
