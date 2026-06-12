//! Static metadata types backing `BUILTIN_TOOLS`.
//!
//! Pure data definitions: `ToolEntry`, `ActionEntry`, `DEFAULT_TOOL_ENTRY`,
//! plus the `ToolEntry::to_tool_info` projection used by the public
//! `builtin_tool_entries` API. The macros that produce `ActionEntry`
//! literals live in `table.rs` next to the static they populate.

use super::super::categories as tool_categories;
use super::super::ui_metadata::{
    AppSubtool, ChatBlock, HumanToolKey, SimulatorApp, ToolDisplayBehavior, ToolInfo,
};
use crate::definitions::capabilities::RequiredCapability;

/// Static action entry with per-engine, per-state layout recipes.
///
/// See `.cursor/rules/event-rendering.mdc` for the full dispatch model.
#[derive(Clone)]
pub struct ActionEntry {
    pub name: &'static str,
    pub summary: &'static str,
    /// Per-action AppSubtool override. `None` inherits `ToolEntry::app_subtool`.
    pub app_subtool: Option<AppSubtool>,
    /// Per-action ChatBlock override. `None` inherits `ToolEntry::chat_block`.
    pub chat_block: Option<ChatBlock>,
    /// Per-action display behavior override. `None` inherits `ToolEntry::display_behavior`.
    pub display_behavior: Option<ToolDisplayBehavior>,
    /// Optional i18n key overrides. `None` inherits from `ToolEntry`.
    pub label_running: Option<&'static str>,
    pub label_done: Option<&'static str>,
    pub label_failed: Option<&'static str>,
    /// Per-action extra state → i18n key pairs. Merges over the tool-level
    /// `status_labels` when present.
    pub status_labels: &'static [(&'static str, &'static str)],
}

/// Static metadata for a single built-in tool.
///
/// Instantiated only as `&'static` entries inside `BUILTIN_TOOLS`. Use struct
/// update syntax `..DEFAULT_TOOL_ENTRY` so each entry only spells out the
/// fields it cares about.
#[derive(Clone)]
pub struct ToolEntry {
    pub name: &'static str,
    pub description: &'static str,
    /// Longer explanation shown in the Integrations preview panel. May be empty.
    pub description_detail: &'static str,
    pub category: &'static str,
    pub icon_id: &'static str,
    pub simulator_app: SimulatorApp,
    pub app_subtool: AppSubtool,
    /// Chat-panel block dispatch key. Independent from `app_subtool` — the
    /// chat panel uses its own smaller enum with one variant per block.
    pub chat_block: ChatBlock,
    pub display_behavior: ToolDisplayBehavior,
    pub human_tool_key: Option<HumanToolKey>,
    /// If true, the tool is internal plumbing and not shown in user settings.
    pub hidden: bool,
    /// Per-action icon overrides (action name → Lucide icon id).
    pub action_icons: &'static [(&'static str, &'static str)],
    /// Status-dependent icon overrides (status name → Lucide icon id).
    pub status_icons: &'static [(&'static str, &'static str)],
    /// Tool-level i18n key for the "running" status label. Actions inherit
    /// this unless they supply their own override via `ActionEntry`.
    pub label_running: &'static str,
    /// Tool-level i18n key for the "done" status label.
    pub label_done: &'static str,
    /// Tool-level i18n key for the "failed" status label.
    pub label_failed: &'static str,
    /// Extra state → i18n key pairs beyond running/done/failed
    /// (e.g. `("killed", "tools.shellStatus.killed")`). Blocks look these up
    /// when they surface tool-specific sub-states. Mirrors `status_icons`.
    pub status_labels: &'static [(&'static str, &'static str)],
    /// Structured subcommands the tool supports. Empty for single-mode tools.
    pub actions: &'static [ActionEntry],
    /// Which capability group this tool belongs to. Used by
    /// `CapabilitySet::satisfies` to derive availability automatically.
    pub required_capability: RequiredCapability,
}

/// Base entry — every field at its defaults. Use with struct update syntax:
///
/// ```ignore
/// ToolEntry {
///     name: "foo",
///     description: "...",
///     icon_id: "wrench",
///     ..DEFAULT_TOOL_ENTRY
/// }
/// ```
pub const DEFAULT_TOOL_ENTRY: ToolEntry = ToolEntry {
    name: "",
    description: "",
    description_detail: "",
    category: tool_categories::GENERAL,
    icon_id: "",
    simulator_app: SimulatorApp::Channels,
    app_subtool: AppSubtool::Message,
    chat_block: ChatBlock::Fallback,
    display_behavior: ToolDisplayBehavior::WaitForResult,
    human_tool_key: None,
    hidden: false,
    action_icons: &[],
    status_icons: &[],
    label_running: "",
    label_done: "",
    label_failed: "",
    status_labels: &[],
    actions: &[],
    required_capability: RequiredCapability::Core,
};

impl ToolEntry {
    /// Project this static entry into the heap-allocated `ToolInfo` that
    /// the Tauri layer sends to the frontend.
    pub fn to_tool_info(&self, source: &str) -> ToolInfo {
        ToolInfo {
            name: self.name.into(),
            description: self.description.into(),
            description_detail: if self.description_detail.is_empty() {
                None
            } else {
                Some(self.description_detail.into())
            },
            category: self.category.into(),
            source: source.into(),
            supported_agents: super::super::defaults::supported_agents_for(self.name),
            icon_id: self.icon_id.into(),
            action_icons: self
                .action_icons
                .iter()
                .map(|(k, v)| ((*k).into(), (*v).into()))
                .collect(),
            status_icons: self
                .status_icons
                .iter()
                .map(|(k, v)| ((*k).into(), (*v).into()))
                .collect(),
            simulator_app: self.simulator_app,
            app_subtool: self.app_subtool,
            chat_block: self.chat_block,
            display_behavior: self.display_behavior,
            human_tool_key: self.human_tool_key,
            hidden: self.hidden,
            label_running: self.label_running.into(),
            label_done: self.label_done.into(),
            label_failed: self.label_failed.into(),
            status_labels: self
                .status_labels
                .iter()
                .map(|(k, v)| ((*k).into(), (*v).into()))
                .collect(),
            actions: self
                .actions
                .iter()
                .map(|entry| super::projection::project_action(entry, self))
                .collect(),
            required_capability: required_capability_label(self.required_capability).to_string(),
        }
    }
}

fn required_capability_label(
    req: super::super::super::definitions::capabilities::RequiredCapability,
) -> &'static str {
    use super::super::super::definitions::capabilities::RequiredCapability::*;
    match req {
        Core => "core",
        Coding => "coding",
        Desktop => "desktop",
        BrowserExternal => "browserExternal",
        BrowserInternal => "browserInternal",
        Gateway => "gateway",
        Data => "data",
        Management => "management",
        Orchestration => "orchestration",
    }
}
