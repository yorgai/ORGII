//! Transport Layer - Cross-platform communication abstraction
//!
//! This module provides a unified interface for cross-platform communication,
//! abstracting away the specific implementation details (Tauri, CLI, WebSocket, etc.)
//!
//! Based on BitFun's transport layer design, this enables:
//! - Platform-agnostic event emission
//! - Easy testing with mock adapters
//! - Future extensibility for additional platforms

pub mod adapters;
pub mod emitter;
pub mod traits;

pub use adapters::TauriTransportAdapter;
pub use emitter::TransportEmitter;
pub use traits::{AgentEvent, TextChunk, ToolEvent, TransportAdapter};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
#[path = "tests/transport_tests.rs"]
mod tests;
