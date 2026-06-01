//! Action router for coding tools — decides whether a tool call runs
//! locally or is forwarded to the frontend ActionSystem via `ActionBridge`.
//!
//! This is the *translator* layer: it owns the routing policy
//! (WorkStation mode + frontend connected), wraps tool calls into
//! `{action, params}` envelopes, and falls back to direct execution if
//! the frontend doesn't respond. The actual IPC (correlation IDs,
//! oneshot channels, timeouts) lives in [`ActionBridge`].
//!
//! Each coding tool can optionally hold an `ActionRouter` instance.
//! When present and `should_route()` is true, `execute()` calls are
//! forwarded to the frontend instead of running locally via
//! `tool_service`. If the frontend doesn't respond (e.g. after a hot
//! reload), `try_execute()` returns `Ok(None)` so the caller can fall
//! back to direct execution.

use serde_json::Value;
use std::sync::Arc;
use tracing::{info, warn};

use crate::tools::impls::web::control_orgii::{execute_gui_action_with_timeout, ActionBridge};
use crate::tools::traits::ToolError;

/// Default timeout for routed action requests (seconds).
const ROUTE_TIMEOUT_SECS: u64 = 30;

/// Routes coding-tool calls between local execution and the frontend
/// ActionSystem. Holds an `ActionBridge` reference and the session's
/// execution mode.
///
/// Coding tools store `Option<ActionRouter>` — `None` means always direct.
pub struct ActionRouter {
    bridge: Arc<ActionBridge>,
    execution_mode: crate::integrations::config::ExecutionMode,
}

impl ActionRouter {
    /// Create a new action router.
    pub fn new(
        bridge: Arc<ActionBridge>,
        execution_mode: crate::integrations::config::ExecutionMode,
    ) -> Self {
        Self {
            bridge,
            execution_mode,
        }
    }

    /// Whether this tool call should be routed through the frontend.
    ///
    /// Returns `true` only when:
    /// 1. `execution_mode` is `WorkStation`
    /// 2. At least one frontend subscriber is connected (Tauri IPC Channel
    ///    or debug WebSocket client)
    pub fn should_route(&self) -> bool {
        self.execution_mode == crate::integrations::config::ExecutionMode::WorkStation
            && ActionBridge::has_frontend()
    }

    /// Route a coding tool call through the frontend ActionSystem.
    ///
    /// `action_id` is the ActionSystem action ID (e.g. `"file.read"`, `"git.status"`).
    /// `params` are the action parameters (JSON object).
    pub async fn execute(&self, action_id: &str, params: Value) -> Result<String, ToolError> {
        info!(
            "[action_router] Routing through ActionBridge: action={}, mode={:?}",
            action_id, self.execution_mode
        );

        let envelope = serde_json::json!({
            "action": action_id,
            "params": params,
        });

        execute_gui_action_with_timeout(&self.bridge, "coding", envelope, ROUTE_TIMEOUT_SECS).await
    }

    /// Try to route through the frontend, falling back on timeout.
    ///
    /// Returns:
    /// - `Ok(Some(result))` — frontend handled the action successfully
    /// - `Ok(None)` — frontend didn't respond (timeout or channel closed);
    ///   caller should fall back to direct `tool_service` execution
    /// - `Err(err)` — non-recoverable error (invalid params, etc.)
    pub async fn try_execute(
        &self,
        action_id: &str,
        params: Value,
    ) -> Result<Option<String>, ToolError> {
        match self.execute(action_id, params).await {
            Ok(result) => Ok(Some(result)),
            Err(ToolError::Timeout(msg)) => {
                warn!(
                    "[action_router] Frontend timed out for '{}', falling back to direct execution. {}",
                    action_id, msg
                );
                Ok(None)
            }
            Err(ToolError::ExecutionFailed(msg))
                if msg.contains("frontend may not be connected") =>
            {
                warn!(
                    "[action_router] Frontend disconnected for '{}', falling back to direct execution. {}",
                    action_id, msg
                );
                Ok(None)
            }
            Err(err) => Err(err),
        }
    }
}
