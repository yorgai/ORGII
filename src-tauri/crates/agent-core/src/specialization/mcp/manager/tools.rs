//! Tool listing + dispatch (`call_tool*`).

use std::sync::Arc;

use tracing::{error, warn};

use super::{is_remote, McpManager};
use crate::specialization::mcp::client::McpToolDef;

impl McpManager {
    /// Get all tools from all connected servers.
    ///
    /// Returns `(server_name, tool_def)` pairs.
    pub async fn all_tools(&self) -> Vec<(String, McpToolDef)> {
        let clients = self.clients.lock().await;
        let mut result = Vec::new();

        for (server_name, client) in clients.iter() {
            if !client.is_alive() {
                continue;
            }
            for tool in client.tools().await {
                result.push((server_name.clone(), tool));
            }
        }

        result
    }

    /// Get tools for a specific server.
    pub async fn server_tools(&self, server_name: &str) -> Result<Vec<McpToolDef>, String> {
        let clients = self.clients.lock().await;
        let client = clients
            .get(server_name)
            .ok_or_else(|| format!("Server '{}' not connected", server_name))?;
        Ok(client.tools().await)
    }

    /// Call a tool on a specific server.
    ///
    /// If the server is no longer alive (process crashed, connection dropped),
    /// one automatic reconnect attempt is made before failing. The connection
    /// memoize cache is cleared on `onclose` so the next call transparently
    /// reconnects.
    pub async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<String, String> {
        match self
            .call_tool_with_meta(server_name, tool_name, arguments, None)
            .await
        {
            Ok(result) => Ok(result.text),
            Err(err) => Err(err.to_string()),
        }
    }

    /// Structured tool call: returns the full [`super::super::result::McpCallResult`]
    /// (text + `_meta` + `structured_content` + on-disk persistence reference)
    /// and the typed [`super::super::errors::McpCallError`] so callers can react
    /// to auth / session-expired / transport failures without re-parsing strings.
    ///
    /// `_meta` currently carries `{ 'orgii/toolUseId': toolUseId }`.
    ///
    /// Pre-flight reconnect is the same as `call_tool`: if the client's
    /// `alive` flag is off (either never connected or tripped by the
    /// terminal-error counter) we reconnect once before the call.
    pub(crate) async fn call_tool_with_meta(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
        request_meta: Option<serde_json::Value>,
    ) -> Result<
        crate::specialization::mcp::result::McpCallResult,
        crate::specialization::mcp::errors::McpCallError,
    > {
        let client = {
            let clients = self.clients.lock().await;
            clients.get(server_name).cloned().ok_or_else(|| {
                crate::specialization::mcp::errors::McpCallError::Transport {
                    server: server_name.to_string(),
                    message: format!("MCP server '{}' not connected", server_name),
                }
            })?
        };

        if !client.is_alive() {
            warn!(
                "[mcp:manager] Server '{}' not alive — attempting reconnect before tool call",
                server_name
            );
            let config = client.config().clone();
            if let Err(err) = self.connect_server(server_name, &config).await {
                return Err(
                    crate::specialization::mcp::errors::McpCallError::Transport {
                        server: server_name.to_string(),
                        message: format!(
                            "MCP server '{}' is not alive and reconnect failed: {}",
                            server_name, err
                        ),
                    },
                );
            }
        }

        let client = {
            let clients = self.clients.lock().await;
            clients.get(server_name).cloned().ok_or_else(|| {
                crate::specialization::mcp::errors::McpCallError::Transport {
                    server: server_name.to_string(),
                    message: format!("MCP server '{}' not connected after reconnect", server_name),
                }
            })?
        };

        let outcome = client
            .call_tool_typed(tool_name, arguments, request_meta)
            .await;

        if let Err(ref err) = outcome {
            error!(
                "[mcp:manager] Tool call '{}' on '{}' failed: {}",
                tool_name, server_name, err
            );
            if matches!(
                err,
                crate::specialization::mcp::errors::McpCallError::Auth { .. }
            ) {
                let config = client.config().clone();
                if is_remote(&config) {
                    warn!(
                        "[mcp:manager] Tool call hit auth failure on '{}' — marking needs-auth and dropping client",
                        server_name
                    );
                    self.mark_needs_auth(server_name, &config).await;
                    crate::specialization::mcp::needs_auth_cache::set_entry(server_name).await;
                    self.disconnect_server(server_name).await;
                }
            }
        }

        outcome
    }

    /// Progress-aware variant of [`Self::call_tool_with_meta`].
    ///
    /// For every `notifications/progress` that arrives while this call
    /// is outstanding, two things happen:
    /// 1. The manager-level `tool_progress_total` counter ticks so E2E
    ///    scenarios can assert streaming was observed end-to-end.
    /// 2. `on_progress` is invoked with the raw
    ///    [`rmcp::model::ProgressNotificationParam`] so the caller can surface it
    ///    (future UI, JSON debug endpoint, etc.).
    ///
    /// `McpBridgeTool::execute` is wired through this method, so every
    /// MCP tool invocation that surfaces to the agent participates in
    /// the progress pipeline. The
    /// UI consumer lives in
    /// `src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers`
    /// (`agent:mcp_progress` case).
    pub(crate) async fn call_tool_with_progress<F>(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
        request_meta: Option<serde_json::Value>,
        mut on_progress: F,
    ) -> Result<
        crate::specialization::mcp::result::McpCallResult,
        crate::specialization::mcp::errors::McpCallError,
    >
    where
        F: FnMut(rmcp::model::ProgressNotificationParam) + Send + 'static,
    {
        let client = {
            let clients = self.clients.lock().await;
            clients.get(server_name).cloned().ok_or_else(|| {
                crate::specialization::mcp::errors::McpCallError::Transport {
                    server: server_name.to_string(),
                    message: format!("MCP server '{}' not connected", server_name),
                }
            })?
        };

        if !client.is_alive() {
            let config = client.config().clone();
            if let Err(err) = self.connect_server(server_name, &config).await {
                return Err(
                    crate::specialization::mcp::errors::McpCallError::Transport {
                        server: server_name.to_string(),
                        message: format!(
                            "MCP server '{}' is not alive and reconnect failed: {}",
                            server_name, err
                        ),
                    },
                );
            }
        }

        let client = {
            let clients = self.clients.lock().await;
            clients.get(server_name).cloned().ok_or_else(|| {
                crate::specialization::mcp::errors::McpCallError::Transport {
                    server: server_name.to_string(),
                    message: format!("MCP server '{}' not connected after reconnect", server_name),
                }
            })?
        };

        let counters = Arc::clone(&self.notification_counters);
        let outcome = client
            .call_tool_typed_with_progress(tool_name, arguments, request_meta, move |tick| {
                counters.bump_tool_progress();
                on_progress(tick);
            })
            .await;

        if let Err(ref err) = outcome {
            error!(
                "[mcp:manager] Streaming tool call '{}' on '{}' failed: {}",
                tool_name, server_name, err
            );
            if matches!(
                err,
                crate::specialization::mcp::errors::McpCallError::Auth { .. }
            ) {
                let config = client.config().clone();
                if is_remote(&config) {
                    self.mark_needs_auth(server_name, &config).await;
                    crate::specialization::mcp::needs_auth_cache::set_entry(server_name).await;
                    self.disconnect_server(server_name).await;
                }
            }
        }

        outcome
    }
}
