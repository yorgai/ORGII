//! Notification counter types + the manager methods that surface them.

use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(debug_assertions)]
use std::sync::Arc;

use serde::Serialize;

use super::McpManager;

/// Per-manager counters for MCP notifications. Every time the
/// notification listener task handles a `notifications/*` method, the
/// matching counter increments.
///
/// We expose these over a debug-only HTTP endpoint so E2E scenarios can
/// assert that the listener actually fires on each notification kind —
/// otherwise it's very easy to regress to a silent `debug!` log that no
/// test catches.
#[derive(Debug, Default)]
pub struct NotificationCounters {
    /// Count of `notifications/tools/list_changed` dispatches that ran
    /// `refresh_tools()`. Includes both success and failure outcomes.
    pub(super) tools_refreshed: AtomicU64,
    /// Count of `notifications/resources/list_changed` events observed.
    /// We don't maintain a resource cache (every `list_resources` call is
    /// already a live `rmcp` roundtrip), so this is pure observability.
    pub(super) resources_list_changed: AtomicU64,
    /// Count of `notifications/resources/updated(uri)` events observed.
    /// Same "no cache" semantics as `resources_list_changed`.
    pub(super) resources_updated: AtomicU64,
    /// Count of `notifications/prompts/list_changed` events observed.
    /// On each tick the per-server prompt cache is invalidated so the
    /// next `list_prompts` / `all_prompts` call re-fetches from the
    /// server.
    pub(super) prompts_list_changed: AtomicU64,
    /// Total `notifications/progress` ticks forwarded by
    /// the handler to caller subscribers. Incremented once per tick
    /// regardless of whether a subscriber was active — failure to
    /// observe this growing during a streaming tool call is the
    /// symptom we watch for in E2E.
    pub(super) tool_progress_total: AtomicU64,
    /// Count of unrecognized notification methods (future-proofing — a
    /// non-zero value means a new MCP method landed upstream that we
    /// don't yet handle).
    pub(super) unknown: AtomicU64,
}

impl NotificationCounters {
    pub fn snapshot(&self) -> NotificationCountersSnapshot {
        NotificationCountersSnapshot {
            tools_refreshed: self.tools_refreshed.load(Ordering::SeqCst),
            resources_list_changed: self.resources_list_changed.load(Ordering::SeqCst),
            resources_updated: self.resources_updated.load(Ordering::SeqCst),
            prompts_list_changed: self.prompts_list_changed.load(Ordering::SeqCst),
            tool_progress_total: self.tool_progress_total.load(Ordering::SeqCst),
            unknown: self.unknown.load(Ordering::SeqCst),
        }
    }

    pub fn reset(&self) {
        self.tools_refreshed.store(0, Ordering::SeqCst);
        self.resources_list_changed.store(0, Ordering::SeqCst);
        self.resources_updated.store(0, Ordering::SeqCst);
        self.prompts_list_changed.store(0, Ordering::SeqCst);
        self.tool_progress_total.store(0, Ordering::SeqCst);
        self.unknown.store(0, Ordering::SeqCst);
    }

    /// Bump once per progress tick. Called from the
    /// manager wrapper around `McpClient::call_tool_typed_with_progress`.
    pub fn bump_tool_progress(&self) {
        self.tool_progress_total.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCountersSnapshot {
    pub tools_refreshed: u64,
    pub resources_list_changed: u64,
    pub resources_updated: u64,
    pub prompts_list_changed: u64,
    pub tool_progress_total: u64,
    pub unknown: u64,
}

impl McpManager {
    /// Snapshot the per-manager notification counters. Used by the
    /// debug-only HTTP endpoint and by E2E tests verifying that the
    /// listener routes each MCP notification kind to the correct branch.
    pub fn notification_counters(&self) -> NotificationCountersSnapshot {
        self.notification_counters.snapshot()
    }

    /// Reset all notification counters to zero. Called at the start of
    /// each E2E scenario that asserts on counter deltas.
    pub fn reset_notification_counters(&self) {
        self.notification_counters.reset();
    }

    /// Return a clone of the shared `Arc<NotificationCounters>` so debug
    /// endpoints can poke the counters directly without re-acquiring
    /// the manager's `Arc<McpManager>`. Used by the progress-bump debug
    /// endpoint to verify the `toolProgressTotal` atomic is
    /// wired to the snapshot.
    #[cfg(debug_assertions)]
    pub fn notification_counters_handle(&self) -> Arc<NotificationCounters> {
        Arc::clone(&self.notification_counters)
    }

    /// Debug-only: push a synthetic notification into the channel used by
    /// the per-client listener task. Returns an error if the named server
    /// has no live client. Powers
    /// `POST /agent/test/mcp/inject-notification` so E2E scenarios can
    /// drive every code branch in
    /// [`super::notifications::McpManager::spawn_notification_listener`]
    /// without needing an MCP server that emits `list_changed` on demand.
    #[cfg(debug_assertions)]
    pub async fn debug_inject_notification(
        &self,
        server_name: &str,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let client = {
            let clients = self.clients.lock().await;
            clients
                .get(server_name)
                .cloned()
                .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?
        };
        client.debug_push_notification(method, params).await
    }
}
