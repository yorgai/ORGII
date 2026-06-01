//! Subagent definitions — lightweight agents spawned via the unified `agent` tool.
//!
//! These replace the hardcoded `explore` and `generalPurpose` types that were
//! previously embedded in `TaskTool`. By expressing them as `AgentDefinition`
//! instances they flow through the same resolution, policy, and execution
//! pipeline as every other agent.

use crate::definitions::schema::{
    AgentDefinition, AgentTier, AgentToolSelection, DelegationConfig, SessionMode, SessionModel,
};
use crate::tools::names as tool_names;

pub const EXPLORE_AGENT_ID: &str = "builtin:explore";
pub const GENERAL_AGENT_ID: &str = "builtin:general";

const EXPLORE_SYSTEM_PROMPT: &str = "\
You are a fast codebase exploration subagent. \
You have read-only access: read files, search code, list directories, query LSP, web search/fetch. \
Be thorough but efficient. For broad investigations, map the relevant files, patterns, call sites, and risks; \
if the parent is planning parallel work, suggest independent slices that can be handled without shared state. \
Return a concise, structured answer with findings, file paths, and recommended next steps.";

const GENERAL_SYSTEM_PROMPT: &str = "\
You are an autonomous coding subagent. \
You have full tool access (except spawning more subagents). \
Complete exactly the assigned unit of work; do not expand into sibling units unless the prompt explicitly asks you to. \
Before editing, understand the local conventions and keep changes scoped so they can be reviewed or merged independently. \
After implementing, run the most relevant focused verification available for your unit. \
Return a concise final summary with changed files, verification results, and any blockers.";

/// Read-only exploration agent (replaces TaskTool `explore` type).
pub fn explore_agent() -> AgentDefinition {
    AgentDefinition {
        id: EXPLORE_AGENT_ID.to_string(),
        name: "Explore".to_string(),
        description: Some("Fast, read-only codebase search and analysis subagent.".to_string()),
        built_in: true,
        tier: AgentTier::Secondary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        session_model: Some(SessionModel {
            mode: SessionMode::PerSession,
            compaction: None,
            processing_lock: false,
            max_iterations: 500,
        }),

        capabilities: None,

        // Read-only strict allowlist.
        tools: AgentToolSelection {
            system_restrict_to_tools: Some(vec![
                tool_names::READ_FILE.to_string(),
                tool_names::CODE_SEARCH.to_string(),
                tool_names::LIST_DIR.to_string(),
                tool_names::MANAGE_WORKSPACE.to_string(),
                tool_names::WEB_SEARCH.to_string(),
                tool_names::WEB_FETCH.to_string(),
                tool_names::QUERY_LSP.to_string(),
                tool_names::MANAGE_TODO.to_string(),
            ]),
            ..Default::default()
        },

        soul_content: Some(EXPLORE_SYSTEM_PROMPT.to_string()),
        sovereign_prompt: false,

        temperature: Some(0.0),
        max_tokens: None,

        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: Vec::new(),
        }),

        context_window: None,
        sub_agents: None,
        load_workspace_resources: None,
        load_workspace_rules: None,
        load_workspace_settings: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: Some("search".to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: None,

        agent_policy: None,
        reliability: None,
        max_instances: None,
    }
}

/// General-purpose subagent (replaces TaskTool `generalPurpose` type).
pub fn general_agent() -> AgentDefinition {
    AgentDefinition {
        id: GENERAL_AGENT_ID.to_string(),
        name: "General Purpose".to_string(),
        description: Some(
            "General research and implementation subagent with full tool access.".to_string(),
        ),
        built_in: true,
        tier: AgentTier::Secondary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        session_model: Some(SessionModel {
            mode: SessionMode::PerSession,
            compaction: None,
            processing_lock: false,
            max_iterations: 500,
        }),

        capabilities: None,

        // Inherit all tools, exclude recursion + ask_user.
        tools: AgentToolSelection {
            excluded_tools: vec![
                tool_names::AGENT.to_string(),
                tool_names::ASK_USER_QUESTIONS.to_string(),
            ],
            ..Default::default()
        },

        soul_content: Some(GENERAL_SYSTEM_PROMPT.to_string()),
        sovereign_prompt: false,

        temperature: Some(0.0),
        max_tokens: None,

        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: Vec::new(),
        }),

        context_window: None,
        sub_agents: None,
        load_workspace_resources: None,
        load_workspace_rules: None,
        load_workspace_settings: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: Some("cpu".to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: None,

        agent_policy: None,
        reliability: None,
        max_instances: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_explore_agent_is_read_only() {
        let agent = explore_agent();
        assert_eq!(agent.id, EXPLORE_AGENT_ID);
        assert!(agent.built_in);

        let allowed = agent
            .tools
            .system_restrict_to_tools
            .as_ref()
            .expect("explore must use strict system_restrict_to_tools");
        assert!(
            allowed.contains(&tool_names::READ_FILE.to_string()),
            "explore must include read_file"
        );
        assert!(
            allowed.contains(&tool_names::CODE_SEARCH.to_string()),
            "explore must include code_search"
        );
        assert!(
            !allowed.contains(&tool_names::EDIT_FILE.to_string()),
            "explore must NOT include edit_file"
        );
        assert!(
            !allowed.contains(&tool_names::RUN_SHELL.to_string()),
            "explore must NOT include run_shell"
        );
    }

    #[test]
    fn test_general_agent_inherits_with_deny() {
        let agent = general_agent();
        assert_eq!(agent.id, GENERAL_AGENT_ID);
        assert!(agent.built_in);

        assert!(
            agent.tools.system_restrict_to_tools.is_none(),
            "general must inherit all tools (no restriction)"
        );
        assert!(
            agent
                .tools
                .excluded_tools
                .contains(&tool_names::AGENT.to_string()),
            "general must exclude the agent tool (prevent recursion)"
        );
        assert!(
            agent
                .tools
                .excluded_tools
                .contains(&tool_names::ASK_USER_QUESTIONS.to_string()),
            "general must exclude ask_user_questions"
        );
    }

    #[test]
    fn test_subagent_max_iterations() {
        let explore = explore_agent();
        let general = general_agent();

        let explore_max = explore.session_model.as_ref().unwrap().max_iterations;
        let general_max = general.session_model.as_ref().unwrap().max_iterations;

        assert_eq!(explore_max, 500);
        assert_eq!(general_max, 500);
    }

    #[test]
    fn test_both_agents_have_soul_content() {
        let explore = explore_agent();
        let general = general_agent();
        assert!(explore.soul_content.is_some());
        assert!(general.soul_content.is_some());
    }
}
