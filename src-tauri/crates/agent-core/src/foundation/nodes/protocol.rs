//! Node communication protocol messages.
//!
//! Defines the `node.invoke` request/response protocol used by node tools.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================
// Handshake
// ============================================

/// Message sent by nodes when connecting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConnectMessage {
    /// Node role (always "node").
    pub role: String,
    /// Unique node identifier.
    pub node_id: String,
    /// Human-readable display name.
    pub display_name: Option<String>,
    /// Platform identifier (e.g., "ios", "android", "macos", "linux").
    pub platform: Option<String>,
    /// Software version.
    pub version: Option<String>,
    /// Supported capabilities (e.g., "camera", "screen", "location").
    #[serde(default)]
    pub caps: Vec<String>,
    /// Supported commands (e.g., "camera.snap", "system.run").
    #[serde(default)]
    pub commands: Vec<String>,
}

/// Acknowledgment sent to nodes after successful connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConnectAck {
    /// Whether the connection was accepted.
    pub ok: bool,
    /// Error message if rejected.
    pub error: Option<String>,
}

// ============================================
// Invoke Protocol
// ============================================

/// Request sent from agent to node (via the gateway).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeRequest {
    /// Unique request ID.
    pub id: String,
    /// Target node ID.
    pub node_id: String,
    /// Command to invoke (e.g., "camera.snap", "system.run").
    pub command: String,
    /// Command parameters as JSON.
    #[serde(default)]
    pub params: Option<Value>,
    /// Timeout in milliseconds.
    pub timeout_ms: Option<u64>,
}

/// Result sent from node back to agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeResult {
    /// Request ID this result corresponds to.
    pub id: String,
    /// Target node ID.
    pub node_id: String,
    /// Whether the invocation succeeded.
    pub ok: bool,
    /// Result payload (on success).
    pub payload: Option<Value>,
    /// Error information (on failure).
    pub error: Option<InvokeError>,
}

/// Error information from a failed invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvokeError {
    /// Error code.
    pub code: Option<String>,
    /// Human-readable error message.
    pub message: String,
}

// ============================================
// WebSocket Message Envelope
// ============================================

/// Envelope for all WebSocket messages in the node protocol.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeMessage {
    /// Node connection handshake.
    #[serde(rename = "connect")]
    Connect(NodeConnectMessage),

    /// Connection acknowledgment.
    #[serde(rename = "connect_ack")]
    ConnectAck(NodeConnectAck),

    /// Invoke request (agent → node).
    #[serde(rename = "invoke_request")]
    InvokeRequest(InvokeRequest),

    /// Invoke result (node → agent).
    #[serde(rename = "invoke_result")]
    InvokeResult(InvokeResult),

    /// Ping/pong for keepalive.
    #[serde(rename = "ping")]
    Ping,

    #[serde(rename = "pong")]
    Pong,
}
