//! Terminal agent template — chat-driven command-line operator.

use crate::definitions::capabilities::{CapabilitySet, CodingCapability};
use crate::definitions::schema::{
    AgentDefinition, AgentPolicy, AgentTier, AgentToolSelection, CompactionConfig, SessionMode,
    SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::names as tool_names;

/// Builtin Terminal agent definition ID.
pub const TERMINAL_AGENT_ID: &str = "builtin:terminal";

/// Terminal Agent — chat-driven operator for command-line tasks.
pub fn terminal_agent() -> AgentDefinition {
    AgentDefinition {
        id: TERMINAL_AGENT_ID.to_string(),
        name: "Terminal Agent".to_string(),
        description: Some(
            "Chat-driven terminal operator for command-line tasks and user terminal inspection."
                .to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        capabilities: Some(CapabilitySet {
            coding: Some(CodingCapability { mode_switch: false }),
            desktop: None,
            browser: None,
            gateway: None,
            data: None,
            management: None,
        }),

        session_model: Some(SessionModel {
            mode: SessionMode::PerSession,
            compaction: Some(CompactionConfig {
                enabled: true,
                trigger_ratio: 0.8,
                keep_ratio: 0.5,
                ..CompactionConfig::default()
            }),
            processing_lock: true,
            max_iterations: 500,
        }),

        agent_policy: Some(AgentPolicy {
            autonomy: AutonomyLevel::Full,
            workspace_only: false,
            ..Default::default()
        }),

        tools: AgentToolSelection {
            system_restrict_to_tools: Some(vec![
                tool_names::READ_FILE.to_string(),
                tool_names::LIST_DIR.to_string(),
                tool_names::EDIT_FILE.to_string(),
                tool_names::RUN_SHELL.to_string(),
                tool_names::AWAIT_OUTPUT.to_string(),
                tool_names::INSPECT_TERMINALS.to_string(),
            ]),
            ..Default::default()
        },

        soul_content: Some(include_str!("prompts/terminal.md").to_string()),
        sovereign_prompt: false,
        delegation_config: None,
        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        sub_agents: None,
        load_workspace_resources: Some(false),
        load_workspace_rules: None,
        load_workspace_settings: Some(false),
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,
        icon_id: Some("terminal".to_string()),
        animate: None,
        execution_mode: None,
        exec_timeout: Some(120),
        max_tool_use_concurrency: Some(3),
        learnings: None,
        reliability: None,
        max_instances: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_agent_has_limited_tool_allowlist() {
        let allow = terminal_agent()
            .tools
            .system_restrict_to_tools
            .expect("Terminal Agent ships with a system tool allow-list");

        assert_eq!(
            allow,
            vec![
                tool_names::READ_FILE.to_string(),
                tool_names::LIST_DIR.to_string(),
                tool_names::EDIT_FILE.to_string(),
                tool_names::RUN_SHELL.to_string(),
                tool_names::AWAIT_OUTPUT.to_string(),
                tool_names::INSPECT_TERMINALS.to_string(),
            ]
        );

        for forbidden in [
            tool_names::AGENT,
            tool_names::TOOL_SEARCH,
            tool_names::CODE_SEARCH,
            tool_names::APPLY_PATCH,
            tool_names::DELETE_FILE,
            tool_names::QUERY_LSP,
            tool_names::MANAGE_LSP,
            tool_names::MANAGE_TODO,
        ] {
            assert!(
                !allow.iter().any(|tool| tool == forbidden),
                "{forbidden} must not be in Terminal Agent's default allow-list"
            );
        }
    }
}
