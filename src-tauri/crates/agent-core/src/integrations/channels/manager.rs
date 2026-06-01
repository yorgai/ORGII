//! Channel lifecycle manager.
//!
//! Manages starting, stopping, and monitoring of all chat channel integrations.

use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::bus::{InboundMessage, OutboundMessage};

use super::delivery::{send_with_retry, split_message, utf16_len};
use super::traits::{Channel, ChannelError};

/// Manages the lifecycle of all chat channels.
pub struct ChannelManager {
    channels: HashMap<String, Box<dyn Channel>>,
    inbound_tx: mpsc::Sender<InboundMessage>,
}

impl ChannelManager {
    /// Create a new channel manager.
    pub fn new(inbound_tx: mpsc::Sender<InboundMessage>) -> Self {
        Self {
            channels: HashMap::new(),
            inbound_tx,
        }
    }

    /// Register a channel.
    pub fn register(&mut self, channel: Box<dyn Channel>) {
        self.channels.insert(channel.name().to_string(), channel);
    }

    /// Start all registered channels.
    ///
    /// Only pre-filtered enabled accounts should be registered, so this
    /// starts everything that was registered.
    pub async fn start_all(&mut self) -> Vec<(String, Result<(), ChannelError>)> {
        let mut results = Vec::new();

        for (name, channel) in &mut self.channels {
            info!("Starting channel: {}", name);
            let result = channel.start(self.inbound_tx.clone()).await;
            match &result {
                Ok(()) => info!("Channel {} started", name),
                Err(err) => error!("Failed to start channel {}: {}", name, err),
            }
            results.push((name.clone(), result));
        }

        results
    }

    /// Stop all active channels.
    pub async fn stop_all(&mut self) {
        for (name, channel) in &mut self.channels {
            if channel.is_active() {
                info!("Stopping channel: {}", name);
                if let Err(err) = channel.stop().await {
                    error!("Failed to stop channel {}: {}", name, err);
                }
            }
        }
    }

    /// Start a single channel by name. If already active, no-op.
    pub async fn start_channel(
        &mut self,
        name: &str,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) -> Result<(), ChannelError> {
        let channel = self
            .channels
            .get_mut(name)
            .ok_or_else(|| ChannelError::Other(format!("Channel '{}' not registered", name)))?;
        if channel.is_active() {
            return Ok(());
        }
        channel.start(inbound_tx).await
    }

    /// Stop a single channel by name. If not active, no-op.
    pub async fn stop_channel(&mut self, name: &str) -> Result<(), ChannelError> {
        let channel = self
            .channels
            .get_mut(name)
            .ok_or_else(|| ChannelError::Other(format!("Channel '{}' not registered", name)))?;
        if !channel.is_active() {
            return Ok(());
        }
        channel.stop().await
    }

    /// Add and start a new channel. If a channel with the same name exists, stop it first.
    pub async fn add_and_start_channel(
        &mut self,
        channel: Box<dyn Channel>,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) -> Result<(), ChannelError> {
        let name = channel.name();
        if let Some(existing) = self.channels.get_mut(&name) {
            if existing.is_active() {
                if let Err(err) = existing.stop().await {
                    warn!(
                        "Failed to stop existing channel {} before replacing: {}",
                        name, err
                    );
                }
            }
        }
        self.channels.insert(name.clone(), channel);
        self.start_channel(&name, inbound_tx).await
    }

    /// Remove and stop a channel by name.
    pub async fn remove_channel(&mut self, name: &str) -> Result<(), ChannelError> {
        if let Some(mut channel) = self.channels.remove(name) {
            if channel.is_active() {
                channel.stop().await?;
            }
        }
        Ok(())
    }

    /// Check if any channel is currently connected.
    pub fn has_connected_channels(&self) -> bool {
        self.channels.values().any(|ch| ch.is_connected())
    }

    /// Number of registered channels.
    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    /// Get the status of all channels (name, connected, last_error).
    pub fn status(&self) -> Vec<(String, bool, Option<String>)> {
        self.channels
            .iter()
            .map(|(name, channel)| (name.clone(), channel.is_connected(), channel.last_error()))
            .collect()
    }

    /// Get a list of registered channel names.
    pub fn channel_names(&self) -> Vec<String> {
        self.channels.keys().cloned().collect()
    }

    /// Return the typing-indicator refresh interval for a channel, if any.
    ///
    /// Returns `None` when the channel is not found or does not need periodic
    /// typing refresh (i.e. `Channel::typing_refresh_interval()` is `None`).
    pub fn typing_refresh_interval_for(&self, channel_name: &str) -> Option<std::time::Duration> {
        self.channels
            .get(channel_name)
            .and_then(|ch| ch.typing_refresh_interval())
    }

    /// Call `on_processing_start` on a channel (fire-and-forget, errors logged).
    pub async fn notify_processing_start(
        &self,
        channel_name: &str,
        chat_id: &str,
        message_id: &str,
    ) {
        if let Some(ch) = self.channels.get(channel_name) {
            if let Err(err) = ch.on_processing_start(chat_id, message_id).await {
                warn!(
                    "[manager] on_processing_start failed for {}: {}",
                    channel_name, err
                );
            }
        }
    }

    /// Call `on_processing_end` on a channel (fire-and-forget, errors logged).
    pub async fn notify_processing_end(&self, channel_name: &str, chat_id: &str, message_id: &str) {
        if let Some(ch) = self.channels.get(channel_name) {
            if let Err(err) = ch.on_processing_end(chat_id, message_id).await {
                warn!(
                    "[manager] on_processing_end failed for {}: {}",
                    channel_name, err
                );
            }
        }
    }

    /// Send an outbound message to a specific channel by name.
    ///
    /// Returns `Ok(())` if the channel exists and the send succeeds,
    /// or an error if the channel is not found or the send fails.
    ///
    /// Empty-content guard mirrors `send_to_with_delivery` so callers
    /// that bypass the delivery wrapper still drop zero-length outbounds
    /// before they reach the channel adapter. Media-only sends are
    /// allowed through.
    pub async fn send_to(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
        if msg.content.trim().is_empty() && msg.media.is_empty() {
            tracing::debug!(
                channel = %msg.channel,
                chat_id = %msg.chat_id,
                "skipping empty outbound (no text, no media)"
            );
            return Ok(());
        }

        let channel = self
            .channels
            .get(&msg.channel)
            .ok_or_else(|| ChannelError::Other(format!("Channel not found: {}", msg.channel)))?;

        if !channel.is_connected() {
            return Err(ChannelError::SendFailed(format!(
                "Channel {} is not connected",
                msg.channel
            )));
        }

        channel.send(msg).await
    }

    /// Send an outbound message with automatic splitting and retry.
    ///
    /// 1. Empty-content guard: if `msg.content.trim().is_empty()` AND
    ///    `msg.media` is empty, the send is skipped entirely. This is
    ///    the central drop for zero-length assistant messages produced
    ///    on pure routing turns; unguarded they would surface as
    ///    empty-body deliveries on every channel. Media-only sends
    ///    (image/file without caption) still go through.
    /// 2. Splits `msg.content` into chunks that respect the channel's
    ///    `max_message_chars()` limit and code-block boundaries.
    /// 3. Sends each chunk with `send_with_retry()` (exponential backoff,
    ///    plain-text fallback, delivery-failure notice).
    ///
    /// This is the preferred path for all external-channel sends. Use
    /// `send_to()` only when you need raw, un-split access.
    pub async fn send_to_with_delivery(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
        if msg.content.trim().is_empty() && msg.media.is_empty() {
            tracing::debug!(
                channel = %msg.channel,
                chat_id = %msg.chat_id,
                "skipping empty outbound (no text, no media)"
            );
            return Ok(());
        }

        #[cfg(debug_assertions)]
        super::debug_tap::try_push(&msg.channel, &msg.chat_id, &msg.content);

        let channel = self
            .channels
            .get(&msg.channel)
            .ok_or_else(|| ChannelError::Other(format!("Channel not found: {}", msg.channel)))?;

        if !channel.is_connected() {
            return Err(ChannelError::SendFailed(format!(
                "Channel {} is not connected",
                msg.channel
            )));
        }

        let max_chars = channel.max_message_chars();
        let use_utf16 = channel.use_utf16_len();

        let chunks = if max_chars > 0 {
            let len_fn: Option<fn(&str) -> usize> = if use_utf16 { Some(utf16_len) } else { None };
            split_message(&msg.content, max_chars, len_fn)
        } else {
            vec![msg.content.clone()]
        };

        for chunk in chunks {
            let chunk_msg = OutboundMessage {
                content: chunk,
                ..msg.clone()
            };
            send_with_retry(channel.as_ref(), &chunk_msg, 2, 2.0).await?;
        }

        Ok(())
    }
}

// ── unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::super::traits::Channel;
    use super::*;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    /// Mock channel that records every `send()` call. Used to verify
    /// the empty-outbound guard actually short-circuits before reaching
    /// the channel adapter.
    struct RecordingChannel {
        name: String,
        calls: Arc<Mutex<Vec<OutboundMessage>>>,
        max_chars: usize,
    }

    impl RecordingChannel {
        fn new(name: &str, max_chars: usize) -> (Self, Arc<Mutex<Vec<OutboundMessage>>>) {
            let calls = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    name: name.to_string(),
                    calls: Arc::clone(&calls),
                    max_chars,
                },
                calls,
            )
        }
    }

    #[async_trait]
    impl Channel for RecordingChannel {
        fn name(&self) -> String {
            self.name.clone()
        }

        async fn start(
            &mut self,
            _inbound_tx: mpsc::Sender<InboundMessage>,
        ) -> Result<(), ChannelError> {
            Ok(())
        }

        async fn stop(&mut self) -> Result<(), ChannelError> {
            Ok(())
        }

        async fn send(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
            self.calls.lock().await.push(msg.clone());
            Ok(())
        }

        fn is_connected(&self) -> bool {
            true
        }

        fn max_message_chars(&self) -> usize {
            self.max_chars
        }
    }

    fn make_manager_with(
        channel: Box<dyn Channel>,
    ) -> (ChannelManager, mpsc::Receiver<InboundMessage>) {
        let (tx, rx) = mpsc::channel(8);
        let mut mgr = ChannelManager::new(tx);
        mgr.register(channel);
        (mgr, rx)
    }

    /// Empty content + no media must be dropped in
    /// `send_to_with_delivery`. Every channel benefits.
    #[tokio::test]
    async fn empty_outbound_is_skipped_in_send_to_with_delivery() {
        let (recorder, calls) = RecordingChannel::new("mock:empty", 0);
        let (mgr, _rx) = make_manager_with(Box::new(recorder));

        let msg = OutboundMessage::new("mock:empty", "chat-1", "");
        let result = mgr.send_to_with_delivery(&msg).await;

        assert!(result.is_ok(), "guard path returns Ok, not an error");
        let recorded = calls.lock().await;
        assert!(
            recorded.is_empty(),
            "empty outbound must NOT reach channel.send(); calls={:?}",
            recorded
        );
    }

    /// Same guard applies to the raw `send_to` path.
    #[tokio::test]
    async fn empty_outbound_is_skipped_in_send_to() {
        let (recorder, calls) = RecordingChannel::new("mock:empty-raw", 0);
        let (mgr, _rx) = make_manager_with(Box::new(recorder));

        let msg = OutboundMessage::new("mock:empty-raw", "chat-2", "   \n   \t  ");
        let result = mgr.send_to(&msg).await;

        assert!(result.is_ok());
        assert!(
            calls.lock().await.is_empty(),
            "whitespace-only outbound must also be skipped",
        );
    }

    /// Media-only outbounds (caption-less images) are NOT dropped.
    #[tokio::test]
    async fn media_only_outbound_passes_through() {
        let (recorder, calls) = RecordingChannel::new("mock:media-only", 0);
        let (mgr, _rx) = make_manager_with(Box::new(recorder));

        let msg = OutboundMessage {
            channel: "mock:media-only".to_string(),
            chat_id: "chat-3".to_string(),
            content: String::new(),
            reply_to: None,
            media: vec!["/tmp/image.png".to_string()],
            metadata: Default::default(),
        };
        let result = mgr.send_to_with_delivery(&msg).await;

        assert!(result.is_ok());
        let recorded = calls.lock().await;
        assert_eq!(
            recorded.len(),
            1,
            "media-only outbound must still be delivered"
        );
        assert_eq!(recorded[0].media, vec!["/tmp/image.png".to_string()]);
    }

    /// Normal non-empty outbound reaches the channel. Regression guard
    /// that the empty-content check did not break the happy path.
    #[tokio::test]
    async fn non_empty_outbound_still_delivered() {
        let (recorder, calls) = RecordingChannel::new("mock:happy", 0);
        let (mgr, _rx) = make_manager_with(Box::new(recorder));

        let msg = OutboundMessage::new("mock:happy", "chat-4", "hello world");
        let result = mgr.send_to_with_delivery(&msg).await;

        assert!(result.is_ok());
        let recorded = calls.lock().await;
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0].content, "hello world");
    }
}
