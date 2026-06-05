//! Work Item Manager agent template.
//!
//! A focused planner/triage agent for creating and updating project-scoped
//! and standalone Work Items. It has read-only research tools plus the
//! management tools required to inspect projects and mutate Work Items.

use crate::definitions::capabilities::{
    BrowserCapability, CapabilitySet, CodingCapability, ManagementCapability,
};
use crate::definitions::schema::{
    AgentDefinition, AgentLearningsConfig, AgentPolicy, AgentTier, AgentToolSelection,
    CompactionConfig, DelegationConfig, SessionMode, SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::impls::orchestration::context_builders::ids as ctx_ids;
use crate::tools::names as tool_names;

pub const WORK_ITEM_MANAGER_AGENT_ID: &str = "builtin:work-item-manager";

pub fn work_item_manager_agent() -> AgentDefinition {
    let capabilities = CapabilitySet {
        coding: Some(CodingCapability { mode_switch: false }),
        desktop: None,
        browser: Some(BrowserCapability {
            external: true,
            internal: false,
        }),
        gateway: None,
        data: None,
        management: Some(ManagementCapability {}),
    };

    AgentDefinition {
        id: WORK_ITEM_MANAGER_AGENT_ID.to_string(),
        name: "Work Item Manager".to_string(),
        description: Some(
            "Plans, researches, creates, links, and updates project or standalone Work Items."
                .to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),
        capabilities: Some(capabilities),
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
                tool_names::CODE_SEARCH.to_string(),
                tool_names::MANAGE_WORKSPACE.to_string(),
                tool_names::WEB_SEARCH.to_string(),
                tool_names::WEB_FETCH.to_string(),
                tool_names::MANAGE_PROJECT.to_string(),
                tool_names::MANAGE_WORK_ITEM.to_string(),
                tool_names::ASK_USER_QUESTIONS.to_string(),
            ]),
            ..Default::default()
        },
        soul_content: Some(include_str!("prompts/work_item_manager.md").to_string()),
        sovereign_prompt: false,
        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: vec![
                ctx_ids::CODE_ACCOUNTS.to_string(),
                ctx_ids::ENVIRONMENT.to_string(),
            ],
        }),
        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        sub_agents: Some(vec![]),
        load_workspace_resources: None,
        load_workspace_rules: None,
        load_workspace_settings: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,
        icon_id: Some("layout-list".to_string()),
        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: Some(AgentLearningsConfig {
            enabled: true,
            extract_memories_enabled: true,
            auto_dream_enabled: false,
        }),
        reliability: None,
        max_instances: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_item_manager_is_research_plus_work_item_only() {
        let agent = work_item_manager_agent();
        let tools = agent
            .tools
            .system_restrict_to_tools
            .expect("Work Item Manager pins a system allowlist");
        for expected in [
            tool_names::READ_FILE,
            tool_names::LIST_DIR,
            tool_names::CODE_SEARCH,
            tool_names::WEB_SEARCH,
            tool_names::WEB_FETCH,
            tool_names::MANAGE_PROJECT,
            tool_names::MANAGE_WORK_ITEM,
        ] {
            assert!(
                tools.iter().any(|tool| tool == expected),
                "missing {expected}"
            );
        }
        for forbidden in [
            tool_names::EDIT_FILE,
            tool_names::APPLY_PATCH,
            tool_names::RUN_SHELL,
            tool_names::MANAGE_AGENT_DEF,
            tool_names::CONTROL_DESKTOP_WITH_PEEKABOO,
        ] {
            assert!(
                !tools.iter().any(|tool| tool == forbidden),
                "Work Item Manager should not pin mutating/non-work-item tool {forbidden}"
            );
        }
    }
}
