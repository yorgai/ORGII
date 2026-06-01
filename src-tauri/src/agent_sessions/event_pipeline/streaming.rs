//! Streaming Buffer (compatibility re-export)
//!
//! The actual implementation now lives at
//! `agent_core::foundation::streaming` so the future extracted
//! `agent-core` crate can own its delta-accumulation primitives without
//! reaching back into `agent_sessions`. This shim keeps existing
//! `agent_sessions::event_pipeline::streaming::*` imports compiling.

pub use agent_core::foundation::streaming::*;
