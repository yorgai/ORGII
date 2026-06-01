//! Node control system: remote device management.
//!
//! Mobile and remote devices connect to the Tauri app via WebSocket.
//! The agent can invoke commands on them (camera, screen, location, run, notify).
//!
//! # Architecture
//!
//! ```text
//! MobileNode ──WS──> NodeRegistry ──> NodeTool ──> AgentLoop
//!                       ↕
//!                  node.invoke protocol
//! ```
//!
//! # Modules
//!
//! - **`registry.rs`** — Tracks connected nodes, capabilities, pending invocations
//! - **`protocol.rs`** — Message types for the node.invoke protocol
//! - **`command_policy.rs`** — Allowed commands per platform

pub mod command_policy;
pub mod protocol;
pub mod registry;

pub use registry::NodeRegistry;
