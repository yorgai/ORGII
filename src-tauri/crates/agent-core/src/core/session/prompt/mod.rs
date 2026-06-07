//! System prompt construction pipeline.
//!
//! - [`builder`]: `build_unified_system_prompt` — assembles the full system prompt
//! - [`sections`]: Individual prompt sections (identity, tools, rules, etc.)
//! - [`helpers`]: Pure utility functions (text truncation, conventions loading)
//! - [`ide_context`]: IDE state formatter (open files, git, linter)

pub mod builder;
pub(crate) mod cache;
pub(crate) mod gui_control_retrieval;
pub(crate) mod helpers;
pub mod ide_context;
pub(crate) mod registry;
pub(crate) mod sections;
