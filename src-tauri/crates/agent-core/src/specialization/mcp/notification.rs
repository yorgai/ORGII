//! Server notification bridge type.
//!
//! rmcp delivers notifications via the `ClientHandler` trait (one async
//! method per notification kind). Our `McpManager` historically consumes
//! notifications through an `mpsc::Receiver<ServerNotification>` where the
//! `method` string mirrors the raw MCP wire name (e.g.
//! `"notifications/tools/list_changed"`). We preserve that contract so the
//! manager's listener code doesn't need to know rmcp's typed variants.

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct ServerNotification {
    pub method: String,
    pub params: Option<Value>,
}
