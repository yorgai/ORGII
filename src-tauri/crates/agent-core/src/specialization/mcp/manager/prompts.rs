//! Prompt listing/get + per-server prompt cache.

use tracing::warn;

use super::McpManager;
use crate::specialization::mcp::prompts::{McpPrompt, McpPromptRendered};

impl McpManager {
    /// List prompts advertised by a specific server, using (and populating)
    /// the per-server prompt cache.
    ///
    /// Cache invalidation:
    /// - `notifications/prompts/list_changed` removes the entry (see
    ///   [`super::notifications::McpManager::spawn_notification_listener`]).
    /// - `disconnect_server` removes the entry.
    ///
    /// Invariant: a cache hit must reflect the server's most recent
    /// `prompts/list`. If either invalidation source is bypassed, the
    /// cache will go stale and slash-command discovery will lie.
    pub async fn list_prompts(&self, server_name: &str) -> Result<Vec<McpPrompt>, String> {
        {
            let cache = self.prompts_cache.lock().await;
            if let Some(cached) = cache.get(server_name) {
                return Ok(cached.clone());
            }
        }

        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };

        let prompts = client.list_prompts().await?;
        self.prompts_cache
            .lock()
            .await
            .insert(server_name.to_string(), prompts.clone());
        Ok(prompts)
    }

    /// Execute `prompts/get` on a specific server and return the
    /// flattened [`McpPromptRendered`] result.
    pub async fn get_prompt(
        &self,
        server_name: &str,
        prompt_name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<McpPromptRendered, String> {
        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };

        client.get_prompt(prompt_name, arguments).await
    }

    /// Aggregate every prompt across every connected server that
    /// advertises the `prompts` capability. Returns `(server_name,
    /// prompt)` pairs so downstream code (e.g. the slash-command
    /// registry) can build the `mcp__<server>__<prompt>` name. Dead or
    /// errored servers are skipped — the prompt list must remain usable
    /// when one server is broken, so callers never see a half-initialized
    /// aggregate.
    pub async fn all_prompts(&self) -> Vec<(String, McpPrompt)> {
        let names: Vec<String> = {
            let clients = self.clients.lock().await;
            clients
                .iter()
                .filter(|(_, c)| c.is_alive())
                .map(|(n, _)| n.clone())
                .collect()
        };

        let mut result = Vec::new();
        for name in names {
            match self.list_prompts(&name).await {
                Ok(prompts) => {
                    for prompt in prompts {
                        result.push((name.clone(), prompt));
                    }
                }
                Err(err) => {
                    warn!(
                        "[mcp:manager] all_prompts: skipping '{}' — list_prompts failed: {}",
                        name, err
                    );
                }
            }
        }
        result
    }

    /// Debug-only helper exposing the cache state so E2E scenarios can
    /// distinguish a cold `list_prompts` (miss → fetch) from a warm one
    /// (hit → return clone) without racing the background listener.
    #[cfg(debug_assertions)]
    pub async fn debug_prompts_cache_has(&self, server_name: &str) -> bool {
        self.prompts_cache.lock().await.contains_key(server_name)
    }
}
