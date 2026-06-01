//! Tool module for agent_core.
//!
//! Provides the [`Tool`] trait, [`ToolRegistry`], and [`ToolPolicy`] system
//! shared by all agent implementations.
//!
//! - [`names`]: Canonical tool name constants (single source of truth)
//! - [`builtin_tools`]: Single source of truth for all built-in tool metadata
//!   (icons, categories, simulator routing, structured actions). Both
//!   `list_all_tools` and the runtime `Tool::actions()` default read from here.
//! - [`ui_metadata`]: Tool-info enums and the [`ToolInfo`] wire struct shared
//!   with the frontend.
//! - [`defaults`]: Subagent deny lists, role-scoped support metadata, and
//!   `supported_agents_for()`

pub mod builtin_tools;
pub mod categories;
pub mod defaults;
pub mod error;
pub mod file_history;
pub mod impls;
pub mod interactive;
pub mod metadata;
pub mod names;
pub mod params;
pub mod policy;
pub mod registration;
pub mod registry;
pub mod result;
pub mod traits;
pub mod ui_metadata;

#[cfg(test)]
#[path = "tests/defaults_tests.rs"]
mod defaults_tests;

#[cfg(test)]
#[path = "tests/ui_metadata_tests.rs"]
mod ui_metadata_tests;

#[cfg(test)]
#[path = "tests/job_registry_tests.rs"]
mod job_registry_tests;

#[cfg(test)]
#[path = "tests/running_shell_jobs_tests.rs"]
mod running_shell_jobs_tests;

#[cfg(test)]
#[path = "tests/await_tool_tests.rs"]
mod await_tool_tests;

#[cfg(test)]
#[path = "tests/search_tool_tests.rs"]
mod search_tool_tests;

// Items kept at the `tools::` surface — checked one by one against the
// real call sites. Everything else (`Tool`, `ToolError`, `ToolRegistry`,
// `ToolPolicy*`, `ui_metadata::*`, `names::*`, `builtin_tools::*`, etc.)
// is consumed exclusively via the deeper submodule path
// (`tools::traits::Tool`, `tools::registry::ToolRegistry`,
// `tools::names as tool_names`, `tools::policy::*`,
// `tools::ui_metadata::*`, `tools::builtin_tools`), so flat re-exports for
// those would all be dead surface.
pub use defaults::derive_disabled_tools;
pub use interactive::is_interactive_tool;
