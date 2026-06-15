//! Personal WeChat (Weixin) channel via Tencent's iLink Bot API.
//!
//! Minimal viable implementation:
//! - Long-poll `ilink/bot/getupdates` for inbound messages
//! - Send replies via `ilink/bot/sendmessage`
//! - Track `context_token` per peer (required to keep the conversation thread
//!   alive on the iLink side)
//! - DM allowlist + group allowlist policies
//!
//! Out of scope (deferred — not needed for first user smoke test):
//! - QR login flow (user obtains `token` and `botAccountId` out of band, e.g.
//!   via the hermes-agent CLI tooling)
//! - AES-128-ECB encrypted media upload/download
//! - Voice transcription / file attachments
//!
//! Reference: hermes-agent `gateway/platforms/weixin.py`.

use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::config::{is_peer_allowed, WeixinAccountConfig};
use super::traits::{Channel, ChannelError};
use crate::bus::{InboundMessage, OutboundMessage};
use crate::utils::build_http_client;

// ── Protocol constants ────────────────────────────────────────────────────────

const ILINK_APP_ID: &str = "bot";
const CHANNEL_VERSION: &str = "2.2.0";
/// (2 << 16) | (2 << 8) | 0 — matches hermes-agent.
const ILINK_APP_CLIENT_VERSION: u32 = (2 << 16) | (2 << 8);

const EP_GET_UPDATES: &str = "ilink/bot/getupdates";
const EP_SEND_MESSAGE: &str = "ilink/bot/sendmessage";

pub(super) const ITEM_TEXT: i32 = 1;
pub(super) const ITEM_IMAGE: i32 = 2;
const ITEM_VOICE: i32 = 3;
const ITEM_FILE: i32 = 4;
const ITEM_VIDEO: i32 = 5;

const MSG_TYPE_BOT: i32 = 2;
const MSG_STATE_FINISH: i32 = 2;

const LONG_POLL_TIMEOUT_MS: u64 = 25_000;
const SEND_TIMEOUT_SECS: u64 = 30;
const MAX_DEDUP_CACHE: usize = 1000;
const MAX_TOKEN_CACHE: usize = 1000;
const MAX_MESSAGE_LEN: usize = 2000;

// ── Per-account state ─────────────────────────────────────────────────────────

pub(super) struct WeixinState {
    /// Maps peer id → latest `context_token`.
    context_tokens: HashMap<String, String>,
    /// Recent inbound `message_id`s (FIFO) for deduplication.
    recent_msg_ids: Vec<String>,
}

impl WeixinState {
    pub(super) fn new() -> Self {
        Self {
            context_tokens: HashMap::new(),
            recent_msg_ids: Vec::new(),
        }
    }

    fn set_token(&mut self, peer: &str, token: &str) {
        if peer.is_empty() || token.is_empty() {
            return;
        }
        while self.context_tokens.len() >= MAX_TOKEN_CACHE {
            if let Some(first_key) = self.context_tokens.keys().next().cloned() {
                self.context_tokens.remove(&first_key);
            }
        }
        self.context_tokens
            .insert(peer.to_string(), token.to_string());
    }

    fn get_token(&self, peer: &str) -> Option<String> {
        self.context_tokens.get(peer).cloned()
    }

    pub(super) fn dedup(&mut self, msg_id: &str) -> bool {
        if msg_id.is_empty() {
            return false;
        }
        if self.recent_msg_ids.iter().any(|id| id == msg_id) {
            return true;
        }
        if self.recent_msg_ids.len() >= MAX_DEDUP_CACHE {
            self.recent_msg_ids.remove(0);
        }
        self.recent_msg_ids.push(msg_id.to_string());
        false
    }
}

// ── Channel struct ────────────────────────────────────────────────────────────

pub struct WeixinChannel {
    account_id: String,
    config: WeixinAccountConfig,
    client: Client,
    running: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    last_error: Arc<RwLock<Option<String>>>,
    state: Arc<Mutex<WeixinState>>,
    poll_handle: Option<tokio::task::JoinHandle<()>>,
}

impl WeixinChannel {
    pub fn new(account_id: String, config: WeixinAccountConfig) -> Self {
        let client = build_http_client(std::time::Duration::from_secs(60));
        Self {
            account_id,
            config,
            client,
            running: Arc::new(AtomicBool::new(false)),
            connected: Arc::new(AtomicBool::new(false)),
            last_error: Arc::new(RwLock::new(None)),
            state: Arc::new(Mutex::new(WeixinState::new())),
            poll_handle: None,
        }
    }

    fn channel_name(&self) -> String {
        format!("weixin:{}", self.account_id)
    }
}

#[async_trait]
impl Channel for WeixinChannel {
    fn name(&self) -> String {
        self.channel_name()
    }

    async fn start(
        &mut self,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) -> Result<(), ChannelError> {
        if self.config.token.is_empty() {
            return Err(ChannelError::ConfigError(
                "Weixin token is empty (run QR login first to obtain a bot token)".into(),
            ));
        }

        self.running.store(true, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        *self.last_error.write().await = None;

        let running = self.running.clone();
        let connected = self.connected.clone();
        let last_error = self.last_error.clone();
        let state = self.state.clone();
        let client = self.client.clone();
        let channel_name = self.channel_name();
        let token = self.config.token.clone();
        let base_url = self.config.base_url.trim_end_matches('/').to_string();
        let bot_account_id = self.config.bot_account_id.clone();
        let dm_policy = self.config.dm_policy.clone();
        let allow_from = self.config.allow_from.clone();
        let group_policy = self.config.group_policy.clone();
        let group_allow_from = self.config.group_allow_from.clone();

        let handle = tokio::spawn(async move {
            poll_loop(
                client,
                base_url,
                token,
                bot_account_id,
                dm_policy,
                allow_from,
                group_policy,
                group_allow_from,
                running,
                connected,
                last_error,
                state,
                inbound_tx,
                channel_name,
            )
            .await;
        });

        self.poll_handle = Some(handle);
        info!("[weixin:{}] Channel started", self.account_id);
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.running.store(false, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        if let Some(handle) = self.poll_handle.take() {
            handle.abort();
        }
        info!("[weixin:{}] Channel stopped", self.account_id);
        Ok(())
    }

    async fn send(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
        let context_token = {
            let st = self.state.lock().await;
            st.get_token(&msg.chat_id)
        };

        // Post-clip empty guard: the central empty-outbound drop in
        // `ChannelManager::send_to{_with_delivery}` already skips
        // empty-content sends. This covers the narrower case where
        // clip_utf8 truncates to empty (e.g., content was only
        // non-printable chars that collapsed after UTF-8 clamping).
        let content = clip_utf8(&msg.content, MAX_MESSAGE_LEN);
        if content.trim().is_empty() {
            return Ok(());
        }

        let client_id = format!("orgii-weixin-{}", Uuid::new_v4().simple());
        let mut message = serde_json::json!({
            "from_user_id": "",
            "to_user_id": msg.chat_id,
            "client_id": client_id,
            "message_type": MSG_TYPE_BOT,
            "message_state": MSG_STATE_FINISH,
            "item_list": [{
                "type": ITEM_TEXT,
                "text_item": { "text": content },
            }],
        });
        if let Some(ct) = context_token {
            if let Some(obj) = message.as_object_mut() {
                obj.insert("context_token".into(), Value::String(ct));
            }
        }

        let payload = serde_json::json!({ "msg": message });
        let url = format!(
            "{}/{}",
            self.config.base_url.trim_end_matches('/'),
            EP_SEND_MESSAGE
        );

        api_post(
            &self.client,
            &url,
            &self.config.token,
            payload,
            std::time::Duration::from_secs(SEND_TIMEOUT_SECS),
        )
        .await
        .map_err(ChannelError::SendFailed)?;

        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.running.load(Ordering::Relaxed) && self.connected.load(Ordering::Relaxed)
    }

    fn is_active(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    fn last_error(&self) -> Option<String> {
        self.last_error
            .try_read()
            .ok()
            .and_then(|guard| guard.clone())
    }

    fn max_message_chars(&self) -> usize {
        MAX_MESSAGE_LEN
    }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn poll_loop(
    client: Client,
    base_url: String,
    token: String,
    bot_account_id: String,
    dm_policy: String,
    allow_from: Vec<String>,
    group_policy: String,
    group_allow_from: Vec<String>,
    running: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    last_error: Arc<RwLock<Option<String>>>,
    state: Arc<Mutex<WeixinState>>,
    inbound_tx: mpsc::Sender<InboundMessage>,
    channel_name: String,
) {
    let mut sync_buf = String::new();
    let url = format!("{}/{}", base_url, EP_GET_UPDATES);
    let mut consecutive_failures = 0u32;

    while running.load(Ordering::Relaxed) {
        let payload = serde_json::json!({ "get_updates_buf": sync_buf });

        match api_post(
            &client,
            &url,
            &token,
            payload,
            std::time::Duration::from_millis(LONG_POLL_TIMEOUT_MS + 5_000),
        )
        .await
        {
            Ok(response) => {
                connected.store(true, Ordering::Relaxed);
                *last_error.write().await = None;
                consecutive_failures = 0;

                if let Some(buf) = response
                    .get("get_updates_buf")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    sync_buf = buf.to_string();
                }

                if let Some(msgs) = response.get("msgs").and_then(|v| v.as_array()) {
                    for msg in msgs {
                        process_inbound(
                            msg,
                            &bot_account_id,
                            &dm_policy,
                            &allow_from,
                            &group_policy,
                            &group_allow_from,
                            &state,
                            &inbound_tx,
                            &channel_name,
                        )
                        .await;
                    }
                }
            }
            Err(err) => {
                connected.store(false, Ordering::Relaxed);
                consecutive_failures += 1;
                let msg = format!("Weixin getupdates failed: {}", err);
                warn!("[{}] {}", channel_name, msg);
                *last_error.write().await = Some(msg);
                let backoff = 2u64.saturating_mul(consecutive_failures.min(5) as u64);
                tokio::time::sleep(std::time::Duration::from_secs(backoff.max(2))).await;
            }
        }
    }

    info!("[{}] Poll loop exited", channel_name);
}

// ── Inbound processing ────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn process_inbound(
    msg: &Value,
    bot_account_id: &str,
    dm_policy: &str,
    allow_from: &[String],
    group_policy: &str,
    group_allow_from: &[String],
    state: &Arc<Mutex<WeixinState>>,
    inbound_tx: &mpsc::Sender<InboundMessage>,
    channel_name: &str,
) {
    let sender_id = msg
        .get("from_user_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if sender_id.is_empty() {
        return;
    }
    if !bot_account_id.is_empty() && sender_id == bot_account_id {
        // Echo of our own outbound message — skip.
        return;
    }

    let message_id = msg
        .get("message_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    {
        let mut st = state.lock().await;
        if st.dedup(&message_id) {
            return;
        }
    }

    // Determine chat type and effective chat id.
    let to_user_id = msg
        .get("to_user_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let room_id = msg
        .get("room_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let (is_group, chat_id) = if !room_id.is_empty() {
        (true, room_id)
    } else if !to_user_id.is_empty() && to_user_id != bot_account_id {
        // Group conversations sometimes encode the room as `to_user_id`.
        (true, to_user_id)
    } else {
        (false, sender_id.clone())
    };

    if is_group {
        if !is_allowed(group_policy, group_allow_from, &chat_id) {
            debug!("[{}] Group {} blocked by policy", channel_name, chat_id);
            return;
        }
    } else if !is_allowed(dm_policy, allow_from, &sender_id) {
        debug!(
            "[{}] DM sender {} blocked by policy",
            channel_name, sender_id
        );
        return;
    }

    // Capture context_token for the next outbound reply.
    if let Some(ct) = msg
        .get("context_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        let mut st = state.lock().await;
        st.set_token(&chat_id, ct);
    }

    let item_list = msg
        .get("item_list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let text = extract_text(&item_list);
    if text.trim().is_empty() {
        debug!("[{}] No text content, skipping", channel_name);
        return;
    }

    let inbound = InboundMessage::new(channel_name, &sender_id, &chat_id, &text);
    if let Err(err) = inbound_tx.send(inbound).await {
        error!(
            "[{}] Failed to forward inbound message: {}",
            channel_name, err
        );
    }
}

pub(super) fn extract_text(items: &[Value]) -> String {
    let mut out: Vec<String> = Vec::new();
    for item in items {
        let item_type = item.get("type").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        match item_type {
            t if t == ITEM_TEXT => {
                if let Some(text) = item
                    .get("text_item")
                    .and_then(|t| t.get("text"))
                    .and_then(|v| v.as_str())
                {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        out.push(trimmed.to_string());
                    }
                }
            }
            t if t == ITEM_IMAGE => out.push("[图片]".to_string()),
            t if t == ITEM_VOICE => out.push("[语音]".to_string()),
            t if t == ITEM_FILE => out.push("[文件]".to_string()),
            t if t == ITEM_VIDEO => out.push("[视频]".to_string()),
            _ => {}
        }
    }
    out.join("\n")
}

pub(super) fn is_allowed(policy: &str, allow_list: &[String], peer: &str) -> bool {
    is_peer_allowed(policy, allow_list, peer, "weixin")
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async fn api_post(
    client: &Client,
    url: &str,
    token: &str,
    mut payload: serde_json::Value,
    timeout: std::time::Duration,
) -> Result<Value, String> {
    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            "base_info".into(),
            serde_json::json!({ "channel_version": CHANNEL_VERSION }),
        );
    }
    let body = serde_json::to_string(&payload).map_err(|err| err.to_string())?;
    let body_len = body.len();

    let resp = client
        .post(url)
        .timeout(timeout)
        .header("Content-Type", "application/json")
        .header("AuthorizationType", "ilink_bot_token")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Length", body_len.to_string())
        .header("X-WECHAT-UIN", random_wechat_uin())
        .header("iLink-App-Id", ILINK_APP_ID)
        .header(
            "iLink-App-ClientVersion",
            ILINK_APP_CLIENT_VERSION.to_string(),
        )
        .body(body)
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let status = resp.status();
    let text = crate::utils::response_text_or_read_error(resp).await;
    if !status.is_success() {
        return Err(format!(
            "HTTP {}: {}",
            status,
            crate::utils::safe_truncate_chars(text, 200).to_string()
        ));
    }
    serde_json::from_str::<Value>(&text).map_err(|err| format!("JSON parse failed: {}", err))
}

fn random_wechat_uin() -> String {
    // iLink gateway only needs a plausible 10-digit numeric header; use nanos
    // + pid for variability without pulling in a random-number dep.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    let mixed = 1_000_000_000 + ((nanos.wrapping_mul(2_654_435_761) ^ pid) % 9_000_000_000);
    mixed.to_string()
}

fn clip_utf8(s: &str, max_bytes: usize) -> String {
    crate::utils::safe_truncate_utf8(s, max_bytes).to_string()
}

#[cfg(test)]
#[path = "tests/weixin_tests.rs"]
mod tests;
