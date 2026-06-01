//! Feishu authentication — tenant_access_token lifecycle.

use reqwest::Client;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::info;

use super::super::config::FeishuAccountConfig;
use super::super::traits::ChannelError;

/// Cached token state.
struct TokenState {
    access_token: String,
    expires_at: Instant,
}

/// Minimum remaining lifetime before we force a refresh.
const TOKEN_REFRESH_MARGIN: Duration = Duration::from_secs(300);

/// Manages Feishu tenant_access_token lifecycle.
///
/// Tokens are valid for ~2 hours. We refresh proactively when < 5 min remain.
pub struct FeishuAuth {
    app_id: String,
    app_secret: String,
    api_base: String,
    client: Client,
    token: Arc<RwLock<Option<TokenState>>>,
}

impl FeishuAuth {
    pub fn new(config: &FeishuAccountConfig) -> Self {
        Self {
            app_id: config.app_id.clone(),
            app_secret: config.app_secret.clone(),
            api_base: config.api_base(),
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .expect("failed to build reqwest client"),
            token: Arc::new(RwLock::new(None)),
        }
    }

    /// Return a valid access token, refreshing if needed.
    pub async fn get_token(&self) -> Result<String, ChannelError> {
        {
            let guard = self.token.read().await;
            if let Some(state) = guard.as_ref() {
                if state.expires_at > Instant::now() + TOKEN_REFRESH_MARGIN {
                    return Ok(state.access_token.clone());
                }
            }
        }
        self.refresh_token().await
    }

    /// Force-refresh the tenant_access_token.
    pub async fn refresh_token(&self) -> Result<String, ChannelError> {
        let url = format!("{}/auth/v3/tenant_access_token/internal", self.api_base);
        let body = serde_json::json!({
            "app_id": self.app_id,
            "app_secret": self.app_secret,
        });

        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|err| ChannelError::ConnectionFailed(err.to_string()))?;

        let json: Value = res
            .json()
            .await
            .map_err(|err| ChannelError::Other(format!("Invalid token response: {}", err)))?;

        let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = json
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("Failed to get access token");
            return Err(ChannelError::ConfigError(msg.to_string()));
        }

        let access_token = json
            .get("tenant_access_token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| ChannelError::Other("Missing tenant_access_token in response".into()))?
            .to_string();

        let expire_secs = json.get("expire").and_then(|e| e.as_u64()).unwrap_or(7200);

        let state = TokenState {
            access_token: access_token.clone(),
            expires_at: Instant::now() + Duration::from_secs(expire_secs),
        };

        let mut guard = self.token.write().await;
        *guard = Some(state);

        info!("[feishu] Token refreshed, expires in {}s", expire_secs);

        Ok(access_token)
    }

    /// API base URL (for use by send/upload methods).
    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    /// Shared HTTP client.
    pub fn client(&self) -> &Client {
        &self.client
    }
}

/// Fetch the bot's own open_id so we can detect @mentions.
///
/// Silent empty open_id would make the bot stop responding to @mentions
/// without any signal — the Feishu group would assume the bot is offline
/// and the operator would see no logs. Warn on each failure path so the
/// distinct cause (auth, transport, body parse) surfaces.
pub(super) async fn fetch_bot_open_id(auth: &FeishuAuth) -> String {
    let token = match auth.get_token().await {
        Ok(tok) => tok,
        Err(err) => {
            tracing::warn!(error = %err, "feishu::fetch_bot_open_id: get_token failed; @mention detection will be disabled");
            return String::new();
        }
    };

    let url = format!("{}/bot/v3/info", auth.api_base());
    let res = match auth
        .client()
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
    {
        Ok(res) => res,
        Err(err) => {
            tracing::warn!(error = %err, url = %url, "feishu::fetch_bot_open_id: HTTP request failed; @mention detection will be disabled");
            return String::new();
        }
    };

    let json: Value = match res.json().await {
        Ok(val) => val,
        Err(err) => {
            tracing::warn!(error = %err, "feishu::fetch_bot_open_id: response body parse failed; @mention detection will be disabled");
            return String::new();
        }
    };

    json.get("bot")
        .and_then(|b| b.get("open_id"))
        .and_then(|o| o.as_str())
        .unwrap_or("")
        .to_string()
}
