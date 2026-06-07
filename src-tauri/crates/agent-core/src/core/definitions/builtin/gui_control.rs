//! ORGII GUI Control agent template — app UI automation specialist.
//!
//! This agent is launched by the floating Agent Control surface. It keeps a
//! narrow prompt/tool posture so app-control requests do not pay the full OS
//! Agent desktop-automation surface unless the user explicitly needs it.

use crate::definitions::capabilities::{CapabilitySet, ManagementCapability};
use crate::definitions::schema::{
    AgentDefinition, AgentLearningsConfig, AgentPolicy, AgentTier, AgentToolSelection, SessionMode,
    SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::names as tool_names;

/// Builtin ORGII GUI Control agent definition ID.
pub const GUI_CONTROL_AGENT_ID: &str = "builtin:gui-control";

/// ORGII GUI Control agent — focused frontend ActionSystem operator.
pub fn gui_control_agent() -> AgentDefinition {
    let capabilities = CapabilitySet {
        desktop: None,
        browser: None,
        coding: None,
        gateway: None,
        data: None,
        management: Some(ManagementCapability {}),
    };

    AgentDefinition {
        id: GUI_CONTROL_AGENT_ID.to_string(),
        name: "ORGII GUI Control".to_string(),
        description: Some(
            "Fast ORGII app-control agent for settings, navigation, panels, and visible UI state."
                .to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),
        capabilities: Some(capabilities),
        session_model: Some(SessionModel {
            mode: SessionMode::Singleton,
            compaction: None,
            processing_lock: true,
            max_iterations: 80,
        }),
        agent_policy: Some(AgentPolicy {
            autonomy: AutonomyLevel::Full,
            workspace_only: true,
            ..Default::default()
        }),
        tools: AgentToolSelection {
            system_restrict_to_tools: Some(vec![
                tool_names::ASK_USER_QUESTIONS.to_string(),
                tool_names::CONTROL_ORGII.to_string(),
                tool_names::MANAGE_SESSION.to_string(),
                tool_names::SPOTLIGHT.to_string(),
                tool_names::READ_FILE.to_string(),
                tool_names::LIST_SESSION_WORKSPACE.to_string(),
            ]),
            ..Default::default()
        },
        soul_content: Some(include_str!("prompts/gui_control.md").to_string()),
        sovereign_prompt: false,
        delegation_config: None,
        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        sub_agents: Some(vec![]),
        load_workspace_resources: Some(false),
        load_workspace_rules: Some(false),
        load_workspace_settings: Some(false),
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,
        icon_id: Some("mouse-pointer-click".to_string()),
        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: Some(1),
        learnings: Some(AgentLearningsConfig {
            enabled: false,
            extract_memories_enabled: false,
            auto_dream_enabled: false,
        }),
        reliability: None,
        max_instances: Some(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_control_agent_uses_narrow_system_tool_allowlist() {
        let agent = gui_control_agent();
        let tools = agent
            .tools
            .system_restrict_to_tools
            .expect("GUI Control must be system-restricted");

        assert!(tools.contains(&tool_names::MANAGE_SESSION.to_string()));
        assert!(tools.contains(&tool_names::CONTROL_ORGII.to_string()));
        assert!(tools.contains(&tool_names::SPOTLIGHT.to_string()));
        assert!(tools.contains(&tool_names::ASK_USER_QUESTIONS.to_string()));
        assert!(!tools.contains(&tool_names::RUN_SHELL.to_string()));
        assert!(!tools.contains(&tool_names::EDIT_FILE.to_string()));
        assert!(!tools.contains(&tool_names::CONTROL_DESKTOP_WITH_PEEKABOO.to_string()));
        assert!(!tools.contains(&tool_names::CONTROL_BROWSER_WITH_PLAYWRIGHT.to_string()));
    }
}
