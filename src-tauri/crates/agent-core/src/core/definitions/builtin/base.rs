//! Base agent template — the root of all builtin agents.
//!
//! This is a minimal agent with no special capabilities.
//! Other agents can inherit from it to get default configurations.

use crate::definitions::schema::{
    AgentDefinition, AgentTier, DelegationConfig, SessionMode, SessionModel,
};

/// Base agent ID.
pub const BASE_AGENT_ID: &str = "builtin:base";

/// Base agent template — minimal agent with default settings.
///
/// This template provides:
/// - Default session model (per-session, with processing lock)
/// - Full tool inheritance
/// - No special capabilities
pub fn base_agent() -> AgentDefinition {
    AgentDefinition {
        id: BASE_AGENT_ID.to_string(),
        name: "Base Agent".to_string(),
        description: Some("Minimal base template for all agents.".to_string()),
        built_in: true,
        tier: AgentTier::Secondary,
        inherits_from: None, // Root template

        // Default session model
        session_model: Some(SessionModel {
            mode: SessionMode::PerSession,
            compaction: None,
            processing_lock: true,
            max_iterations: 500,
        }),

        // No special capabilities
        capabilities: None,

        // Inherit all tools (system_restrict_to_tools=None, no exclusions)
        tools: Default::default(),

        // Default delegation config
        delegation_config: Some(DelegationConfig {
            delegatable: true,
            context_builders: Vec::new(),
        }),

        // No model/token overrides
        context_window: None,
        max_tokens: None,
        temperature: None,
        soul_content: None,
        sovereign_prompt: false,
        sub_agents: None,
        load_workspace_resources: None,
        load_workspace_rules: None,
        load_workspace_settings: None,
        skills_config: None,
        selected_account_id: None,
        selected_model_id: None,

        icon_id: None,

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
