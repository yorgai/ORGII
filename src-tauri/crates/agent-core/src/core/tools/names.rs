//! Canonical tool name constants — single source of truth.
//!
//! The actual constants live in `core_types::tool_names` so non-`agent_core`
//! crates (e.g. `project_management`'s lineage event hook) can use them
//! without forming a reverse dependency on `agent_core`. This module
//! re-exports the entire surface verbatim, so all in-tree call sites
//! that go through `crate::tools::names::*` continue to
//! resolve unchanged.

pub use core_types::tool_names::*;
