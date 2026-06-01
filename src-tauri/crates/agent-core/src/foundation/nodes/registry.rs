//! Node registry: tracks connected nodes and manages invocations.
//!
//! Each connected node is a WebSocket client that registers its capabilities.
//! The agent can invoke commands on nodes and wait for results.

use super::command_policy;
use super::protocol::{InvokeRequest, InvokeResult};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot, Mutex};

// ============================================
// Node Session
// ============================================

/// A connected node session.
pub struct NodeSession {
    /// Unique node identifier.
    pub node_id: String,
    /// Human-readable display name.
    pub display_name: Option<String>,
    /// Platform identifier (e.g., "ios", "android").
    pub platform: Option<String>,
    /// Software version.
    pub version: Option<String>,
    /// Supported capabilities.
    pub caps: Vec<String>,
    /// Supported commands.
    pub commands: Vec<String>,
    /// When the node connected.
    pub connected_at: Instant,
    /// Sender to push messages to the node's WebSocket.
    pub ws_sender: mpsc::Sender<String>,
}

/// Serializable node info (for tool output).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub node_id: String,
    pub display_name: Option<String>,
    pub platform: Option<String>,
    pub caps: Vec<String>,
    pub commands: Vec<String>,
    pub connected: bool,
    pub uptime_secs: u64,
}

// ============================================
// Node Registry
// ============================================

/// Registry of connected nodes and pending invocations.
pub struct NodeRegistry {
    /// Connected nodes by ID.
    nodes: HashMap<String, NodeSession>,
    /// Pending invoke callbacks (request_id → result sender).
    pending_invokes: HashMap<String, oneshot::Sender<InvokeResult>>,
    /// Custom command allowlist (from config).
    custom_allowlist: Vec<String>,
}

impl NodeRegistry {
    pub fn new(custom_allowlist: Vec<String>) -> Self {
        Self {
            nodes: HashMap::new(),
            pending_invokes: HashMap::new(),
            custom_allowlist,
        }
    }

    /// List all connected nodes.
    pub fn list_nodes(&self) -> Vec<NodeInfo> {
        self.nodes
            .values()
            .map(|session| NodeInfo {
                node_id: session.node_id.clone(),
                display_name: session.display_name.clone(),
                platform: session.platform.clone(),
                caps: session.caps.clone(),
                commands: session.commands.clone(),
                connected: true,
                uptime_secs: session.connected_at.elapsed().as_secs(),
            })
            .collect()
    }

    /// Get info about a specific node.
    pub fn describe_node(&self, node_id: &str) -> Option<NodeInfo> {
        self.nodes.get(node_id).map(|session| NodeInfo {
            node_id: session.node_id.clone(),
            display_name: session.display_name.clone(),
            platform: session.platform.clone(),
            caps: session.caps.clone(),
            commands: session.commands.clone(),
            connected: true,
            uptime_secs: session.connected_at.elapsed().as_secs(),
        })
    }

    /// Invoke a command on a node and wait for the result.
    ///
    /// Returns the invoke result or an error if the node is not found,
    /// the command is not allowed, or the invocation times out.
    pub async fn invoke(
        registry: &Arc<Mutex<Self>>,
        node_id: &str,
        command: &str,
        params: Option<serde_json::Value>,
        timeout_ms: u64,
    ) -> Result<InvokeResult, String> {
        let request_id = uuid::Uuid::new_v4().to_string();

        // Check command policy and send request while holding the lock
        let (result_rx, ws_sender) = {
            let mut reg = registry.lock().await;

            // First get the info we need via immutable borrows
            let (platform, commands, ws_sender) = {
                let session = reg
                    .nodes
                    .get(node_id)
                    .ok_or_else(|| format!("Node '{}' not connected", node_id))?;

                (
                    session.platform.clone(),
                    session.commands.clone(),
                    session.ws_sender.clone(),
                )
            };

            // Check command policy
            if !command_policy::is_command_allowed(
                command,
                platform.as_deref(),
                &reg.custom_allowlist,
            ) {
                return Err(format!("Command '{}' is not allowed by policy", command));
            }

            // Check node supports the command
            if !commands.is_empty() && !commands.iter().any(|cmd| cmd == command) {
                return Err(format!(
                    "Node '{}' does not support command '{}'. Available: {:?}",
                    node_id, command, commands
                ));
            }

            // Create response channel (mutable borrow is fine now)
            let (result_tx, result_rx) = oneshot::channel::<InvokeResult>();
            reg.pending_invokes.insert(request_id.clone(), result_tx);

            (result_rx, ws_sender)
        };

        // Build and send the invoke request
        let request = InvokeRequest {
            id: request_id.clone(),
            node_id: node_id.to_string(),
            command: command.to_string(),
            params,
            timeout_ms: Some(timeout_ms),
        };

        let msg = serde_json::json!({
            "type": "invoke_request",
            "id": request.id,
            "nodeId": request.node_id,
            "command": request.command,
            "params": request.params,
            "timeoutMs": request.timeout_ms,
        });

        ws_sender
            .send(
                serde_json::to_string(&msg)
                    .expect("node-bridge request envelope serialization is infallible"),
            )
            .await
            .map_err(|err| format!("Failed to send to node: {}", err))?;

        // Wait for result with timeout
        let timeout = tokio::time::Duration::from_millis(timeout_ms);
        match tokio::time::timeout(timeout, result_rx).await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(_)) => {
                // Channel closed — node disconnected
                let mut reg = registry.lock().await;
                reg.pending_invokes.remove(&request_id);
                Err(format!("Node '{}' disconnected before responding", node_id))
            }
            Err(_) => {
                // Timeout
                let mut reg = registry.lock().await;
                reg.pending_invokes.remove(&request_id);
                Err(format!(
                    "Invoke timed out after {}ms: {} on {}",
                    timeout_ms, command, node_id
                ))
            }
        }
    }
}
