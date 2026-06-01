//! Agent Architect template — designs and maintains the agent workforce.
//!
//! The Agent Architect helps the user create, edit, and retire custom
//! agents, agent organizations, and skills. Its capability mix is
//! intentionally narrow: `coding` (for the file tools that author skills
//! and per-agent SOUL augments) plus `management` (for `manage_agent_def`
//! CRUD over agents and orgs). It explicitly does NOT get desktop,
//! browser, data, or gateway — those are out-of-scope and would invite
//! the agent to drift from its lane.
//!
//! Skill discovery: the built-in `create-orgii-agent`, `create-skill`, and
//! `create-rule` skills are always resolvable via the binary-embedded
//! skill loader, so no `source_dirs` entry is needed. The SOUL prompt
//! points the agent at them by name.

use crate::definitions::capabilities::{CapabilitySet, CodingCapability, ManagementCapability};
use crate::definitions::schema::{
    AgentDefinition, AgentLearningsConfig, AgentPolicy, AgentTier, AgentToolSelection,
    CompactionConfig, DelegationConfig, SessionMode, SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::defaults::default_excluded_tools_for_capabilities;
use crate::tools::impls::orchestration::context_builders::ids as ctx_ids;

/// Builtin Agent Architect definition ID.
pub const AGENT_ARCHITECT_ID: &str = "builtin:agent-architect";

/// Agent Architect template — agent / org / skill design specialist.
///
/// Capabilities:
/// - `coding` without mode-switch (the agent edits SKILL.md / SOUL.md
///   files but does not need Build / Plan / Explore / Review modes).
/// - `management` (`manage_agent_def` for agents and orgs).
///
/// Session Model:
/// - Per-session with compaction (CRUD conversations can run long).
/// - Processing lock on (serialize concurrent mutations from the same
///   session so two `manage_agent_def.create` calls can't race).
///
/// Security:
/// - Full autonomy.
/// - Not workspace-restricted: skills can be authored at
///   `~/.orgii/skills/` (global) as well as `<repo>/.orgii/skills/`.
pub fn agent_architect() -> AgentDefinition {
    let capabilities = CapabilitySet {
        coding: Some(CodingCapability { mode_switch: false }),
        desktop: None,
        browser: None,
        gateway: None,
        data: None,
        management: Some(ManagementCapability {}),
    };
    let excluded_tools = default_excluded_tools_for_capabilities(&capabilities);

    AgentDefinition {
        id: AGENT_ARCHITECT_ID.to_string(),
        name: "Agent Architect".to_string(),
        description: Some(
            "Designs and maintains your agent workforce — creates and updates agents, agent organizations, and skills.".to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        capabilities: Some(capabilities.clone()),

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
            excluded_tools,
            ..Default::default()
        },

        soul_content: Some(include_str!("prompts/agent_architect.md").to_string()),
        sovereign_prompt: false,

        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: vec![ctx_ids::ENVIRONMENT.to_string()],
        }),

        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        // `builtin:explore` and `builtin:general` are delegation primitives
        // (`agent_tool` schema fallback + EXPLORE label) and are always
        // reachable regardless of this list. The Architect has no genuine
        // user-facing sub-agent specialists by default.
        sub_agents: Some(vec![]),
        // The three relevant builtin playbooks (`create-orgii-agent`,
        // `create-skill`, `create-rule`) are binary-embedded and always
        // resolvable via the skill loader's fallback path, so no
        // `source_dirs` entry is required. The SOUL prompt instructs the
        // agent to read them on demand.
        load_workspace_resources: None,
        load_workspace_rules: None,
        load_workspace_settings: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: Some("drafting-compass".to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: Some(AgentLearningsConfig {
            enabled: true,
            extract_memories_enabled: true,
            auto_dream_enabled: true,
        }),

        reliability: None,
        max_instances: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::names as tool_names;

    #[test]
    fn agent_architect_has_management_capability() {
        let caps = agent_architect()
            .capabilities
            .expect("Agent Architect declares caps");
        assert!(
            caps.management.is_some(),
            "Agent Architect must have management capability to use manage_agent_def"
        );
    }

    #[test]
    fn agent_architect_has_coding_without_mode_switch() {
        let caps = agent_architect()
            .capabilities
            .expect("Agent Architect declares caps");
        let coding = caps
            .coding
            .expect("Agent Architect needs coding capability for file tools");
        assert!(
            !coding.mode_switch,
            "Agent Architect should not expose Build/Plan/Explore mode switching — \
             it is not a coding worker"
        );
    }

    #[test]
    fn agent_architect_excludes_desktop_and_browser_tools() {
        let excluded = &agent_architect().tools.excluded_tools;
        let tool = tool_names::CONTROL_DESKTOP_WITH_PEEKABOO;
        assert!(
            excluded.iter().any(|t| t == tool),
            "{tool} must be in Agent Architect's default excluded set \
             (the Architect designs agents, it does not operate the desktop)"
        );
    }

    #[test]
    fn agent_architect_subagents_exclude_runtime_primitives() {
        let subs = agent_architect()
            .sub_agents
            .expect("Agent Architect declares sub_agents");
        for forbidden in super::super::SUBAGENT_FORBIDDEN_IDS {
            assert!(
                !subs.iter().any(|s| &s.agent_id == forbidden),
                "Agent Architect must not list runtime primitive {forbidden} as a sub-agent"
            );
        }
    }

    #[test]
    fn agent_architect_is_not_workspace_restricted() {
        // Skills can be authored at the user-global `~/.orgii/skills/`
        // path, not just inside a workspace, so the Architect must not be
        // workspace-restricted.
        let policy = agent_architect()
            .agent_policy
            .expect("Agent Architect declares policy");
        assert!(
            !policy.workspace_only,
            "Agent Architect must be able to write skills to ~/.orgii/skills/ \
             (global scope), so workspace_only must be false"
        );
    }
}
