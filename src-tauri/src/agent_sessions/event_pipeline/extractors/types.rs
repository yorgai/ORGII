//! Extracted rendering data types (compatibility re-export).
//!
//! Canonical definitions live in `core_types::extracted`. This shim
//! keeps existing
//! `crate::agent_sessions::event_pipeline::extractors::types::*`
//! imports compiling while leaf crates depend on `core_types`
//! directly.

pub use core_types::extracted::*;
