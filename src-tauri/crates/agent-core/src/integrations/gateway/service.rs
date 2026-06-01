//! Gateway Service — manages channel lifecycle and the background workers
//! that shuttle messages between external channels and the inbound/outbound
//! buses.
//!
//! Manages the gateway infrastructure: channel manager, inbound/outbound
//! workers, and automation engine. Channel messages are routed to per-chat
//! OS agent sessions via the binding cache in `GatewayInboundHandler`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info};

use crate::automation;
use crate::bus::{AgentMessageBus as MessageBus, InboundMessage, OutboundMessage};
use crate::channels::config::ChannelsConfig;
use crate::channels::ChannelManager;

use super::channels_ops::{build_channel_for_toggle, register_enabled_channels};
use super::workers::{spawn_inbound_processor, spawn_outbound_dispatcher};

/// Trait for handling inbound messages from channels.
///
/// The gateway delegates message processing to this handler, which is implemented
/// by the agent layer. This decouples the gateway from any specific agent.
#[async_trait::async_trait]
pub trait InboundMessageHandler: Send + Sync + 'static {
    async fn handle_message(&self, msg: InboundMessage) -> Result<Option<OutboundMessage>, String>;
}

/// Parameters needed by the inbound processor.
pub struct InboundProcessorDeps {
    pub handler: Arc<dyn InboundMessageHandler>,
}

/// Gateway Service — handles message routing from external channels.
///
/// This is an infrastructure service that is decoupled from any specific agent.
/// It manages channel connections, message routing, and the automation engine.
pub struct GatewayService {
    pub bus: Arc<Mutex<MessageBus>>,
    pub channel_manager: Arc<Mutex<Option<ChannelManager>>>,
    pub running: Arc<AtomicBool>,
    pub handles: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
    pub automation_engine: Arc<Mutex<Option<automation::AutomationEngine>>>,
}

impl GatewayService {
    pub fn new(bus: Arc<Mutex<MessageBus>>) -> Self {
        Self {
            bus,
            channel_manager: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            handles: Arc::new(Mutex::new(Vec::new())),
            automation_engine: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the gateway infrastructure: inbound processor, outbound dispatcher,
    /// and automation engine. Idempotent — no-op if already running.
    pub async fn start(&self, deps: InboundProcessorDeps) -> Result<(), String> {
        if self.running.load(Ordering::Relaxed) {
            return Ok(());
        }

        self.ensure_channel_manager().await;
        self.running.store(true, Ordering::Relaxed);

        let task_handles = vec![
            spawn_inbound_processor(
                self.bus.clone(),
                self.running.clone(),
                deps.handler,
                self.channel_manager.clone(),
            ),
            spawn_outbound_dispatcher(
                self.bus.clone(),
                self.channel_manager.clone(),
                self.running.clone(),
            )
            .await,
        ];

        self.start_automation_engine().await;

        {
            let mut handles_lock = self.handles.lock().await;
            *handles_lock = task_handles;
        }

        info!("[gateway] Gateway infrastructure started");
        Ok(())
    }

    async fn ensure_channel_manager(&self) {
        let mut cm_lock = self.channel_manager.lock().await;
        if cm_lock.is_none() {
            let inbound_tx = {
                let bus = self.bus.lock().await;
                bus.inbound_sender()
            };
            *cm_lock = Some(ChannelManager::new(inbound_tx));
        }
    }

    async fn start_automation_engine(&self) {
        let inbound_tx = {
            let bus = self.bus.lock().await;
            bus.inbound_sender()
        };
        let mut engine = automation::AutomationEngine::new(inbound_tx);
        // If load fails (e.g. corrupt rules file) we deliberately do NOT install the
        // engine. Leaving the slot `None` keeps user data intact: the Tauri command
        // fallback path also surfaces the load error instead of overwriting the file
        // with an empty list.
        if let Err(err) = engine.start().await {
            tracing::error!("[gateway] Automation engine failed to start, leaving disabled: {err}");
            return;
        }

        let mut engine_lock = self.automation_engine.lock().await;
        *engine_lock = Some(engine);
    }

    /// Stop all gateway infrastructure: channels, background tasks, automation.
    pub async fn stop(&self) {
        if !self.running.load(Ordering::Relaxed) {
            return;
        }

        self.running.store(false, Ordering::Relaxed);

        {
            let mut handles_lock = self.handles.lock().await;
            for handle in handles_lock.drain(..) {
                handle.abort();
            }
        }

        {
            let mut cm_lock = self.channel_manager.lock().await;
            if let Some(ref mut manager) = *cm_lock {
                manager.stop_all().await;
            }
            *cm_lock = None;
        }

        {
            let mut engine_lock = self.automation_engine.lock().await;
            if let Some(ref mut engine) = *engine_lock {
                engine.stop().await;
            }
            *engine_lock = None;
        }

        info!("[gateway] Gateway stopped");
    }

    /// Toggle a single channel on or off.
    pub async fn toggle_channel(
        &self,
        channel_type: &str,
        account_id: &str,
        enabled: bool,
        channels: &ChannelsConfig,
    ) -> Result<(), String> {
        let is_plugin_channel = channel_type == "plugin";
        let channel_name = if is_plugin_channel {
            account_id.to_string()
        } else {
            format!("{}:{}", channel_type, account_id)
        };

        if enabled {
            let channel = build_channel_for_toggle(channel_type, account_id, channels).await?;

            let inbound_tx = {
                let bus = self.bus.lock().await;
                bus.inbound_sender()
            };

            let mut cm_lock = self.channel_manager.lock().await;
            if let Some(ref mut manager) = *cm_lock {
                manager
                    .add_and_start_channel(channel, inbound_tx)
                    .await
                    .map_err(|err| format!("Failed to start channel {}: {}", channel_name, err))?;
            }

            info!("[gateway] Channel {} enabled and started", channel_name);
        } else {
            let mut cm_lock = self.channel_manager.lock().await;
            if let Some(ref mut manager) = *cm_lock {
                manager
                    .remove_channel(&channel_name)
                    .await
                    .map_err(|err| format!("Failed to stop channel {}: {}", channel_name, err))?;
            }

            info!("[gateway] Channel {} disabled and stopped", channel_name);
        }

        Ok(())
    }

    /// Restore previously-enabled channels from config on app startup.
    pub async fn restore_channels(&self, channels: &ChannelsConfig) -> Result<(), String> {
        let mut cm_lock = self.channel_manager.lock().await;
        let manager = cm_lock.as_mut().ok_or("ChannelManager not initialized")?;

        register_enabled_channels(manager, channels).await;

        let start_results = manager.start_all().await;
        for (name, result) in &start_results {
            match result {
                Ok(()) => info!("[gateway] Restored channel {} successfully", name),
                Err(err) => error!("[gateway] Failed to restore channel {}: {}", name, err),
            }
        }

        info!("[gateway] Enabled channels restored from config");
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}
