//! AI Researcher agent template — autonomous AI/ML research specialist.

use crate::definitions::capabilities::{BrowserCapability, CapabilitySet, CodingCapability};
use crate::definitions::schema::{
    AgentDefinition, AgentLearningsConfig, AgentPolicy, AgentSkillsConfig, AgentTier,
    AgentToolSelection, CompactionConfig, DelegationConfig, SessionMode, SessionModel,
};
use crate::foundation::security::policy::AutonomyLevel;
use crate::tools::defaults::default_excluded_tools_for_capabilities;
use crate::tools::impls::orchestration::context_builders::ids as ctx_ids;

pub const AI_RESEARCH_AGENT_ID: &str = "builtin:ai-research";
const AI_RESEARCH_SKILL_SOURCE: &str = "builtin://ai-research-skills";

pub fn ai_research_agent() -> AgentDefinition {
    let capabilities = CapabilitySet {
        coding: Some(CodingCapability { mode_switch: true }),
        desktop: None,
        browser: Some(BrowserCapability {
            external: true,
            internal: false,
        }),
        gateway: None,
        data: None,
        management: None,
    };
    let excluded_tools = default_excluded_tools_for_capabilities(&capabilities);

    AgentDefinition {
        id: AI_RESEARCH_AGENT_ID.to_string(),
        name: "AI Researcher".to_string(),
        description: Some(
            "Autonomous AI/ML researcher with the Orchestra Research skill pack.".to_string(),
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
        soul_content: Some(include_str!("prompts/ai_research.md").to_string()),
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
        skills_config: Some(AgentSkillsConfig {
            enabled: Some(true),
            include: Vec::new(),
            exclude: Vec::new(),
            source_dirs: vec![AI_RESEARCH_SKILL_SOURCE.to_string()],
        }),
        selected_account_id: None,
        selected_model_id: None,
        icon_id: Some("microscope".to_string()),
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

    #[test]
    fn ai_research_agent_loads_ai_research_skill_source() {
        let agent = ai_research_agent();
        let skills = agent.skills_config.expect("AI Researcher declares skills");
        assert!(
            skills
                .source_dirs
                .iter()
                .any(|source| source == AI_RESEARCH_SKILL_SOURCE),
            "AI Researcher must load the prebuilt research skill source"
        );
    }
}
