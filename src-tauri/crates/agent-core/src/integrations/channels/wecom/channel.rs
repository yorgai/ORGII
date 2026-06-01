//! `WeComChannel` struct and `Channel` trait implementation.
//!
//! Owns lifecycle state (running/connected flags, last-error slot, outbound
//! sender, ws task handle). The actual networking happens in [`super::ws_loop`].

use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::info;

use super::protocol::WeComState;
use super::ws_loop::wecom_ws_loop;
use crate::bus::{InboundMessage, OutboundMessage};
use crate::channels::config::WeComAccountConfig;
use crate::channels::traits::{Channel, ChannelError};

/// WeCom AI Bot channel (single account instance).
pub struct WeComChannel {
    account_id: String,
    config: WeComAccountConfig,
    running: Arc<AtomicBool>,
    ws_connected: Arc<AtomicBool>,
    last_error: Arc<RwLock<Option<String>>>,
    state: Arc<Mutex<WeComState>>,
    /// Sender for outbound messages; consumed by the WS task.
    outbound_tx: Option<mpsc::Sender<OutboundMessage>>,
    ws_handle: Option<tokio::task::JoinHandle<()>>,
}

impl WeComChannel {
    pub fn new(account_id: String, config: WeComAccountConfig) -> Self {
        Self {
            account_id,
            config,
            running: Arc::new(AtomicBool::new(false)),
            ws_connected: Arc::new(AtomicBool::new(false)),
            last_error: Arc::new(RwLock::new(None)),
            state: Arc::new(Mutex::new(WeComState::new())),
            outbound_tx: None,
            ws_handle: None,
        }
    }

    fn channel_name(&self) -> String {
        format!("wecom:{}", self.account_id)
    }
}

#[async_trait]
impl Channel for WeComChannel {
    fn name(&self) -> String {
        self.channel_name()
    }

    async fn start(
        &mut self,
        inbound_tx: mpsc::Sender<InboundMessage>,
    ) -> Result<(), ChannelError> {
        if self.config.bot_id.is_empty() || self.config.secret.is_empty() {
            return Err(ChannelError::ConfigError(
                "WeCom bot_id and secret are required".into(),
            ));
        }

        self.running.store(true, Ordering::Relaxed);
        self.ws_connected.store(false, Ordering::Relaxed);
        *self.last_error.write().await = None;

        let (outbound_tx, outbound_rx) = mpsc::channel::<OutboundMessage>(64);
        self.outbound_tx = Some(outbound_tx);

        let running = self.running.clone();
        let ws_connected = self.ws_connected.clone();
        let last_error = self.last_error.clone();
        let state = self.state.clone();
        let channel_name = self.channel_name();
        let bot_id = self.config.bot_id.clone();
        let secret = self.config.secret.clone();
        let ws_url = self.config.websocket_url.clone();
        let dm_policy = self.config.dm_policy.clone();
        let allow_from = self.config.allow_from.clone();
        let group_policy = self.config.group_policy.clone();
        let group_allow_from = self.config.group_allow_from.clone();

        let handle = tokio::spawn(async move {
            wecom_ws_loop(
                ws_url,
                bot_id,
                secret,
                dm_policy,
                allow_from,
                group_policy,
                group_allow_from,
                running,
                ws_connected,
                last_error,
                state,
                inbound_tx,
                outbound_rx,
                channel_name,
            )
            .await;
        });

        self.ws_handle = Some(handle);
        info!("[wecom:{}] Channel started", self.account_id);
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.running.store(false, Ordering::Relaxed);
        self.ws_connected.store(false, Ordering::Relaxed);
        self.outbound_tx = None;
        if let Some(handle) = self.ws_handle.take() {
            handle.abort();
        }
        info!("[wecom:{}] Channel stopped", self.account_id);
        Ok(())
    }

    async fn send(&self, msg: &OutboundMessage) -> Result<(), ChannelError> {
        let Some(tx) = self.outbound_tx.as_ref() else {
            return Err(ChannelError::SendFailed(
                "WeCom channel not started (no outbound channel)".into(),
            ));
        };
        tx.send(msg.clone()).await.map_err(|err| {
            ChannelError::SendFailed(format!("WeCom outbound queue closed: {}", err))
        })?;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.running.load(Ordering::Relaxed) && self.ws_connected.load(Ordering::Relaxed)
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

    // WeCom text message limit is 2 048 characters.
    fn max_message_chars(&self) -> usize {
        2048
    }

    fn typing_refresh_interval(&self) -> Option<std::time::Duration> {
        // WeCom typing expires quickly; refresh every 4 s.
        Some(std::time::Duration::from_secs(4))
    }
}
