//! Channel connectivity probes.
//!
//! Each probe function tests whether the given credentials are valid by making
//! a lightweight API call to the channel's service. The shape follows the
//! standard probe pattern: `{ ok, error?, identity?, elapsed_ms }`.
//!
//! Probes are grouped by integration style:
//!   - `api_bots`: REST bot APIs with bearer/token auth
//!     (Telegram, Discord, Feishu, DingTalk, Slack, Zalo, LINE, MS Teams, Matrix).
//!   - `network`: TCP reachability / bridge / URL health checks
//!     (Email, WhatsApp, iMessage, Signal, Google Chat).

mod api_bots;
mod common;
mod network;

// `ProbeResult` is the public return type of `probe_channel`; the per-
// channel `probe_*` functions are reached only by this dispatcher and
// are imported via `use api_bots::*; use network::*;` below.
pub use common::ProbeResult;

use api_bots::{
    probe_dingtalk, probe_discord, probe_feishu, probe_line, probe_matrix, probe_msteams,
    probe_slack, probe_telegram, probe_zalo,
};
use network::{
    probe_email, probe_googlechat, probe_imessage, probe_signal, probe_wecom, probe_weixin,
    probe_whatsapp,
};

/// Probe a channel by type. `credentials` is a flat JSON map with the
/// fields relevant to that channel type.
pub async fn probe_channel(channel_type: &str, credentials: &serde_json::Value) -> ProbeResult {
    use crate::channels::config::channel_type as ct;

    let get_str =
        |key: &str| -> &str { credentials.get(key).and_then(|v| v.as_str()).unwrap_or("") };

    match channel_type {
        ct::TELEGRAM => probe_telegram(get_str("token")).await,
        ct::DISCORD => probe_discord(get_str("token")).await,
        ct::SLACK => probe_slack(get_str("botToken")).await,
        ct::WHATSAPP => {
            let bridge_url = credentials
                .get("bridgeUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("ws://localhost:3001");
            probe_whatsapp(bridge_url).await
        }
        ct::IMESSAGE => probe_imessage(get_str("serverUrl"), get_str("password")).await,
        ct::SIGNAL => probe_signal(get_str("apiUrl"), get_str("phoneNumber")).await,
        ct::FEISHU => {
            let domain = get_str("domain");
            probe_feishu(get_str("appId"), get_str("appSecret"), domain).await
        }
        ct::DINGTALK => probe_dingtalk(get_str("clientId"), get_str("clientSecret")).await,
        ct::ZALO => probe_zalo(get_str("botToken")).await,
        ct::LINE => probe_line(get_str("channelAccessToken")).await,
        ct::MSTEAMS => probe_msteams(get_str("appId"), get_str("appPassword")).await,
        ct::MATRIX => probe_matrix(get_str("homeserverUrl"), get_str("accessToken")).await,
        ct::GOOGLECHAT => probe_googlechat(get_str("webhookUrl")).await,
        ct::EMAIL => {
            let host = get_str("imapHost");
            let port = credentials
                .get("imapPort")
                .and_then(|v| v.as_u64())
                .unwrap_or(993) as u16;
            probe_email(host, port).await
        }
        ct::WECOM => {
            let websocket_url = credentials
                .get("websocketUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("wss://openws.work.weixin.qq.com");
            probe_wecom(websocket_url, get_str("botId")).await
        }
        ct::WEIXIN => {
            let base_url = credentials
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("https://ilinkai.weixin.qq.com");
            probe_weixin(base_url, get_str("botAccountId")).await
        }
        _ => ProbeResult::failure(format!("Unknown channel type: {}", channel_type), 0),
    }
}
