//! Accessors and lifecycle helpers (status, shutdown, notification channel).

#[cfg(debug_assertions)]
use serde_json::Value;
use std::sync::atomic::Ordering;
use tokio::sync::mpsc;

use super::{McpClient, McpConnectionStatus, McpServerStatus, McpToolDef};
use crate::specialization::mcp::config::{McpConfigScope, McpServerConfig, McpTransportType};
use crate::specialization::mcp::notification::ServerNotification;

impl McpClient {
    pub async fn tools(&self) -> Vec<McpToolDef> {
        self.tools.lock().await.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn config(&self) -> &McpServerConfig {
        &self.config
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
            && self.service.try_lock().map(|g| g.is_some()).unwrap_or(true)
    }

    pub async fn status(&self) -> McpServerStatus {
        let tools = self.tools.lock().await;
        let last_error = self.last_error.lock().await;

        let status = if self.is_alive() {
            McpConnectionStatus::Connected
        } else if last_error.is_some() {
            McpConnectionStatus::Error
        } else {
            McpConnectionStatus::Disconnected
        };

        let transport_type = match self.config.transport_type {
            McpTransportType::Stdio => "stdio",
            McpTransportType::Sse => "sse",
            McpTransportType::StreamableHttp => "streamableHttp",
        };

        let connected_at_raw = self.connected_at_ms.load(Ordering::SeqCst);
        let connected_at =
            if matches!(status, McpConnectionStatus::Connected) && connected_at_raw > 0 {
                Some(connected_at_raw)
            } else {
                None
            };

        McpServerStatus {
            name: self.name.clone(),
            status,
            tool_count: tools.len(),
            error: last_error.clone(),
            transport_type: transport_type.to_string(),
            disabled: self.config.disabled,
            connected_at,
            scope: McpConfigScope::Global,
        }
    }

    pub async fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        self.connected_at_ms.store(0, Ordering::SeqCst);
        let mut guard = self.service.lock().await;
        if let Some(service) = guard.take() {
            // `cancel()` stops the background task and cleanly drops the
            // transport (for stdio that kills the child process).
            let _ = service.cancel().await;
        }
    }

    pub async fn take_notification_rx(&self) -> Option<mpsc::Receiver<ServerNotification>> {
        self.notification_rx.lock().await.take()
    }

    /// Debug-only: inject a synthetic `ServerNotification` into the same
    /// channel the fan-out task writes to, so
    /// `McpManager::spawn_notification_listener` observes it exactly like
    /// a real notification from the server. Used by E2E tests to verify
    /// each notification kind is handled without needing a cooperative MCP
    /// server that emits `list_changed` on demand.
    ///
    /// Returns `Err` if the channel is closed (which only happens when the
    /// client is shutting down).
    #[cfg(debug_assertions)]
    pub async fn debug_push_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        self.notification_tx
            .send(ServerNotification {
                method: method.to_string(),
                params,
            })
            .await
            .map_err(|err| format!("debug_push_notification send failed: {err}"))
    }
}
