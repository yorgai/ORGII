//! Layer 0: Infrastructure foundations.
//!
//! Low-level primitives that all higher layers depend on:
//! message bus, persistence, security,
//! node control, tool infrastructure, and flow awareness.

pub mod bus;
pub mod db_bridge;
pub mod flow_awareness;
pub mod nodes;
pub mod persistence;
pub mod security;
pub mod session_bridge;
pub mod streaming;
pub mod tool_infra;
pub mod utils;
