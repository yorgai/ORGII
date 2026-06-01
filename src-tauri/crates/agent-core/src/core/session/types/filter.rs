//! Session filter and query types.
//!
//! `SessionListFilter` lives in `core_types::session` so non-`agent_core`
//! crates (e.g. `project_management`'s orchestrator recovery) can
//! construct one without a reverse dependency on `agent_core`. This
//! module re-exports it so existing `agent_core::session::SessionListFilter`
//! call sites resolve unchanged.

pub use core_types::session::SessionListFilter;
