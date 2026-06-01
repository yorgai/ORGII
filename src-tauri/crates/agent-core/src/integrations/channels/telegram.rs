//! Telegram channel implementation.
//!
//! Uses the Telegram Bot API with long polling via reqwest.

use async_trait::async_trait;
use reqwest::Client;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use super::config::TelegramAccountConfig;
use crate::bus::{InboundMessage, OutboundMessage};
use crate::utils::build_http_client_with_proxy;

use super::traits::{Channel, ChannelError};

/// Telegram Bot API channel (single account instance).
pub struct TelegramChannel {
    account_id: String,
    config: TelegramAccountConfig,
    client: Client,
    running: Arc<AtomicBool>,
    poll_handle: Option<tokio::task::JoinHandle<()>>,
}

impl TelegramChannel {
    pub fn new(account_id: String, config: TelegramAccountConfig) -> Self {
        let client = build_http_client_with_proxy(
            std::time::Duration::from_secs(60),
            config.proxy.as_deref(),
        );

        Self {
            account_id,
            config,
            client,
            running: Arc::new(AtomicBool::new(false)),
            poll_handle: None,
        }
    }

    fn api_url(&self, method: &str) -> String {
        format!(
            "https://api.telegram.org/bot{}/{}",
            self.config.token, method
        )
    }

    /// Channel name including account id for multi-account routing.
    fn channel_name(&self) -> String {
        format!("telegram:{}", self.account_id)
    }
}

#[async_trait]
impl Channel for TelegramChannel {
    fn name(&self) -> String {
        self.channel_name()
    }

    async fn start(
        &mut self,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) -> Result<(), ChannelError> {
        if self.config.token.is_empty() {
            return Err(ChannelError::ConfigError(
                "Telegram bot token is empty".into(),
            ));
        }

        self.running.store(true, Ordering::Relaxed);
        let running = self.running.clone();
        let client = self.client.clone();
        let token = self.config.token.clone();
        let allow_from = self.config.allow_from.clone();
        let channel_name = self.channel_name();
        let api_base = format!("https://api.telegram.org/bot{}", token);

        let handle = tokio::spawn(async move {
            let mut last_update_id: i64 = 0;

            while running.load(Ordering::Relaxed) {
                let url = format!(
                    "{}/getUpdates?offset={}&timeout=30",
                    api_base,
                    last_update_id + 1
                );

                match client.get(&url).send().await {
                    Ok(response) => {
                        if let Ok(body) = response.json::<Value>().await {
                            if let Some(updates) = body.get("result").and_then(|r| r.as_array()) {
                                for update in updates {
                                    if let Some(update_id) =
                                        update.get("update_id").and_then(|u| u.as_i64())
                                    {
                                        last_update_id = update_id;
                                    }

                                    // Extract message
                                    let message = update
                                        .get("message")
                                        .or_else(|| update.get("edited_message"));
                                    let Some(msg) = message else { continue };

                                    let text =
                                        msg.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                    if text.is_empty() {
                                        continue;
                                    }

                                    let chat_id = msg
                                        .get("chat")
                                        .and_then(|c| c.get("id"))
                                        .and_then(|i| i.as_i64())
                                        .unwrap_or(0);
                                    let sender_id = msg
                                        .get("from")
                                        .and_then(|f| f.get("id"))
                                        .and_then(|i| i.as_i64())
                                        .unwrap_or(0);
                                    let sender_str = sender_id.to_string();

                                    // Check allow list
                                    if !allow_from.is_empty() && !allow_from.contains(&sender_str) {
                                        continue;
                                    }

                                    let inbound = InboundMessage::new(
                                        &channel_name,
                                        &sender_str,
                                        &chat_id.to_string(),
                                        text,
                                    );

                                    if let Err(err) = inbound_tx.send(inbound).await {
                                        error!("Failed to send inbound message: {}", err);
                                    }
                                }
                            }
                        }
                    }
                    Err(err) => {
                        warn!("Telegram polling error: {}", err);
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });

        self.poll_handle = Some(handle);
        info!("Telegram channel started");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.running.store(false, Ordering::Relaxed);
        if let Some(handle) = self.poll_handle.take() {
            handle.abort();
        }
        info!("Telegram channel stopped");
        Ok(())
    }

    async fn send(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
        let url = self.api_url("sendMessage");

        // Telegram's legacy "Markdown" parser rejects messages with unbalanced
        // `_`, `*`, ``` `` ``, or `[` characters — common in agent output. If
        // the content looks like Markdown we try that first; on a 400 response
        // we retry without `parse_mode` as plain text so the user always gets
        // the message.
        let looks_markdown = content_looks_like_markdown(&msg.content);

        if looks_markdown {
            let body = serde_json::json!({
                "chat_id": msg.chat_id,
                "text": msg.content,
                "parse_mode": "Markdown",
            });
            let response = self
                .client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|err| ChannelError::SendFailed(err.to_string()))?;

            if response.status().is_success() {
                return Ok(());
            }

            // Retry without parse_mode on client-side formatting errors.
            if response.status().as_u16() == 400 {
                warn!(
                    "[telegram:{}] Markdown parse rejected; retrying as plain text",
                    self.account_id
                );
            } else {
                let status = response.status();
                let text = crate::utils::response_text_or_read_error(response).await;
                return Err(ChannelError::SendFailed(format!(
                    "Telegram sendMessage HTTP {}: {}",
                    status, text
                )));
            }
        }

        let body = serde_json::json!({
            "chat_id": msg.chat_id,
            "text": msg.content,
        });

        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|err| ChannelError::SendFailed(err.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = crate::utils::response_text_or_read_error(response).await;
            return Err(ChannelError::SendFailed(format!(
                "Telegram sendMessage HTTP {}: {}",
                status, text
            )));
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    // Telegram's message length limit is 4 096 UTF-16 code units.
    fn max_message_chars(&self) -> usize {
        4096
    }

    fn use_utf16_len(&self) -> bool {
        true
    }

    fn typing_refresh_interval(&self) -> Option<std::time::Duration> {
        // Telegram typing indicator expires after ~5 s; refresh every 4 s.
        Some(std::time::Duration::from_secs(4))
    }
}

/// Heuristic: only enable Markdown parsing when the content contains at least
/// one balanced Markdown construct. Keeps plain prose (including Chinese text
/// with `*`/`_` used as regular characters) from being rejected by Telegram.
fn content_looks_like_markdown(text: &str) -> bool {
    let has_fenced_code = text.contains("```");
    let has_inline_code = count_char(text, '`') >= 2 && !has_fenced_code;
    let has_link = text.contains("](") && text.contains('[');
    let has_bold = count_char(text, '*') >= 2;
    let has_italic = count_char(text, '_') >= 2;

    has_fenced_code || has_inline_code || has_link || has_bold || has_italic
}

fn count_char(text: &str, c: char) -> usize {
    text.chars().filter(|&ch| ch == c).count()
}

#[cfg(test)]
mod tests {
    use super::content_looks_like_markdown;

    #[test]
    fn plain_text_is_not_markdown() {
        assert!(!content_looks_like_markdown("hello there"));
        assert!(!content_looks_like_markdown("你好，今天怎么样？"));
        assert!(!content_looks_like_markdown("single * char only"));
    }

    #[test]
    fn fenced_code_is_markdown() {
        assert!(content_looks_like_markdown("```rust\nfn main() {}\n```"));
    }

    #[test]
    fn bold_is_markdown() {
        assert!(content_looks_like_markdown("this is *bold* text"));
    }

    #[test]
    fn link_is_markdown() {
        assert!(content_looks_like_markdown(
            "see [docs](https://example.com)"
        ));
    }
}
