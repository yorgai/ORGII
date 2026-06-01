//! Event types for the message bus.
//!
//! Defines the message structs that flow between channels and the agent core.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ============================================
// Inbound Message (Channel -> Agent)
// ============================================

/// Message received from a chat channel or the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundMessage {
    /// Source channel (e.g., "telegram", "discord", "cli", "tauri", "system").
    pub channel: String,
    /// User identifier within the channel.
    pub sender_id: String,
    /// Chat/conversation identifier within the channel.
    pub chat_id: String,
    /// Message text content.
    pub content: String,
    /// When the message was created.
    #[serde(default = "Utc::now")]
    pub timestamp: DateTime<Utc>,
    /// Attached media file paths (images, audio, etc.).
    #[serde(default)]
    pub media: Vec<String>,
    /// Channel-specific metadata.
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
    /// Optional override for session_key().
    /// When set, this value is used instead of `{channel}:{chat_id}`.
    /// Used by channel/gateway dispatch so Tauri frontend events have a matching session_id.
    #[serde(default)]
    pub session_key_override: Option<String>,
}

impl InboundMessage {
    /// Create a new inbound message.
    pub fn new(channel: &str, sender_id: &str, chat_id: &str, content: &str) -> Self {
        Self {
            channel: channel.to_string(),
            sender_id: sender_id.to_string(),
            chat_id: chat_id.to_string(),
            content: content.to_string(),
            timestamp: Utc::now(),
            media: Vec::new(),
            metadata: HashMap::new(),
            session_key_override: None,
        }
    }

    /// Unique key for session identification.
    ///
    /// Returns `session_key_override` if set, otherwise `{channel}:{chat_id}`.
    pub fn session_key(&self) -> String {
        if let Some(ref override_key) = self.session_key_override {
            return override_key.clone();
        }
        format!("{}:{}", self.channel, self.chat_id)
    }
}

// ============================================
// Outbound Message (Agent -> Channel)
// ============================================

/// Message to send to a chat channel or the Tauri frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundMessage {
    /// Target channel.
    pub channel: String,
    /// Target chat/conversation ID.
    pub chat_id: String,
    /// Message text content.
    pub content: String,
    /// Optional: ID of the message being replied to.
    pub reply_to: Option<String>,
    /// Attached media file paths.
    #[serde(default)]
    pub media: Vec<String>,
    /// Channel-specific metadata.
    #[serde(default)]
    pub metadata: HashMap<String, Value>,
}

impl OutboundMessage {
    /// Create a new outbound message.
    pub fn new(channel: &str, chat_id: &str, content: &str) -> Self {
        Self {
            channel: channel.to_string(),
            chat_id: chat_id.to_string(),
            content: content.to_string(),
            reply_to: None,
            media: Vec::new(),
            metadata: HashMap::new(),
        }
    }
}
