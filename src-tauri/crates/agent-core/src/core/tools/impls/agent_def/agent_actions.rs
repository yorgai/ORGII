//! CRUD handlers for `AgentDefinition` entries.

use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use crate::definitions::{
    AgentDefinition, AgentDefinitionsStore, AgentPolicy, AgentSkillsConfig, AgentToolSelection,
    CapabilitySet, DelegationConfig, SessionModel,
};
use crate::tools::traits::{optional_string, required_string, ToolError};

use super::formatting::{format_agent_detail, format_agent_summary};
use super::parsing::{names_similar, parse_sub_agents};

/// Parse an optional typed config field from a JSON parameters object.
///
/// Returns `Ok(None)` when the field is absent, `Ok(Some(T))` when it is
/// present and parses cleanly, and `Err(InvalidParams)` when the field is
/// present but malformed — we never silently drop user input.
fn parse_optional_config<T: DeserializeOwned>(
    params: &Value,
    field: &str,
) -> Result<Option<T>, ToolError> {
    match params.get(field) {
        None => Ok(None),
        Some(value) if value.is_null() => Ok(None),
        Some(value) => serde_json::from_value::<T>(value.clone())
            .map(Some)
            .map_err(|err| ToolError::InvalidParams(format!("Invalid {}: {}", field, err))),
    }
}

pub(super) fn list_agents(store: &AgentDefinitionsStore) -> Result<String, ToolError> {
    let agents = store
        .agents
        .lock()
        .map_err(|err| ToolError::ExecutionFailed(format!("Lock error: {}", err)))?;

    if agents.is_empty() {
        return Ok("No custom agents defined. Use 'create' to add one.".to_string());
    }

    let mut out = format!("Found {} agent(s):\n\n", agents.len());
    for agent in agents.iter() {
        out.push_str(&format_agent_summary(agent));
        out.push('\n');
    }
    Ok(out)
}

pub(super) fn get_agent(
    store: &AgentDefinitionsStore,
    params: &Value,
) -> Result<String, ToolError> {
    let agent_id = required_string(params, "agent_id")?;
    let agents = store
        .agents
        .lock()
        .map_err(|err| ToolError::ExecutionFailed(format!("Lock error: {}", err)))?;

    let agent = agents
        .iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| ToolError::ExecutionFailed(format!("Agent '{}' not found", agent_id)))?;

    Ok(format_agent_detail(agent))
}

pub(super) fn create_agent(
    store: &AgentDefinitionsStore,
    params: &Value,
) -> Result<String, ToolError> {
    let name = required_string(params, "name")?;
    let description = optional_string(params, "description");
    let soul_content = optional_string(params, "soul_content");
    let temperature = params.get("temperature").and_then(|v| v.as_f64());
    let max_tokens = params.get("max_tokens").and_then(|v| v.as_u64());
    let context_window = params.get("context_window").and_then(|v| v.as_u64());
    let sub_agents = parse_sub_agents(params);

    let mut agents = store
        .agents
        .lock()
        .map_err(|err| ToolError::ExecutionFailed(format!("Lock error: {}", err)))?;

    let similar: Vec<&AgentDefinition> = agents
        .iter()
        .filter(|a| names_similar(&a.name, &name))
        .collect();

    if !similar.is_empty() {
        let mut warning = format!(
            "⚠ Found {} agent(s) with similar name(s):\n\n",
            similar.len()
        );
        for agent in &similar {
            warning.push_str(&format_agent_summary(agent));
            warning.push('\n');
        }
        warning.push_str(
            "\nConsider using 'update' on the existing agent instead of creating a duplicate.\n\
             If you still want to create a new agent, call 'create' again with a more distinct name.",
        );
        return Ok(warning);
    }

    let new_id = Uuid::new_v4().to_string();
    let tools = parse_optional_config::<AgentToolSelection>(params, "tools")?.unwrap_or_default();
    let skills_config = parse_optional_config::<AgentSkillsConfig>(params, "skills_config")?;
    let delegation_config = parse_optional_config::<DelegationConfig>(params, "delegation_config")?;
    let capabilities = parse_optional_config::<CapabilitySet>(params, "capabilities")?;
    let session_model = parse_optional_config::<SessionModel>(params, "session_model")?;
    let agent_policy = parse_optional_config::<AgentPolicy>(params, "agent_policy")?;

    let inherits_from = params
        .get("inherits_from")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let tier = match params.get("tier") {
        None => Default::default(),
        Some(value) if value.is_null() => Default::default(),
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|err| ToolError::InvalidParams(format!("Invalid tier: {}", err)))?,
    };

    let agent = AgentDefinition {
        id: new_id.clone(),
        name: name.clone(),
        description,
        built_in: false,
        tier,
        inherits_from,
        capabilities,
        session_model,
        context_window,
        max_tokens,
        temperature,
        soul_content,
        sovereign_prompt: false,
        sub_agents,
        tools,
        load_workspace_resources: params
            .get("load_workspace_resources")
            .and_then(|v| v.as_bool()),
        load_workspace_rules: params.get("load_workspace_rules").and_then(|v| v.as_bool()),
        load_workspace_settings: params
            .get("load_workspace_settings")
            .and_then(|v| v.as_bool()),
        skills_config,
        selected_account_id: params
            .get("selected_account_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        selected_model_id: params
            .get("selected_model_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        delegation_config,
        icon_id: params
            .get("icon_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),

        animate: None,
        execution_mode: None,
        exec_timeout: None,
        max_tool_use_concurrency: None,
        learnings: None,

        agent_policy,
        reliability: None,
        max_instances: None,
    };

    agents.push(agent);
    store.persist(&agents);

    Ok(format!("Created agent '{}' with id `{}`.", name, new_id))
}

pub(super) fn update_agent(
    store: &AgentDefinitionsStore,
    params: &Value,
) -> Result<String, ToolError> {
    let agent_id = required_string(params, "agent_id")?;

    let mut agents = store
        .agents
        .lock()
        .map_err(|err| ToolError::ExecutionFailed(format!("Lock error: {}", err)))?;

    let agent = agents
        .iter_mut()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| ToolError::ExecutionFailed(format!("Agent '{}' not found", agent_id)))?;

    if let Some(name) = optional_string(params, "name") {
        agent.name = name;
    }
    if let Some(desc) = optional_string(params, "description") {
        agent.description = Some(desc);
    }
    if let Some(soul) = optional_string(params, "soul_content") {
        agent.soul_content = Some(soul);
    }
    if let Some(temp) = params.get("temperature").and_then(|v| v.as_f64()) {
        agent.temperature = Some(temp);
    }
    if let Some(max) = params.get("max_tokens").and_then(|v| v.as_u64()) {
        agent.max_tokens = Some(max);
    }
    if let Some(ctx) = params.get("context_window").and_then(|v| v.as_u64()) {
        agent.context_window = Some(ctx);
    }
    if params.get("sub_agents").is_some() {
        agent.sub_agents = parse_sub_agents(params);
    }
    if let Some(parsed) = parse_optional_config::<AgentToolSelection>(params, "tools")? {
        agent.tools = parsed;
    }
    if let Some(parsed) = parse_optional_config::<AgentSkillsConfig>(params, "skills_config")? {
        agent.skills_config = Some(parsed);
    }

    let name = agent.name.clone();
    store.persist(&agents);

    Ok(format!("Updated agent '{}'.", name))
}

pub(super) fn remove_agent(
    store: &AgentDefinitionsStore,
    params: &Value,
) -> Result<String, ToolError> {
    let agent_id = required_string(params, "agent_id")?;

    let mut agents = store
        .agents
        .lock()
        .map_err(|err| ToolError::ExecutionFailed(format!("Lock error: {}", err)))?;

    let len_before = agents.len();
    let removed_name = agents
        .iter()
        .find(|a| a.id == agent_id)
        .map(|a| a.name.clone());

    agents.retain(|a| a.id != agent_id);
    let removed = agents.len() < len_before;

    if removed {
        store.persist(&agents);
        Ok(format!(
            "Removed agent '{}'.",
            removed_name.unwrap_or(agent_id)
        ))
    } else {
        Err(ToolError::ExecutionFailed(format!(
            "Agent '{}' not found",
            agent_id
        )))
    }
}
