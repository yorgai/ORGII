//! Probes for chat platforms that expose a REST API with bearer/bot auth.
//!
//! Each function validates credentials by making a single lightweight API
//! call and returns a `ProbeResult`. Side effects (sending messages, etc.)
//! are avoided on purpose.

use std::time::Instant;

use super::common::{elapsed_ms, probe_client, ProbeResult};

/// Probe Telegram by calling `getMe`.
pub(super) async fn probe_telegram(token: &str) -> ProbeResult {
    let start = Instant::now();
    if token.is_empty() {
        return ProbeResult::failure("Token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = format!("https://api.telegram.org/bot{}/getMe", token);

    match client.get(&url).send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            match res.json::<serde_json::Value>().await {
                Ok(body) => {
                    if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                        let username = body
                            .get("result")
                            .and_then(|r| r.get("username"))
                            .and_then(|u| u.as_str())
                            .unwrap_or("unknown");
                        ProbeResult::success(format!("@{}", username), elapsed_ms(start))
                    } else {
                        let desc = body
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("Unknown error");
                        ProbeResult::failure(format!("{} ({})", desc, status), elapsed_ms(start))
                    }
                }
                Err(err) => {
                    ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
                }
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Discord by calling `users/@me`.
pub(super) async fn probe_discord(token: &str) -> ProbeResult {
    let start = Instant::now();
    if token.is_empty() {
        return ProbeResult::failure("Token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://discord.com/api/v10/users/@me";

    match client
        .get(url)
        .header("Authorization", format!("Bot {}", token))
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status().as_u16();
            if !res.status().is_success() {
                let msg = match status {
                    401 => "Unauthorized — invalid token".to_string(),
                    403 => "Forbidden — missing permissions".to_string(),
                    _ => format!("HTTP {}", status),
                };
                return ProbeResult::failure(msg, elapsed_ms(start));
            }
            match res.json::<serde_json::Value>().await {
                Ok(body) => {
                    let username = body
                        .get("username")
                        .and_then(|u| u.as_str())
                        .unwrap_or("unknown");
                    ProbeResult::success(username.to_string(), elapsed_ms(start))
                }
                Err(err) => ProbeResult::failure(
                    format!("Invalid response ({}): {}", status, err),
                    elapsed_ms(start),
                ),
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Feishu by exchanging app credentials for a tenant token, then
/// fetching bot info. Supports domain: "feishu" | "lark" | custom URL.
pub(super) async fn probe_feishu(app_id: &str, app_secret: &str, domain: &str) -> ProbeResult {
    let start = Instant::now();
    if app_id.is_empty() || app_secret.is_empty() {
        return ProbeResult::failure("App ID or App Secret is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let api_base = match domain {
        "lark" => "https://open.larksuite.com/open-apis".to_string(),
        "feishu" | "" => "https://open.feishu.cn/open-apis".to_string(),
        custom => custom.to_string(),
    };

    let token_url = format!("{}/auth/v3/tenant_access_token/internal", api_base);
    let token_body = serde_json::json!({
        "app_id": app_id,
        "app_secret": app_secret,
    });

    let token_res = match client.post(&token_url).json(&token_body).send().await {
        Ok(res) => res,
        Err(err) => return ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    };

    let token_json: serde_json::Value = match token_res.json().await {
        Ok(json) => json,
        Err(err) => {
            return ProbeResult::failure(
                format!("Invalid token response: {}", err),
                elapsed_ms(start),
            )
        }
    };

    let code = token_json
        .get("code")
        .and_then(|c| c.as_i64())
        .unwrap_or(-1);
    if code != 0 {
        let msg = token_json
            .get("msg")
            .and_then(|m| m.as_str())
            .unwrap_or("Failed to get access token");
        return ProbeResult::failure(msg.to_string(), elapsed_ms(start));
    }

    let access_token = match token_json
        .get("tenant_access_token")
        .and_then(|t| t.as_str())
    {
        Some(token) => token,
        None => return ProbeResult::failure("No access token in response", elapsed_ms(start)),
    };

    let bot_url = format!("{}/bot/v3/info", api_base);
    match client
        .get(&bot_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        Ok(res) => match res.json::<serde_json::Value>().await {
            Ok(body) => {
                let bot_code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                if bot_code != 0 {
                    let msg = body
                        .get("msg")
                        .and_then(|m| m.as_str())
                        .unwrap_or("Failed to get bot info");
                    return ProbeResult::failure(msg.to_string(), elapsed_ms(start));
                }
                let app_name = body
                    .get("bot")
                    .and_then(|b| b.get("app_name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("Feishu Bot");
                ProbeResult::success(app_name.to_string(), elapsed_ms(start))
            }
            Err(err) => ProbeResult::failure(
                format!("Invalid bot info response: {}", err),
                elapsed_ms(start),
            ),
        },
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe DingTalk by requesting an access token with the client credentials.
pub(super) async fn probe_dingtalk(client_id: &str, client_secret: &str) -> ProbeResult {
    let start = Instant::now();
    if client_id.is_empty() || client_secret.is_empty() {
        return ProbeResult::failure("Client ID or Client Secret is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
    let body = serde_json::json!({
        "appKey": client_id,
        "appSecret": client_secret,
    });

    match client.post(url).json(&body).send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            match res.json::<serde_json::Value>().await {
                Ok(json) => {
                    if json.get("accessToken").and_then(|t| t.as_str()).is_some() {
                        ProbeResult::success("DingTalk Bot", elapsed_ms(start))
                    } else {
                        let msg = json
                            .get("message")
                            .or_else(|| json.get("errmsg"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Failed to get access token");
                        ProbeResult::failure(format!("{} ({})", msg, status), elapsed_ms(start))
                    }
                }
                Err(err) => {
                    ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
                }
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Slack by calling `auth.test` with the bot token.
pub(super) async fn probe_slack(bot_token: &str) -> ProbeResult {
    let start = Instant::now();
    if bot_token.is_empty() {
        return ProbeResult::failure("Bot token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://slack.com/api/auth.test";

    match client
        .post(url)
        .header("Authorization", format!("Bearer {}", bot_token))
        .send()
        .await
    {
        Ok(res) => match res.json::<serde_json::Value>().await {
            Ok(body) => {
                if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                    let user = body
                        .get("user")
                        .and_then(|u| u.as_str())
                        .unwrap_or("unknown");
                    ProbeResult::success(user.to_string(), elapsed_ms(start))
                } else {
                    let err_msg = body
                        .get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error");
                    ProbeResult::failure(err_msg.to_string(), elapsed_ms(start))
                }
            }
            Err(err) => {
                ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
            }
        },
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Zalo by calling the OA info endpoint.
pub(super) async fn probe_zalo(bot_token: &str) -> ProbeResult {
    let start = Instant::now();
    if bot_token.is_empty() {
        return ProbeResult::failure("OA token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://openapi.zalo.me/v2.0/oa/getoa";

    match client
        .get(url)
        .header("access_token", bot_token)
        .send()
        .await
    {
        Ok(res) => match res.json::<serde_json::Value>().await {
            Ok(body) => {
                let error_code = body.get("error").and_then(|e| e.as_i64()).unwrap_or(-1);
                if error_code == 0 {
                    let name = body
                        .get("data")
                        .and_then(|d| d.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("Zalo OA");
                    ProbeResult::success(name.to_string(), elapsed_ms(start))
                } else {
                    let msg = body
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("Unknown error");
                    ProbeResult::failure(msg.to_string(), elapsed_ms(start))
                }
            }
            Err(err) => {
                ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
            }
        },
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe LINE by calling the bot profile endpoint.
pub(super) async fn probe_line(channel_access_token: &str) -> ProbeResult {
    let start = Instant::now();
    if channel_access_token.is_empty() {
        return ProbeResult::failure("Channel access token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://api.line.me/v2/bot/info";

    match client
        .get(url)
        .header("Authorization", format!("Bearer {}", channel_access_token))
        .send()
        .await
    {
        Ok(res) => {
            if !res.status().is_success() {
                return ProbeResult::failure(
                    format!("HTTP {}", res.status().as_u16()),
                    elapsed_ms(start),
                );
            }
            match res.json::<serde_json::Value>().await {
                Ok(body) => {
                    let name = body
                        .get("displayName")
                        .and_then(|n| n.as_str())
                        .unwrap_or("LINE Bot");
                    ProbeResult::success(name.to_string(), elapsed_ms(start))
                }
                Err(err) => {
                    ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
                }
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe MS Teams by requesting a Bot Framework OAuth token.
pub(super) async fn probe_msteams(app_id: &str, app_password: &str) -> ProbeResult {
    let start = Instant::now();
    if app_id.is_empty() || app_password.is_empty() {
        return ProbeResult::failure("App ID or App Password is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";

    match client
        .post(url)
        .form(&[
            ("grant_type", "client_credentials"),
            ("client_id", app_id),
            ("client_secret", app_password),
            ("scope", "https://api.botframework.com/.default"),
        ])
        .send()
        .await
    {
        Ok(res) => match res.json::<serde_json::Value>().await {
            Ok(body) => {
                if body.get("access_token").is_some() {
                    ProbeResult::success("Microsoft Teams Bot", elapsed_ms(start))
                } else {
                    let err_msg = body
                        .get("error_description")
                        .and_then(|e| e.as_str())
                        .unwrap_or("Failed to authenticate");
                    ProbeResult::failure(err_msg.to_string(), elapsed_ms(start))
                }
            }
            Err(err) => {
                ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
            }
        },
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Matrix by calling the whoami endpoint.
pub(super) async fn probe_matrix(homeserver_url: &str, access_token: &str) -> ProbeResult {
    let start = Instant::now();
    if homeserver_url.is_empty() || access_token.is_empty() {
        return ProbeResult::failure("Homeserver URL or access token is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = format!(
        "{}/_matrix/client/v3/account/whoami",
        homeserver_url.trim_end_matches('/')
    );

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
    {
        Ok(res) => {
            if !res.status().is_success() {
                return ProbeResult::failure(
                    format!("HTTP {}", res.status().as_u16()),
                    elapsed_ms(start),
                );
            }
            match res.json::<serde_json::Value>().await {
                Ok(body) => {
                    let user_id = body
                        .get("user_id")
                        .and_then(|u| u.as_str())
                        .unwrap_or("unknown");
                    ProbeResult::success(user_id.to_string(), elapsed_ms(start))
                }
                Err(err) => {
                    ProbeResult::failure(format!("Invalid response: {}", err), elapsed_ms(start))
                }
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}
