//! Wire-level WeCom AI Bot protocol primitives.
//!
//! - Application command names sent over the WebSocket
//! - Tunable timing constants (heartbeat, handshake timeout, reconnect backoff)
//! - `req_id` helpers used by every outgoing frame
//! - `WeComState` — reply-correlation map (chat_id → latest inbound req_id)

use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

// ── Application commands ──────────────────────────────────────────────────────

pub(super) const APP_CMD_SUBSCRIBE: &str = "aibot_subscribe";
pub(super) const APP_CMD_CALLBACK: &str = "aibot_msg_callback";
pub(super) const APP_CMD_LEGACY_CALLBACK: &str = "aibot_callback";
pub(super) const APP_CMD_PING: &str = "ping";

// ── Tunables ──────────────────────────────────────────────────────────────────

pub(super) const MAX_MESSAGE_LEN: usize = 4000;
pub(super) const HEARTBEAT_SECS: u64 = 30;
pub(super) const RECONNECT_BACKOFF_SECS: &[u64] = &[2, 5, 10, 30, 60];
pub(super) const HANDSHAKE_TIMEOUT_SECS: u64 = 20;

/// Maximum number of inbound `req_id`s remembered for correlated replies.
pub(super) const MAX_REPLY_IDS: usize = 1000;

// ── Reply-correlation state ───────────────────────────────────────────────────

/// Shared mutable state that must survive across reconnects.
///
/// Maps `chat_id → latest inbound req_id`, so the next outbound message in that
/// chat can use `aibot_respond_msg` instead of `aibot_send_msg`.
pub(super) struct WeComState {
    reply_req_ids: HashMap<String, String>,
}

impl WeComState {
    pub(super) fn new() -> Self {
        Self {
            reply_req_ids: HashMap::new(),
        }
    }

    pub(super) fn remember(&mut self, chat_id: &str, req_id: &str) {
        if chat_id.is_empty() || req_id.is_empty() {
            return;
        }
        while self.reply_req_ids.len() >= MAX_REPLY_IDS {
            if let Some(first_key) = self.reply_req_ids.keys().next().cloned() {
                self.reply_req_ids.remove(&first_key);
            }
        }
        self.reply_req_ids
            .insert(chat_id.to_string(), req_id.to_string());
    }

    pub(super) fn take(&mut self, chat_id: &str) -> Option<String> {
        self.reply_req_ids.remove(chat_id)
    }
}

// ── req_id helpers ────────────────────────────────────────────────────────────

pub(super) fn payload_req_id(payload: &Value) -> String {
    payload
        .get("headers")
        .and_then(|h| h.get("req_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

pub(super) fn new_req_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4().simple())
}
