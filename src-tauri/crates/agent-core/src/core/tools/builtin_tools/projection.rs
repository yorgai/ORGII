//! Projection helpers + public lookup API over `BUILTIN_TOOLS`.
//!
//! Everything callers outside `builtin_tools` reach for lives here:
//!
//! - `builtin_tool_entries` — feeds `list_all_tools` / Integrations UI.
//! - `builtin_tool_actions` — default impl of `Tool::actions()`.
//! - `resolve_effective_app_subtool` — `(tool, action)` → effective
//!   `AppSubtool` dispatch key.
//!
//! The internal `project_action` is `pub(super)` so `ToolEntry::to_tool_info`
//! in `types.rs` can call it; nothing outside `builtin_tools` should need it.

use super::super::super::definitions::capabilities::RequiredCapability;
use super::super::traits::ToolAction;
use super::super::ui_metadata::{AppSubtool, ToolInfo};
use super::table::BUILTIN_TOOLS;
use super::types::{ActionEntry, ToolEntry};

/// Generate the list of `ToolInfo` records used by the frontend.
pub fn builtin_tool_entries(source: String) -> Vec<ToolInfo> {
    BUILTIN_TOOLS
        .iter()
        .map(|entry| entry.to_tool_info(source.as_str()))
        .collect()
}

/// Return structured action metadata for a built-in tool by canonical name.
///
/// Empty vec for single-mode tools and for names not in the table.
pub fn builtin_tool_actions(name: &str) -> Vec<ToolAction> {
    let Some(entry) = BUILTIN_TOOLS.iter().find(|entry| entry.name == name) else {
        return Vec::new();
    };
    entry
        .actions
        .iter()
        .map(|action| project_action(action, entry))
        .collect()
}

/// Return the capability required by a built-in tool.
pub fn builtin_tool_required_capability(name: &str) -> Option<RequiredCapability> {
    BUILTIN_TOOLS
        .iter()
        .find(|entry| entry.name == name)
        .map(|entry| entry.required_capability)
}

/// Resolve the effective `AppSubtool` for a `(tool, action)` pair.
///
/// Action-level override > tool default. Returns `None` when the tool is not
/// a built-in (e.g. dynamic MCP tool) — callers should fall back to
/// `AppSubtool::OtherTool` or their own default.
pub fn resolve_effective_app_subtool(
    tool_name: &str,
    action_name: Option<&str>,
) -> Option<AppSubtool> {
    let entry = BUILTIN_TOOLS.iter().find(|entry| entry.name == tool_name)?;

    if let Some(action_name) = action_name {
        if let Some(action) = entry.actions.iter().find(|a| a.name == action_name) {
            if let Some(subtool) = action.app_subtool {
                return Some(subtool);
            }
        }
    }

    Some(entry.app_subtool)
}

/// Project a static `ActionEntry` + its parent `ToolEntry` into a heap-allocated `ToolAction`.
pub(super) fn project_action(action: &ActionEntry, tool: &ToolEntry) -> ToolAction {
    ToolAction {
        name: action.name.into(),
        summary: action.summary.into(),
        app_subtool: action.app_subtool,
        chat_block: action.chat_block,
        label_running: action.label_running.unwrap_or(tool.label_running).into(),
        label_done: action.label_done.unwrap_or(tool.label_done).into(),
        label_failed: action.label_failed.unwrap_or(tool.label_failed).into(),
        status_labels: action
            .status_labels
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect(),
    }
}
