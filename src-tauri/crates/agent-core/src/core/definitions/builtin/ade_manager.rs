//! ADE Manager template — manages the Agentic Development Environment and
//! controls the ORGII app UI.
//!
//! ADE Manager is the built-in operator for ORGII's Agentic Development
//! Environment (ADE): the IDE-AI analogue that wires up agents, agent
//! organizations, skills, rules, tracked workspaces, and repo setup. It
//! helps the user create, edit, and retire custom agents and orgs, author
//! skills and rules, and onboard repos as tracked workspaces.
//!
//! It also subsumes the former GUI Control agent: it can navigate and
//! control the ORGII app UI via `control_orgii`, `spotlight`, and
//! `read_file` / `list_session_workspace` for context. This makes ADE
//! Manager the single entry point reachable from the Spotlight palette
//! for both "set up my dev environment" and "navigate / change the app UI"
//! requests.
//!
//! Capability mix is intentionally narrow: `coding` (for workspace setup
//! and file tools that author skills and per-agent SOUL augments) plus
//! `management` (for `manage_agent_def` CRUD over agents and orgs). It
//! explicitly does NOT get desktop, browser, data, or gateway — those are
//! out-of-scope and would invite the agent to drift from its lane.
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
use crate::tools::names as tool_names;

/// Builtin ADE Manager definition ID.
///
/// The string value `"builtin:agent-architect"` is preserved verbatim for
/// stability — existing on-disk session records, overlay files, and user
/// preferences reference this ID. The user-facing name and the Rust
/// symbols are the only things that change with the ADE rebrand.
pub const ADE_MANAGER_ID: &str = "builtin:agent-architect";

/// ADE Manager template — Agentic Development Environment specialist and
/// ORGII app UI controller.
///
/// Capabilities:
/// - `coding` without mode-switch (the agent edits SKILL.md / SOUL.md
///   files but does not need Build / Plan / Explore / Review modes).
/// - `management` (`manage_agent_def` for agents and orgs).
/// - `manage_workspace` through coding tools for tracked repos and folders.
/// - `control_orgii` + `spotlight` for ORGII app UI control (subsumes the
///   former `builtin:gui-control` agent).
///
/// Session Model:
/// - Singleton with compaction: only one ADE Manager session runs at a
///   time (matching the old GUI Control singleton behaviour so the
///   Spotlight palette always resumes the same session), but compaction
///   is still enabled so long ADE conversations do not overflow context.
/// - Processing lock on: serialises concurrent mutations.
///
/// Security:
/// - Full autonomy.
/// - Not workspace-restricted: skills can be authored at
///   `~/.orgii/skills/` (global) as well as `<repo>/.orgii/skills/`.
pub fn ade_manager() -> AgentDefinition {
    let capabilities = CapabilitySet {
        coding: Some(CodingCapability { mode_switch: false }),
        desktop: None,
        browser: None,
        gateway: None,
        data: None,
        management: Some(ManagementCapability {}),
    };
    let mut excluded_tools = default_excluded_tools_for_capabilities(&capabilities);

    // Re-enable GUI-control tools that `default_excluded_tools_for_capabilities`
    // would otherwise suppress for a coding-only agent.
    excluded_tools.retain(|tool| {
        tool != tool_names::CONTROL_ORGII
            && tool != tool_names::SPOTLIGHT
            && tool != tool_names::LIST_SESSION_WORKSPACE
    });

    // Hard-block subagent spawning. The `agent` tool is how the LLM delegates
    // tasks to subagents. Excluding it removes the tool from ADE Manager's
    // schema entirely — the LLM never sees it and cannot call it, regardless
    // of any allowlist bypass in the runtime (builtin:explore / builtin:general
    // are ordinarily exempt from the sub_agents allowlist check, so sub_agents:
    // Some(vec![]) alone is not sufficient). ADE Manager proposes new sessions
    // via session.propose instead of spawning inline subagents.
    excluded_tools.push(tool_names::AGENT.to_string());

    AgentDefinition {
        id: ADE_MANAGER_ID.to_string(),
        name: "ADE Manager".to_string(),
        description: Some(
            "Manages the Agentic Development Environment (agents, orgs, skills, rules, \
             workspaces, repo setup) and controls the ORGII app UI."
                .to_string(),
        ),
        built_in: true,
        tier: AgentTier::Primary,
        inherits_from: Some(super::BASE_AGENT_ID.to_string()),

        capabilities: Some(capabilities.clone()),

        session_model: Some(SessionModel {
            // Singleton so the Spotlight palette always resumes the same
            // session (no accumulation of orphaned ADE sessions).
            mode: SessionMode::Singleton,
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

        soul_content: Some(include_str!("prompts/ade_manager.md").to_string()),
        sovereign_prompt: false,

        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: vec![ctx_ids::ENVIRONMENT.to_string()],
        }),

        context_window: None,
        max_tokens: None,
        temperature: Some(0.0),
        // Empty list + `agent` tool excluded = no subagent spawning at all.
        sub_agents: Some(vec![]),
        // The three relevant builtin playbooks (`create-orgii-agent`,
        // `create-skill`, `create-rule`) are binary-embedded and always
        // resolvable via the skill loader's fallback path.
        load_workspace_resources: Some(false),
        load_workspace_rules: Some(false),
        load_workspace_settings: Some(false),
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: Some("drafting-compass".to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        // Serialise tool calls — GUI control actions must not race.
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
    use crate::tools::names as tool_names;

    #[test]
    fn ade_manager_has_management_capability() {
        let caps = ade_manager()
            .capabilities
            .expect("ADE Manager declares caps");
        assert!(
            caps.management.is_some(),
            "ADE Manager must have management capability to use manage_agent_def"
        );
    }

    #[test]
    fn ade_manager_has_coding_without_mode_switch() {
        let caps = ade_manager()
            .capabilities
            .expect("ADE Manager declares caps");
        let coding = caps
            .coding
            .expect("ADE Manager needs coding capability for file tools");
        assert!(
            !coding.mode_switch,
            "ADE Manager should not expose Build/Plan/Explore mode switching — \
             it is not a coding worker"
        );
    }

    #[test]
    fn ade_manager_excludes_desktop_and_browser_tools() {
        let excluded = &ade_manager().tools.excluded_tools;
        let tool = tool_names::CONTROL_DESKTOP_WITH_PEEKABOO;
        assert!(
            excluded.iter().any(|t| t == tool),
            "{tool} must be in ADE Manager's default excluded set \
             (ADE Manager manages the dev environment, it does not operate the desktop)"
        );
    }

    #[test]
    fn ade_manager_has_gui_control_tools() {
        let excluded = &ade_manager().tools.excluded_tools;
        for tool in [
            tool_names::CONTROL_ORGII,
            tool_names::SPOTLIGHT,
            tool_names::LIST_SESSION_WORKSPACE,
        ] {
            assert!(
                !excluded.iter().any(|t| t == tool),
                "{tool} must NOT be excluded — ADE Manager subsumes GUI Control"
            );
        }
    }

    #[test]
    fn ade_manager_cannot_spawn_subagents() {
        let excluded = &ade_manager().tools.excluded_tools;
        assert!(
            excluded.iter().any(|t| t == tool_names::AGENT),
            "The `agent` tool must be excluded — ADE Manager proposes sessions via \
             session.propose instead of spawning inline subagents. sub_agents: Some(vec![]) \
             alone is insufficient because builtin:explore/builtin:general bypass the allowlist."
        );
    }

    #[test]
    fn ade_manager_is_singleton() {
        let agent = ade_manager();
        assert_eq!(
            agent.max_instances,
            Some(1),
            "ADE Manager must be a singleton so the Spotlight palette always resumes the same session"
        );
        assert!(matches!(
            agent.session_model.as_ref().map(|m| &m.mode),
            Some(crate::definitions::schema::SessionMode::Singleton)
        ));
    }

    #[test]
    fn ade_manager_subagents_exclude_runtime_primitives() {
        let subs = ade_manager()
            .sub_agents
            .expect("ADE Manager declares sub_agents");
        for forbidden in super::super::SUBAGENT_FORBIDDEN_IDS {
            assert!(
                !subs.iter().any(|s| &s.agent_id == forbidden),
                "ADE Manager must not list runtime primitive {forbidden} as a sub-agent"
            );
        }
    }

    #[test]
    fn ade_manager_is_not_workspace_restricted() {
        let policy = ade_manager()
            .agent_policy
            .expect("ADE Manager declares policy");
        assert!(
            !policy.workspace_only,
            "ADE Manager must be able to write skills to ~/.orgii/skills/ \
             (global scope), so workspace_only must be false"
        );
    }

    #[test]
    fn ade_manager_id_remains_agent_architect_for_stability() {
        assert_eq!(ADE_MANAGER_ID, "builtin:agent-architect");
        assert_eq!(ade_manager().id, "builtin:agent-architect");
    }
}
