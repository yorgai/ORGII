//! Agent application state — single Tauri state for all agent types.
//!
//! This module provides a centralized state that manages all agent instances.
//!
//! # Architecture
//!
//! ```text
//! AgentAppState (Tauri managed state)
//!     ├── Shared resources (browser, PTY, memory, gateway)
//!     └── Per-session resources (AgentSession instances)
//! ```

pub mod commands;
pub mod control_flow;
mod integrations_store;
mod session_runtime;
mod unified;

// `IntegrationsStore` and its `UpdateError` are reached only through the
// deeper `state::integrations_store::*` path by sibling submodules
// (`unified.rs`); they don't need to be flattened onto `state::*`.
pub use session_runtime::{AgentSession, SessionRuntime};
pub use unified::AgentAppState;
