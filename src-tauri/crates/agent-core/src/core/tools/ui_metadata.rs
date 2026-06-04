//! Wire types and enums for built-in agent tool metadata.
//!
//! The actual tool table lives in [`builtin_tools`](super::builtin_tools); this
//! module only owns the [`ToolInfo`] struct and the supporting enums shared
//! with the frontend.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::traits::ToolAction;

/// Which agent types can run a given tool.
///
/// Serializes to lowercase strings ("os", "sde", etc.) so the JSON output
/// seen by the frontend stays identical to the old `Vec<String>` approach.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Os,
    Sde,
    Custom,
}

impl AgentKind {
    /// Common preset: all standard agents.
    pub const ALL: &[AgentKind] = &[AgentKind::Os, AgentKind::Sde, AgentKind::Custom];
}

/// Simulator app types for routing events to the correct replay panel.
/// Must match frontend `AppType` enum values.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SimulatorApp {
    CodeEditor,
    Browser,
    #[default]
    Channels,
    DbManager,
    ProjectManager,
    BackgroundTasks,
    Canvas,
}

/// Workstation panel key for tool → UI correlation.
/// Maps to i18n keys: `settings:agent.humanTool.{key}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HumanToolKey {
    CodeEditor,
    Terminal,
    Browser,
    Sessions,
    ProjectManager,
    App,
}

// `AppSubtool` and `ChatBlock` were hoisted to `core_types::ui_metadata`
// so the CLI alias map (also hoisted to `core_types::cli_alias`) can use
// them without depending back on `agent_core`. Re-exported here so every
// existing `super::ui_metadata::{AppSubtool, ChatBlock}` import in
// `agent_core` keeps working unchanged.
pub use core_types::ui_metadata::{AppSubtool, ChatBlock};

impl HumanToolKey {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CodeEditor => "codeEditor",
            Self::Terminal => "terminal",
            Self::Browser => "browser",
            Self::Sessions => "sessions",
            Self::ProjectManager => "storyManager",
            Self::App => "app",
        }
    }
}

/// Tool metadata returned to the frontend for the settings UI.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    /// Longer explanation for the Integrations tool preview (built-in tools only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_detail: Option<String>,
    pub category: String,
    /// Where this tool comes from. Always `"builtin"` —
    /// MCP tools reach the frontend via the MCP registry, not through
    /// this `ToolInfo` stream.
    #[serde(default = "default_source_builtin")]
    pub source: String,
    /// Which agents have a native implementation.
    #[serde(default)]
    pub supported_agents: Vec<AgentKind>,
    /// Lucide icon id (kebab-case, matches `lucide.dev` slugs). Web UI maps this to React icons;
    /// empty string falls back to name-based lookup on the client.
    #[serde(default)]
    pub icon_id: String,
    /// Action-specific icon overrides. Maps action name (e.g., "navigate", "act") to a Lucide
    /// icon id. Frontend uses this when rendering tool calls with an `action` parameter.
    #[serde(
        default,
        skip_serializing_if = "HashMap::is_empty",
        rename = "actionIcons"
    )]
    pub action_icons: HashMap<String, String>,
    /// Status-dependent icon overrides. Maps event result status (e.g., "approved", "denied",
    /// "switched") to a Lucide icon id. Frontend uses this for event cards with multi-state rendering.
    #[serde(
        default,
        skip_serializing_if = "HashMap::is_empty",
        rename = "statusIcons"
    )]
    pub status_icons: HashMap<String, String>,
    /// Which simulator app this tool's events route to (CODE, BROWSER, MESSAGES, DATABASE, PROJECT).
    #[serde(default, rename = "simulatorApp")]
    pub simulator_app: SimulatorApp,
    /// Sub-tool category within the simulator app (e.g., shell, file_read, search within CODE).
    #[serde(default, rename = "appSubtool")]
    pub app_subtool: AppSubtool,
    /// Chat-panel block dispatch key. Independent from `app_subtool` — the chat
    /// panel has its own small taxonomy (one variant per block component).
    #[serde(default, rename = "chatBlock")]
    pub chat_block: ChatBlock,
    /// Workstation panel key (codeEditor, terminal, browser, etc.). None for tools without a
    /// corresponding Workstation panel.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "humanToolKey"
    )]
    pub human_tool_key: Option<HumanToolKey>,
    /// If true, this tool is hidden from the user-facing tools settings page.
    /// Internal plumbing tools and event renderers set this to true.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    /// Tool-level i18n key for the "running" status label. Frontend uses this
    /// as the default when an individual action does not override it.
    #[serde(
        default,
        skip_serializing_if = "String::is_empty",
        rename = "labelRunning"
    )]
    pub label_running: String,
    /// Tool-level i18n key for the "done" status label.
    #[serde(
        default,
        skip_serializing_if = "String::is_empty",
        rename = "labelDone"
    )]
    pub label_done: String,
    /// Tool-level i18n key for the "failed" status label.
    #[serde(
        default,
        skip_serializing_if = "String::is_empty",
        rename = "labelFailed"
    )]
    pub label_failed: String,
    /// Extra state → i18n key map for states beyond running/done/failed
    /// (e.g. "killed", "background", "answered", "pattern_matched").
    /// Blocks look these up when they surface tool-specific sub-states.
    /// Mirrors the `status_icons` design exactly.
    #[serde(
        default,
        skip_serializing_if = "HashMap::is_empty",
        rename = "statusLabels"
    )]
    pub status_labels: HashMap<String, String>,
    /// Structured actions/subcommands from the runtime `Tool::actions()` method.
    /// Populated at query time when a live tool registry is available; empty for
    /// static-only entries. Frontend prefers this over parsing `description_detail`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<ToolAction>,
    /// Capability bucket this tool belongs to. Frontend uses this to grey out
    /// tools when the agent's `CapabilitySet` doesn't satisfy them. Values
    /// match the lowercase variant names of `RequiredCapability`:
    /// `"core"`, `"coding"`, `"desktop"`, `"browserExternal"`, `"browserInternal"`,
    /// `"gateway"`, `"data"`, `"management"`, `"orchestration"`. Empty for MCP / dynamic tools.
    #[serde(
        default,
        skip_serializing_if = "String::is_empty",
        rename = "requiredCapability"
    )]
    pub required_capability: String,
}

fn is_false(val: &bool) -> bool {
    !val
}

fn default_source_builtin() -> String {
    "builtin".into()
}

#[cfg(test)]
mod tests {
    use super::super::builtin_tools::builtin_tool_entries;

    #[test]
    fn test_hidden_field_serialization() {
        let entries = builtin_tool_entries("builtin".to_string());
        let visible = entries
            .iter()
            .find(|t| t.name == "read_file")
            .expect("read_file should exist");
        let hidden = entries
            .iter()
            .find(|t| t.name == "thinking")
            .expect("thinking should exist");

        assert!(!visible.hidden);
        assert!(hidden.hidden);

        let json_visible = serde_json::to_string(visible).unwrap();
        let json_hidden = serde_json::to_string(hidden).unwrap();

        assert!(
            !json_visible.contains("hidden"),
            "visible tool JSON should NOT contain hidden field, got: {}",
            json_visible
        );
        assert!(
            json_hidden.contains("\"hidden\":true"),
            "hidden tool JSON MUST contain hidden:true, got: {}",
            json_hidden
        );
    }

    #[test]
    fn test_builtin_entries_hidden_count() {
        let entries = builtin_tool_entries("builtin".to_string());
        let hidden_count = entries.iter().filter(|t| t.hidden).count();
        let visible_count = entries.iter().filter(|t| !t.hidden).count();

        assert!(hidden_count > 0, "should have hidden tools");
        assert!(visible_count > 0, "should have visible tools");

        let hidden_names: Vec<&str> = entries
            .iter()
            .filter(|t| t.hidden)
            .map(|t| t.name.as_str())
            .collect();
        assert!(
            hidden_names.contains(&"thinking"),
            "thinking should be hidden"
        );
        assert!(
            hidden_names.contains(&"manage_session"),
            "manage_session should be hidden"
        );
        assert!(
            hidden_names.contains(&"tool_search"),
            "tool_search should be hidden"
        );

        let visible_names: Vec<&str> = entries
            .iter()
            .filter(|t| !t.hidden)
            .map(|t| t.name.as_str())
            .collect();
        assert!(
            visible_names.contains(&"read_file"),
            "read_file should be visible"
        );
        assert!(
            visible_names.contains(&"edit_file"),
            "edit_file should be visible"
        );
    }
}
