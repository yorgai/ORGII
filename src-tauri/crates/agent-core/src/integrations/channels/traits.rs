//! Base trait for chat channel implementations.

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::bus::{InboundMessage, OutboundMessage};

/// Abstract trait for chat channel integrations.
///
/// Each channel implementation handles connecting to an external service
/// (Telegram, Discord, etc.), receiving messages, and sending responses.
#[async_trait]
pub trait Channel: Send + Sync {
    /// Channel name including account ID (e.g., "telegram:default", "discord:work").
    fn name(&self) -> String;

    /// Start the channel, begin receiving messages.
    ///
    /// The channel should push received messages to the `inbound_tx` sender.
    /// It should listen for outbound messages on its own broadcast receiver.
    async fn start(&mut self, inbound_tx: mpsc::Sender<InboundMessage>)
        -> Result<(), ChannelError>;

    /// Stop the channel gracefully.
    async fn stop(&mut self) -> Result<(), ChannelError>;

    /// Send a message through the channel.
    async fn send(&self, msg: &OutboundMessage) -> Result<(), ChannelError>;

    /// Check if the channel is currently connected to the remote service.
    ///
    /// For channels with persistent connections (e.g., WebSocket), this should
    /// reflect actual connectivity, not just whether `start()` was called.
    fn is_connected(&self) -> bool;

    /// Whether the channel's background loop is active (started and not stopped).
    ///
    /// Used by the manager for lifecycle operations (stop, restart).
    /// Defaults to `is_connected()` which is correct for channels where
    /// "running" and "connected" are equivalent.
    fn is_active(&self) -> bool {
        self.is_connected()
    }

    /// Last error encountered by this channel, if any.
    ///
    /// Used for status reporting to the frontend.
    fn last_error(&self) -> Option<String> {
        None
    }

    /// Signal that the agent is processing a message (e.g., typing indicator).
    ///
    /// Default: no-op. Channels that support typing indicators (e.g., Feishu
    /// emoji reactions) can override this.
    async fn on_processing_start(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> Result<(), ChannelError> {
        Ok(())
    }

    /// Signal that the agent finished processing.
    ///
    /// Default: no-op.
    async fn on_processing_end(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> Result<(), ChannelError> {
        Ok(())
    }

    /// Update a previously sent message (for streaming or corrections).
    ///
    /// Default: not supported.
    async fn update_message(&self, _message_id: &str, _content: &str) -> Result<(), ChannelError> {
        Err(ChannelError::Other(
            "Message update not supported by this channel".into(),
        ))
    }

    /// Maximum message body length in Unicode code-points (or UTF-16 units
    /// when `use_utf16_len()` returns `true`).
    ///
    /// The delivery layer calls `split_message()` with this limit before
    /// calling `send()`. Channels that have no meaningful limit can leave the
    /// default (0 = no splitting).
    fn max_message_chars(&self) -> usize {
        0
    }

    /// Whether `max_message_chars()` is measured in UTF-16 code units instead
    /// of Unicode code-points (e.g. Telegram's 4 096-unit limit).
    fn use_utf16_len(&self) -> bool {
        false
    }

    /// How often the channel's typing indicator must be refreshed.
    ///
    /// Returns `None` if no periodic refresh is needed.
    /// Returns `Some(Duration)` if `on_processing_start` must be called
    /// repeatedly (e.g. every 4 s for Telegram/WeCom where typing expires).
    fn typing_refresh_interval(&self) -> Option<std::time::Duration> {
        None
    }
}

/// Error type for channel operations.
#[derive(Debug)]
pub enum ChannelError {
    /// Connection to the service failed.
    ConnectionFailed(String),
    /// Authentication failed (invalid token/key).
    AuthFailed(String),
    /// Message sending failed.
    SendFailed(String),
    /// Channel configuration is missing or invalid.
    ConfigError(String),
    /// Generic error.
    Other(String),
}

impl std::fmt::Display for ChannelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChannelError::ConnectionFailed(msg) => write!(formatter, "Connection failed: {}", msg),
            ChannelError::AuthFailed(msg) => write!(formatter, "Auth failed: {}", msg),
            ChannelError::SendFailed(msg) => write!(formatter, "Send failed: {}", msg),
            ChannelError::ConfigError(msg) => write!(formatter, "Config error: {}", msg),
            ChannelError::Other(msg) => write!(formatter, "Channel error: {}", msg),
        }
    }
}

impl std::error::Error for ChannelError {}
