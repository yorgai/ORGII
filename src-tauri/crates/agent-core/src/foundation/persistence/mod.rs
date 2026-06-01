//! Agent session persistence utilities.
//!
//! This module provides shared persistence helpers for agent sessions:
//! - [`db_helpers`]: Message CRUD, session state updates, LLM history building
//! - [`images`]: Chat image persistence with SHA-256 deduplication
//! - [`session_snapshots`]: Per-session file snapshots for tool-modify rollback

pub mod db_helpers;
pub mod images;
pub mod session_snapshots;

// `AgentResponse` is re-exported flat because state-layer command modules
// import it as `crate::persistence::AgentResponse`. Every other
// item under `db_helpers::*` and `images::*` is consumed via the explicit
// `db_helpers::` / `images::` segment, so we deliberately avoid flat
// re-exports for them — they would all be dead surface.
pub use db_helpers::AgentResponse;
