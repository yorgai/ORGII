//! Read/write helpers for the per-manager `needs_auth` map.

use super::McpManager;
use crate::intelligence::mcp::config::McpServerConfig;

impl McpManager {
    /// Return a snapshot of servers currently flagged as `needs-auth`.
    /// Used by the bridge layer to register `McpAuthTool` pseudo-tools
    /// and by the Tauri status command so the UI can prompt the user.
    pub async fn needs_auth_servers(&self) -> Vec<(String, McpServerConfig)> {
        self.needs_auth
            .lock()
            .await
            .iter()
            .map(|(name, cfg)| (name.clone(), cfg.clone()))
            .collect()
    }

    /// Check if a server is in the needs-auth state.
    pub async fn is_needs_auth(&self, name: &str) -> bool {
        self.needs_auth.lock().await.contains_key(name)
    }

    /// Mark a server as needs-auth: cache it on disk (so the next
    /// `connect_all` skips it) and stash its config so the pseudo-tool
    /// can find the transport URL. Idempotent.
    pub async fn mark_needs_auth(&self, name: &str, config: &McpServerConfig) {
        crate::intelligence::mcp::needs_auth_cache::set_entry(name).await;
        self.needs_auth
            .lock()
            .await
            .insert(name.to_string(), config.clone());
    }

    /// Clear the needs-auth flag for a single server (called after a
    /// successful OAuth flow). The on-disk cache is also purged for
    /// just this server; other servers' entries survive.
    pub async fn clear_needs_auth(&self, name: &str) {
        crate::intelligence::mcp::needs_auth_cache::remove_entry(name).await;
        self.needs_auth.lock().await.remove(name);
    }
}
