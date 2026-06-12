//! Wingman agent template — screen-aware co-pilot.
//!
//! The Wingman agent watches the user's screen and provides real-time
//! observations, nudges, and answers. It can also take action through
//! the bundled Peekaboo desktop CLI, run shell commands, and delegate
//! to subagents when the user asks.
//!
//! Coding tools (edit_file, LSP) are intentionally OFF by
//! default — Wingman is a desktop co-pilot, not a code editor. Users
//! who want it to edit files can opt in via the Tools tab.
//!
//! Session model: singleton (one global Wingman session at a time).

use crate::definitions::capabilities::{CapabilitySet, DesktopCapability};
use crate::definitions::schema::{
    AgentDefinition, AgentPolicy, AgentTier, AgentToolSelection, SessionMode, SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::names as tool_names;

/// Builtin Wingman agent definition ID.
pub const WINGMAN_AGENT_ID: &str = "builtin:wingman";

/// Wingman agent — screen-observation specialist.
///
/// Capabilities:
/// - Desktop vision (screenshots, UI element inspection)
/// - Code context (read_file, list_dir, code_search) — read-only by default
/// - Terminal (run_shell, await_output)
///
/// Session Model:
/// - Singleton (one global Wingman overlay)
/// - No compaction (short observations, not long conversations)
/// - No processing lock (allow concurrent requests)
///
/// Security:
/// - Full autonomy (tool calls execute without per-call approval prompts;
///   high-risk commands are still blocked by SecurityPolicy)
/// - Workspace-only file access
///
/// Coding tools (edit_file, LSP) are NOT in the default
/// allow-list. Wingman is a desktop co-pilot, not a code editor; users
/// who want it to mutate files can add the tools from the Tools tab.
pub fn wingman_agent() -> AgentDefinition {
    AgentDefinition {
        id: WINGMAN_AGENT_ID.to_string(),
        name: "Wingman Agent".to_string(),
        description: Some(
            "Screen-observation agent that watches your display and provides real-time nudges."
                .to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        capabilities: Some(CapabilitySet {
            desktop: Some(DesktopCapability { enabled: true }),
            coding: None,
            browser: None,
            gateway: None,
            data: None,
            management: None,
        }),

        session_model: Some(SessionModel {
            mode: SessionMode::Singleton,
            compaction: None,
            processing_lock: false,
            max_iterations: 30,
        }),

        agent_policy: Some(AgentPolicy {
            autonomy: AutonomyLevel::Full,
            workspace_only: false,
            ..Default::default()
        }),

        tools: AgentToolSelection {
            system_restrict_to_tools: Some(vec![
                tool_names::CONTROL_DESKTOP_WITH_PEEKABOO.to_string(),
                tool_names::READ_FILE.to_string(),
                tool_names::LIST_DIR.to_string(),
                tool_names::CODE_SEARCH.to_string(),
                tool_names::RUN_SHELL.to_string(),
                tool_names::AWAIT_OUTPUT.to_string(),
                tool_names::AGENT.to_string(),
            ]),
            ..Default::default()
        },

        soul_content: Some(include_str!("prompts/wingman.md").to_string()),
        sovereign_prompt: false,

        delegation_config: None,
        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        sub_agents: None,
        load_workspace_resources: None,
        load_workspace_rules: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: Some("hand-metal".to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: None,

        reliability: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wingman_does_not_allow_coding_tools_by_default() {
        let allow = wingman_agent()
            .tools
            .system_restrict_to_tools
            .expect("wingman ships with a system_restrict_to_tools allow-list");

        for forbidden in [
            tool_names::EDIT_FILE,
            tool_names::DELETE_FILE,
            tool_names::QUERY_LSP,
            tool_names::MANAGE_LSP,
        ] {
            assert!(
                !allow.iter().any(|t| t == forbidden),
                "{forbidden} must NOT be in Wingman's default allow-list \
                 (coding tools are opt-in)"
            );
        }
    }

    #[test]
    fn wingman_capabilities_have_no_coding() {
        let caps = wingman_agent().capabilities.expect("wingman has caps");
        assert!(
            caps.coding.is_none(),
            "Wingman should not declare coding capability — it's a desktop co-pilot"
        );
        assert!(
            caps.desktop.is_some(),
            "Wingman is a desktop agent, desktop capability must stay on"
        );
    }
}
