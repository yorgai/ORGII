//! Single source of truth for all built-in tool metadata.
//!
//! Every built-in tool the frontend needs to know about is declared exactly
//! once in [`BUILTIN_TOOLS`] (in `table.rs`). Both
//! [`builtin_tool_entries`] (which feeds `list_all_tools` /
//! `init_tool_registry` and the Integrations UI) and
//! [`builtin_tool_actions`] (the default impl of
//! [`Tool::actions`](super::traits::Tool::actions)) read from the same
//! table, so UI metadata and LLM-facing tool descriptions can never drift
//! out of sync.
//!
//! To add or update a tool, edit [`BUILTIN_TOOLS`] in `table.rs` —
//! nothing else.
//!
//! Module layout:
//!
//! - **`types`** — `ToolEntry`, `ActionEntry`, `DEFAULT_TOOL_ENTRY`, and the
//!   `ToolEntry::to_tool_info` projection used by the public API.
//! - **`projection`** — `builtin_tool_entries`, `builtin_tool_actions`,
//!   `resolve_effective_app_subtool`.
//! - **`table`** — the `BUILTIN_TOOLS` static + the `action!` / `action_sub!`
//!   macros that build it. Macros stay co-located with the static (they're
//!   only used here).
//!
//! Only the public symbols actually consumed from outside `builtin_tools`
//! are re-exported flat below. `ToolEntry`, `ActionEntry`,
//! `DEFAULT_TOOL_ENTRY` are reached internally through the `types::` segment
//! (see `table/aliases.rs`), so we deliberately do not flatten them.

mod projection;
mod table;
mod types;

pub use projection::{
    builtin_tool_actions, builtin_tool_entries, builtin_tool_required_capability,
    resolve_effective_app_subtool,
};
pub use table::BUILTIN_TOOLS;
