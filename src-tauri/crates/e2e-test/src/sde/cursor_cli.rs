use crate::{config::Config, harness};

use super::tmp_workspace_path;

const DEFAULT_CURSOR_CLI_ACCOUNT_ID: &str = "cursor_native_e2e";
const DEFAULT_CURSOR_CLI_MODEL: &str = "composer-2";

fn cursor_e2e_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|err| format!("Client build error: {err}"))
}

async fn post_cursor_cli_runtime(
    cfg: &Config,
    account_id: &str,
    model: &str,
    workspace: &str,
    marker: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/agent/test/cli/cursor-runtime", cfg.base_url);
    let client = cursor_e2e_client()?;
    let body = serde_json::json!({
        "content": format!("Reply with exactly {marker} and no other words."),
        "expected_text": marker,
        "account_id": account_id,
        "model": model,
        "workspace_path": workspace,
        "timeout_secs": 240,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("HTTP error: {err}"))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error: {err}"))?;
    if let Some(err) = json.get("error").and_then(|value| value.as_str()) {
        return Err(err.to_string());
    }
    Ok(json)
}

fn validate_account_profile(json: &serde_json::Value, account_id: &str) -> Result<String, String> {
    let cursor_config_dir_exists = json
        .get("cursor_config_dir_exists")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let cursor_config_file_exists = json
        .get("cursor_config_file_exists")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let cursor_config_dir = json
        .get("cursor_config_dir")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if !cursor_config_dir_exists || !cursor_config_file_exists {
        return Err(format!(
            "Cursor CLI did not use an account-scoped profile. dir={cursor_config_dir:?} dir_exists={cursor_config_dir_exists} config_exists={cursor_config_file_exists}"
        ));
    }
    if !cursor_config_dir.contains(account_id) {
        return Err(format!(
            "Cursor CLI profile is not account-scoped. account_id={account_id:?} dir={cursor_config_dir:?}"
        ));
    }
    Ok(cursor_config_dir.to_string())
}

pub async fn cursor_cli_token_only_boundary(cfg: &Config) -> bool {
    let account_id = std::env::var("SOYD_E2E_CURSOR_CLI_TOKEN_ONLY_ACCOUNT_ID")
        .unwrap_or_else(|_| DEFAULT_CURSOR_CLI_ACCOUNT_ID.to_string());
    let model = std::env::var("SOYD_E2E_CURSOR_CLI_MODEL")
        .unwrap_or_else(|_| DEFAULT_CURSOR_CLI_MODEL.to_string());
    let workspace = tmp_workspace_path("cursor-cli-token-only-boundary");
    let marker = format!(
        "CURSOR_CLI_TOKEN_BOUNDARY_{}",
        cfg.session_prefix.replace(':', "_")
    );

    let result = async {
        eprintln!(
            "[cursor-cli-boundary-e2e] effective_model={model} effective_account_id={account_id}"
        );
        let json = post_cursor_cli_runtime(cfg, &account_id, &model, &workspace, &marker).await?;
        let cursor_config_dir = validate_account_profile(&json, &account_id)?;
        let status = json
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let error_message = json
            .get("error_message")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if status != "completed" && (status != "failed" || !error_message.contains("Authentication required")) {
            return Err(format!(
                "Token-only Cursor CLI reached unexpected terminal state. status={status:?} error_message={error_message:?} dir={cursor_config_dir}"
            ));
        }
        Ok(format!(
            "status={status} account_profile_verified=true account_id={account_id} cursor_config_dir={cursor_config_dir}"
        ))
    }
    .await;

    match result {
        Ok(summary) => harness::print_result(
            "cursor-cli-token-only-boundary",
            &summary,
            &[(
                "external cursor-agent uses the selected account profile",
                true,
            )],
        ),
        Err(err) => harness::print_error("cursor-cli-token-only-boundary", &err),
    }
}
