//! Compute-node tools — register, list, and configure remote compute nodes
//! (Daytona / SSH / docker / modal etc.) used by sandboxed shell tools.
//!
//! - [`manage_nodes`] — `manage_nodes` (compute-node CRUD)
//!
//! Category: [`tool_categories::NODES`].
//!
//! [`tool_categories::NODES`]: crate::tools::categories::NODES

pub mod manage_nodes;
