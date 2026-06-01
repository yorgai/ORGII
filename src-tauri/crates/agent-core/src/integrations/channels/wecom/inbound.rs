//! Inbound message handling: payload parsing, allow-list policy gating, text extraction.

use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error};

use super::protocol::{payload_req_id, WeComState, MAX_MESSAGE_LEN};
use crate::bus::InboundMessage;
use crate::integrations::channels::config::is_peer_allowed;

#[allow(clippy::too_many_arguments)]
pub(super) async fn on_inbound_message(
    payload: &Value,
    dm_policy: &str,
    allow_from: &[String],
    group_policy: &str,
    group_allow_from: &[String],
    state: &Arc<Mutex<WeComState>>,
    inbound_tx: &mpsc::Sender<InboundMessage>,
    channel_name: &str,
) {
    let body = match payload.get("body").and_then(|b| b.as_object()) {
        Some(b) => b,
        None => return,
    };

    let inbound_req_id = payload_req_id(payload);

    let sender_id = body
        .get("from")
        .and_then(|f| f.as_object())
        .and_then(|f| f.get("userid"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let chat_id = body
        .get("chatid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(sender_id.as_str())
        .trim()
        .to_string();

    if chat_id.is_empty() {
        debug!("[{}] Missing chat_id, skipping", channel_name);
        return;
    }

    let is_group = body
        .get("chattype")
        .and_then(|v| v.as_str())
        .map(|s| s.to_lowercase() == "group")
        .unwrap_or(false);

    if is_group {
        if !is_peer_allowed(group_policy, group_allow_from, &chat_id, "wecom-group") {
            debug!("[{}] Group {} blocked by policy", channel_name, chat_id);
            return;
        }
    } else if !is_peer_allowed(dm_policy, allow_from, &sender_id, "wecom-dm") {
        debug!(
            "[{}] DM sender {} blocked by policy",
            channel_name, sender_id
        );
        return;
    }

    let text = extract_text(body);
    if text.is_empty() {
        debug!("[{}] Empty message, skipping", channel_name);
        return;
    }

    // Remember inbound req_id keyed by chat_id so the next outbound can use
    // `aibot_respond_msg` for a correlated reply.
    {
        let mut st = state.lock().await;
        st.remember(&chat_id, &inbound_req_id);
    }

    let inbound = InboundMessage::new(channel_name, &sender_id, &chat_id, &text);
    if let Err(err) = inbound_tx.send(inbound).await {
        error!(
            "[{}] Failed to queue inbound message: {}",
            channel_name, err
        );
    }
}

// ── Text extraction ───────────────────────────────────────────────────────────

fn extract_text(body: &serde_json::Map<String, Value>) -> String {
    let msgtype = body
        .get("msgtype")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    let mut parts: Vec<&str> = Vec::new();

    if msgtype == "mixed" {
        if let Some(items) = body
            .get("mixed")
            .and_then(|m| m.get("msg_item"))
            .and_then(|i| i.as_array())
        {
            for item in items {
                if item
                    .get("msgtype")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase() == "text")
                    .unwrap_or(false)
                {
                    if let Some(content) = item
                        .get("text")
                        .and_then(|t| t.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        let trimmed = content.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed);
                        }
                    }
                }
            }
        }
    } else {
        if let Some(content) = body
            .get("text")
            .and_then(|t| t.get("content"))
            .and_then(|c| c.as_str())
        {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed);
            }
        }

        // Voice transcription
        if msgtype == "voice" {
            if let Some(content) = body
                .get("voice")
                .and_then(|v| v.get("content"))
                .and_then(|c| c.as_str())
            {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed);
                }
            }
        }

        // appmsg title (AI Bot file attachments)
        if msgtype == "appmsg" {
            if let Some(title) = body
                .get("appmsg")
                .and_then(|a| a.get("title"))
                .and_then(|t| t.as_str())
            {
                let trimmed = title.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed);
                }
            }
        }
    }

    let joined = parts.join("\n");
    if joined.len() > MAX_MESSAGE_LEN {
        let mut end = MAX_MESSAGE_LEN;
        while end > 0 && !joined.is_char_boundary(end) {
            end -= 1;
        }
        joined[..end].to_string()
    } else {
        joined
    }
}
