//! ORGII GUI Action bridge — frontend ActionSystem dispatch infrastructure.
//!
//! `ActionBridge` / `ActionBridgeResult` are the shared plumbing the agent
//! uses to dispatch UI actions to the ORGII frontend over the Tauri IPC
//! Channel and await a structured response. They are consumed by:
//!
//! - `manage_session` and `CodingDispatchTool` (via
//!   `execute_gui_action_with_timeout`) for `session.*` and human-tool
//!   dispatch.
//! - Channel plumbing.
//!
//! Request-response mechanism:
//! 1. Caller broadcasts `agent:ide_action` (delivered to the frontend over
//!    the Tauri IPC Channel) with a correlation ID.
//! 2. Frontend dispatches the action through zodActionRegistry.
//! 3. Frontend calls `agent_ide_action_result` Tauri command with the result.
//! 4. Bridge resolves the pending oneshot channel and returns the result.
//!
//! The user-facing `control_orgii` LLM tool that wrapped this bridge has been
//! removed; the bridge itself stays because non-LLM call sites still need it.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;
use tracing::{info, warn};

use crate::bus::broadcast_event;
use crate::tools::traits::{required_string, ToolError};

/// Maximum number of pending IDE action requests (FIFO eviction).
const MAX_PENDING: usize = 50;

/// Timeout for waiting on the frontend response.
const IDE_ACTION_TIMEOUT_SECS: u64 = 10;

/// Result returned by the frontend after executing a GUI action.
pub struct ActionBridgeResult {
    pub success: bool,
    pub message: String,
}

/// Shared bridge for pending GUI action requests.
///
/// Stored as `Arc<ActionBridge>` in `AgentAppState`. Both the `ide` and `app`
/// tools, plus the `agent_ide_action_result` Tauri command, share this.
#[derive(Default)]
pub struct ActionBridge {
    pending: Mutex<HashMap<String, oneshot::Sender<ActionBridgeResult>>>,
    /// Insertion order for FIFO eviction.
    order: Mutex<Vec<String>>,
}

impl ActionBridge {
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if at least one frontend subscriber is connected — either a
    /// per-session Tauri IPC Channel (normal Tauri runtime) or a debug
    /// WebSocket client.
    ///
    /// When no frontend is connected, dispatch-mode tools should fall back to
    /// direct execution via `tool_service` rather than timing out.
    pub fn has_frontend() -> bool {
        crate::bus::frontend_subscriber_count() > 0
    }

    /// Insert a pending request. Evicts oldest if at capacity.
    fn insert(&self, correlation_id: String, sender: oneshot::Sender<ActionBridgeResult>) {
        let mut pending = self.pending.lock().unwrap();
        let mut order = self.order.lock().unwrap();

        // FIFO eviction
        while pending.len() >= MAX_PENDING {
            if let Some(oldest_key) = order.first().cloned() {
                pending.remove(&oldest_key);
                order.remove(0);
            } else {
                break;
            }
        }

        pending.insert(correlation_id.clone(), sender);
        order.push(correlation_id);
    }

    /// Resolve a pending request with a result. Called by the Tauri command.
    pub fn resolve(&self, correlation_id: &str, result: ActionBridgeResult) -> bool {
        let mut pending = self.pending.lock().unwrap();
        let mut order = self.order.lock().unwrap();

        if let Some(sender) = pending.remove(correlation_id) {
            order.retain(|key| key != correlation_id);
            if sender.send(result).is_err() {
                warn!(
                    "[ide_action] Pending request {} was dropped before result arrived",
                    correlation_id
                );
            }
            true
        } else {
            warn!(
                "[ide_action] No pending request for correlation_id: {}",
                correlation_id
            );
            false
        }
    }
}

// ============================================================================
// Shared execution logic
// ============================================================================

/// Execute an action through the frontend ActionSystem via the `ActionBridge`
/// request/response mechanism (delivered over the Tauri IPC Channel).
/// Shared by `ide`, `app`, and `session` tools.
///
/// Uses the default timeout (`IDE_ACTION_TIMEOUT_SECS`).
pub async fn execute_gui_action(
    bridge: &ActionBridge,
    tool_name: &str,
    params: Value,
) -> Result<String, ToolError> {
    execute_gui_action_with_timeout(bridge, tool_name, params, IDE_ACTION_TIMEOUT_SECS).await
}

/// Execute a GUI action with a custom timeout (in seconds).
///
/// Session operations may take longer than the default 10s (e.g., creating
/// a session spawns a process), so they pass a higher timeout.
pub async fn execute_gui_action_with_timeout(
    bridge: &ActionBridge,
    tool_name: &str,
    params: Value,
    timeout_secs: u64,
) -> Result<String, ToolError> {
    let action = required_string(&params, "action")?;
    let action_params = params
        .get("params")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    // Generate correlation ID
    let correlation_id = uuid::Uuid::new_v4().to_string();

    info!(
        "[{tool_name}] Dispatching: action={action}, correlation_id={correlation_id}, params={}",
        action_params
            .to_string()
            .chars()
            .take(200)
            .collect::<String>()
    );

    // Create oneshot channel for the response
    let (sender, receiver) = oneshot::channel();
    bridge.insert(correlation_id.clone(), sender);

    // Broadcast the action event to the frontend (Tauri IPC Channel)
    broadcast_event(
        "agent:ide_action",
        serde_json::json!({
            "sessionId": "",
            "correlationId": correlation_id,
            "action": action,
            "params": action_params,
        }),
    );

    // Wait for the frontend to respond (with timeout)
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), receiver).await {
        Ok(Ok(result)) => {
            if result.success {
                Ok(result.message)
            } else {
                Ok(format!("{tool_name} action failed: {}", result.message))
            }
        }
        Ok(Err(_)) => Err(ToolError::ExecutionFailed(
            "Action channel closed unexpectedly. The frontend may not be connected.".to_string(),
        )),
        Err(_) => {
            // Timeout — clean up the pending entry
            let mut pending = bridge.pending.lock().unwrap();
            let mut order = bridge.order.lock().unwrap();
            pending.remove(&correlation_id);
            order.retain(|key| key != &correlation_id);

            Err(ToolError::Timeout(format!(
                "{tool_name} action '{action}' timed out after {timeout_secs}s. \
                 The frontend may not be listening."
            )))
        }
    }
}
