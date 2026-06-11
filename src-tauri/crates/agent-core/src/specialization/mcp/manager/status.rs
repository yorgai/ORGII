//! Server status + connection-state predicates.

use std::collections::HashMap;
use std::path::Path;

use super::McpManager;
use crate::specialization::mcp::client::{McpConnectionStatus, McpServerStatus};
use crate::specialization::mcp::config::{
    McpConfigFile, McpConfigScope, McpServerConfig, McpTransportType,
};

impl McpManager {
    /// Get status of all configured servers (including disconnected ones).
    ///
    /// Each entry carries a `scope` field indicating which config file it
    /// comes from (`"global"` or `"workspace"`). When the same server name
    /// exists in both files the workspace entry wins (same precedence as
    /// `McpConfigFile::load_merged`).
    pub async fn all_statuses_with_config(
        &self,
        workspace_path: Option<&Path>,
    ) -> Result<Vec<McpServerStatus>, String> {
        // Build a name → scope map so we can tag each status row.
        let mut scope_map: HashMap<String, McpConfigScope> = HashMap::new();

        let global_cfg = McpConfigFile::load_global()?;
        for name in global_cfg.mcp_servers.keys() {
            scope_map.insert(name.clone(), McpConfigScope::Global);
        }
        if let Some(workspace) = workspace_path {
            let workspace_cfg = McpConfigFile::load_for_workspace(workspace)?;
            for name in workspace_cfg.mcp_servers.keys() {
                // Workspace always wins — overwrite any global entry.
                scope_map.insert(name.clone(), McpConfigScope::Workspace);
            }
        }

        let config = McpConfigFile::load_merged(workspace_path)?;
        let clients = self.clients.lock().await;
        let conn_errors = self.connection_errors.lock().await;
        let connecting = self.connecting.lock().await;
        let needs_auth = self.needs_auth.lock().await;
        let mut statuses = Vec::new();

        for (name, server_config) in &config.mcp_servers {
            let scope = scope_map
                .get(name)
                .copied()
                .unwrap_or(McpConfigScope::Global);

            if let Some(client) = clients.get(name) {
                let mut s = client.status().await;
                s.scope = scope;
                statuses.push(s);
            } else {
                statuses.push(disconnected_status(
                    name,
                    server_config,
                    scope,
                    &connecting,
                    &needs_auth,
                    &conn_errors,
                ));
            }
        }

        Ok(statuses)
    }

    /// Number of connected servers.
    pub async fn connected_count(&self) -> usize {
        let clients = self.clients.lock().await;
        clients.values().filter(|c| c.is_alive()).count()
    }

    /// Check if a server is connected.
    pub async fn is_connected(&self, name: &str) -> bool {
        let clients = self.clients.lock().await;
        clients.get(name).map(|c| c.is_alive()).unwrap_or(false)
    }
}

/// Build a status row for a server that has no live `McpClient` yet.
fn disconnected_status(
    name: &str,
    server_config: &McpServerConfig,
    scope: McpConfigScope,
    connecting: &std::collections::HashSet<String>,
    needs_auth: &std::collections::HashMap<String, McpServerConfig>,
    conn_errors: &std::collections::HashMap<String, String>,
) -> McpServerStatus {
    let transport_type = match server_config.transport_type {
        McpTransportType::Stdio => "stdio",
        McpTransportType::Sse => "sse",
        McpTransportType::StreamableHttp => "streamableHttp",
    }
    .to_string();

    let is_connecting = connecting.contains(name);
    let is_needs_auth = needs_auth.contains_key(name);

    McpServerStatus {
        name: name.to_string(),
        status: if server_config.disabled {
            McpConnectionStatus::Disabled
        } else if is_connecting {
            McpConnectionStatus::Connecting
        } else if is_needs_auth {
            McpConnectionStatus::NeedsAuth
        } else if conn_errors.contains_key(name) {
            McpConnectionStatus::Error
        } else {
            McpConnectionStatus::Disconnected
        },
        tool_count: 0,
        error: if server_config.disabled || is_connecting || is_needs_auth {
            None
        } else {
            conn_errors.get(name).cloned()
        },
        transport_type,
        disabled: server_config.disabled,
        connected_at: None,
        scope,
    }
}
