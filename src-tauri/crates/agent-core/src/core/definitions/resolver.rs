//! Template inheritance resolver.
//!
//! Resolves `inherits_from` chains and merges parent/child agent definitions.
//!
//! # Example
//!
//! ```ignore
//! // Define a user agent that inherits from the SDE template
//! let my_agent = AgentDefinition {
//!     id: "my-python-coder".to_string(),  // No prefix = user agent
//!     inherits_from: Some("builtin:sde".to_string()),
//!     soul_content: Some("You are a specialized Python developer.".to_string()),
//!     ..Default::default()
//! };
//!
//! // Resolve inheritance to get the full definition
//! let resolved = resolve_definition(&my_agent)?;
//! // resolved now has all SDE capabilities + custom soul_content
//! ```

use super::builtin::{get_builtin_agent, is_builtin_agent};
use super::capabilities::{BrowserCapability, CapabilitySet, CodingCapability, DesktopCapability};
use super::schema::{
    AgentDefinition, AgentPolicy, AgentSkillsConfig, AgentToolSelection, DelegationConfig,
    SessionModel,
};
use super::store::AgentDefinitionsStore;
use std::collections::HashSet;

/// Maximum inheritance depth to prevent infinite loops.
const MAX_INHERITANCE_DEPTH: usize = 10;

/// Resolve an agent definition by ID, including inheritance.
///
/// This function:
/// 1. Looks up the agent by ID (builtin or user-created)
/// 2. Recursively resolves the `inherits_from` chain
/// 3. Merges parent definitions with child overrides
///
/// # Arguments
///
/// * `agent_id` - The agent ID to resolve
/// * `store` - Optional store for custom agents (None = builtin only)
///
/// # Returns
///
/// The fully resolved `AgentDefinition` with all inherited properties merged.
pub fn resolve_definition_by_id(
    agent_id: &str,
    store: Option<&AgentDefinitionsStore>,
) -> Result<AgentDefinition, String> {
    let raw = get_raw_definition(agent_id, store)?;
    resolve_with_depth(&raw, store, 0, &mut HashSet::new())
}

/// Resolve an agent definition, applying inheritance.
///
/// Use this when you already have an `AgentDefinition` instance
/// and want to resolve its `inherits_from` chain.
pub fn resolve_definition(
    agent: &AgentDefinition,
    store: Option<&AgentDefinitionsStore>,
) -> Result<AgentDefinition, String> {
    resolve_with_depth(agent, store, 0, &mut HashSet::new())
}

/// Get a raw (unresolved) agent definition by ID.
fn get_raw_definition(
    agent_id: &str,
    store: Option<&AgentDefinitionsStore>,
) -> Result<AgentDefinition, String> {
    if is_builtin_agent(agent_id) {
        if let Some(store) = store {
            if let Some(def) = store.get(agent_id) {
                return Ok(def);
            }
        }
        return get_builtin_agent(agent_id)
            .ok_or_else(|| format!("Builtin agent '{}' not found", agent_id));
    }

    if let Some(store) = store {
        let agents = store
            .agents
            .lock()
            .map_err(|err| format!("Lock error: {}", err))?;
        if let Some(agent) = agents.iter().find(|a| a.id == agent_id) {
            return Ok(agent.clone());
        }
    }

    Err(format!("Agent '{}' not found", agent_id))
}

/// Recursive resolution with depth tracking.
fn resolve_with_depth(
    agent: &AgentDefinition,
    store: Option<&AgentDefinitionsStore>,
    depth: usize,
    visited: &mut HashSet<String>,
) -> Result<AgentDefinition, String> {
    // Check depth limit
    if depth >= MAX_INHERITANCE_DEPTH {
        return Err(format!(
            "Inheritance depth exceeded {} for agent '{}'",
            MAX_INHERITANCE_DEPTH, agent.id
        ));
    }

    // Check for cycles
    if visited.contains(&agent.id) {
        return Err(format!(
            "Circular inheritance detected: agent '{}' appears twice in chain",
            agent.id
        ));
    }
    visited.insert(agent.id.clone());

    // If no parent, return as-is
    let parent_id = match &agent.inherits_from {
        Some(id) => id,
        None => return Ok(agent.clone()),
    };

    // Check if parent would create a cycle before resolving
    if visited.contains(parent_id.as_str()) {
        return Err(format!(
            "Circular inheritance detected: agent '{}' inherits from already-visited '{}'",
            agent.id, parent_id
        ));
    }

    // Resolve parent
    let parent_raw = get_raw_definition(parent_id, store)?;
    let parent = resolve_with_depth(&parent_raw, store, depth + 1, visited)?;

    // Merge parent with child (child overrides parent)
    Ok(merge_definitions(&parent, agent))
}

/// Merge a parent definition with a child definition.
///
/// Child properties override parent properties when set.
/// For nested structs, child fields override parent fields individually.
fn merge_definitions(parent: &AgentDefinition, child: &AgentDefinition) -> AgentDefinition {
    AgentDefinition {
        // Always use child's identity
        id: child.id.clone(),
        name: child.name.clone(),
        description: child
            .description
            .clone()
            .or_else(|| parent.description.clone()),
        built_in: child.built_in,
        tier: child.tier,

        // Child's inherits_from is used (already resolved)
        inherits_from: child.inherits_from.clone(),

        // Merge capabilities
        capabilities: merge_capabilities(parent.capabilities.as_ref(), child.capabilities.as_ref()),

        // Merge session model
        session_model: merge_session_model(
            parent.session_model.as_ref(),
            child.session_model.as_ref(),
        ),

        // Merge tool selection (blacklists union, allowlist child-wins).
        tools: merge_tools(&parent.tools, &child.tools),

        // Simple overrides (child wins if set)
        context_window: child.context_window.or(parent.context_window),
        max_tokens: child.max_tokens.or(parent.max_tokens),
        temperature: child.temperature.or(parent.temperature),
        soul_content: child
            .soul_content
            .clone()
            .or_else(|| parent.soul_content.clone()),
        sovereign_prompt: child.sovereign_prompt || parent.sovereign_prompt,
        sub_agents: child
            .sub_agents
            .clone()
            .or_else(|| parent.sub_agents.clone()),
        load_workspace_resources: child
            .load_workspace_resources
            .or(parent.load_workspace_resources),
        load_workspace_rules: child.load_workspace_rules.or(parent.load_workspace_rules),
        load_workspace_settings: child
            .load_workspace_settings
            .or(parent.load_workspace_settings),
        skills_config: merge_skills_config(
            parent.skills_config.as_ref(),
            child.skills_config.as_ref(),
        ),
        selected_account_id: child
            .selected_account_id
            .clone()
            .or_else(|| parent.selected_account_id.clone()),
        selected_model_id: child
            .selected_model_id
            .clone()
            .or_else(|| parent.selected_model_id.clone()),
        delegation_config: merge_delegation_config(
            parent.delegation_config.as_ref(),
            child.delegation_config.as_ref(),
        ),

        // Visual metadata (child wins if set)
        icon_id: child.icon_id.clone().or_else(|| parent.icon_id.clone()),

        // Runtime fields (child wins if set)
        animate: child.animate.or(parent.animate),
        execution_mode: child.execution_mode.or(parent.execution_mode),
        exec_timeout: child.exec_timeout.or(parent.exec_timeout),
        max_tool_use_concurrency: child
            .max_tool_use_concurrency
            .or(parent.max_tool_use_concurrency),
        learnings: child.learnings.clone().or_else(|| parent.learnings.clone()),

        // The unified policy (child wins if set)
        agent_policy: merge_agent_policy(parent.agent_policy.as_ref(), child.agent_policy.as_ref()),
        reliability: child
            .reliability
            .clone()
            .or_else(|| parent.reliability.clone()),
        max_instances: child.max_instances.or(parent.max_instances),
    }
}

// ============================================
// Merge Helpers
// ============================================

fn merge_capabilities(
    parent: Option<&CapabilitySet>,
    child: Option<&CapabilitySet>,
) -> Option<CapabilitySet> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (None, Some(c)) => Some(c.clone()),
        (Some(p), Some(c)) => Some(CapabilitySet {
            gateway: c.gateway.clone().or_else(|| p.gateway.clone()),
            coding: merge_coding_cap(p.coding.as_ref(), c.coding.as_ref()),
            desktop: merge_desktop_cap(p.desktop.as_ref(), c.desktop.as_ref()),
            browser: merge_browser_cap(p.browser.as_ref(), c.browser.as_ref()),
            data: c.data.clone().or_else(|| p.data.clone()),
            management: c.management.clone().or_else(|| p.management.clone()),
        }),
    }
}

/// All-or-nothing merge — child wholly replaces parent when present.
fn merge_coding_cap(
    parent: Option<&CodingCapability>,
    child: Option<&CodingCapability>,
) -> Option<CodingCapability> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// All-or-nothing merge — child wholly replaces parent when present.
fn merge_desktop_cap(
    parent: Option<&DesktopCapability>,
    child: Option<&DesktopCapability>,
) -> Option<DesktopCapability> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// All-or-nothing merge — child wholly replaces parent when present.
fn merge_browser_cap(
    parent: Option<&BrowserCapability>,
    child: Option<&BrowserCapability>,
) -> Option<BrowserCapability> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// Merge parent/child `SessionModel`.
///
/// **All-or-nothing semantics.** If the child provides any `SessionModel`,
/// the child's value is used as-is; the parent is only consulted when the
/// child omits the entire struct (`session_model: None`).
///
/// Why not field-level merge: `mode`, `processing_lock`, `max_iterations`
/// are non-`Option` scalars whose default values (`SessionMode::default()`,
/// `true`, `500`) are indistinguishable from "user explicitly set the
/// default." Mixing per-field `or_else` (which used to apply only to
/// `compaction`) with raw `c.field` for the scalars caused a silent bug:
/// a child that wanted to override only `mode` would also clobber the
/// parent's custom `max_iterations` with the deserializer default 500.
///
/// If you need per-field inheritance, omit the inner struct on the child
/// and override the parent at the higher template / config layer instead.
fn merge_session_model(
    parent: Option<&SessionModel>,
    child: Option<&SessionModel>,
) -> Option<SessionModel> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// Merge parent/child `AgentPolicy`.
///
/// **All-or-nothing semantics.** Same rationale as `merge_session_model`:
/// `autonomy` and `workspace_only` are non-`Option` scalars whose defaults
/// are indistinguishable from
/// explicit user choice, and an "empty-vec means inherit" rule on
/// `blocked_commands` would make it impossible for a child to clear a
/// parent's blocklist. If a child supplies any `AgentPolicy`, that
/// policy wins as-is.
fn merge_agent_policy(
    parent: Option<&AgentPolicy>,
    child: Option<&AgentPolicy>,
) -> Option<AgentPolicy> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// Merge parent/child `AgentToolSelection`.
///
/// - Exclusions (`excluded_tools`, `disabled_mcp_servers`,
///   `disabled_mcp_tools`) are unioned: parent's exclusions are preserved,
///   child's are added.
/// - `system_restrict_to_tools` is child-wins: if the child declares a
///   role-pinned cap it replaces the parent's (specialists override
///   parent's "wide open" default); otherwise the parent's cap is
///   inherited.
/// - `user_allowed_tools` is unioned across the chain so a child custom
///   agent's user additions ride on top of any parent-declared user
///   additions (rare in practice — only the leaf-most non-builtin agent
///   normally has these — but kept symmetric with the exclusion fields).
fn merge_tools(parent: &AgentToolSelection, child: &AgentToolSelection) -> AgentToolSelection {
    fn union(a: &[String], b: &[String]) -> Vec<String> {
        let mut out = a.to_vec();
        for x in b {
            if !out.contains(x) {
                out.push(x.clone());
            }
        }
        out
    }

    AgentToolSelection {
        system_restrict_to_tools: child
            .system_restrict_to_tools
            .clone()
            .or_else(|| parent.system_restrict_to_tools.clone()),
        user_allowed_tools: union(&parent.user_allowed_tools, &child.user_allowed_tools),
        excluded_tools: union(&parent.excluded_tools, &child.excluded_tools),
        disabled_mcp_servers: union(&parent.disabled_mcp_servers, &child.disabled_mcp_servers),
        disabled_mcp_tools: union(&parent.disabled_mcp_tools, &child.disabled_mcp_tools),
    }
}

/// Merge parent/child `AgentSkillsConfig`.
///
/// **All-or-nothing semantics.** The previous mix of `enabled.or(p.enabled)`,
/// `include` empty-means-inherit, and `exclude` union behaved differently
/// for each field; in particular, "child overrides only `enabled`" still
/// silently inherited the parent's `include` list, which is not what users
/// of skill scoping actually expect.
///
/// If a child supplies any `AgentSkillsConfig`, that config wins as-is.
fn merge_skills_config(
    parent: Option<&AgentSkillsConfig>,
    child: Option<&AgentSkillsConfig>,
) -> Option<AgentSkillsConfig> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

/// Merge parent/child `DelegationConfig`.
///
/// **All-or-nothing semantics**, matching the rest of the merge_* family.
/// `delegatable` is a non-`Option` bool whose default is indistinguishable
/// from explicit user choice, and `context_builders` empty-means-inherit
/// prevented children from clearing a parent's builder list.
fn merge_delegation_config(
    parent: Option<&DelegationConfig>,
    child: Option<&DelegationConfig>,
) -> Option<DelegationConfig> {
    match (parent, child) {
        (None, None) => None,
        (Some(p), None) => Some(p.clone()),
        (_, Some(c)) => Some(c.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definitions::builtin::{OS_AGENT_ID, SDE_AGENT_ID};

    #[test]
    fn test_resolve_builtin_agent() {
        let resolved = resolve_definition_by_id(OS_AGENT_ID, None).unwrap();
        assert_eq!(resolved.id, OS_AGENT_ID);
        assert!(resolved.capabilities.is_some());
        assert!(resolved.capabilities.as_ref().unwrap().desktop.is_some());
    }

    #[test]
    fn test_resolve_with_inheritance() {
        // Create a user agent that inherits from SDE
        let child = AgentDefinition {
            id: "my-agent".to_string(), // No prefix = user agent
            name: "My Agent".to_string(),
            inherits_from: Some(SDE_AGENT_ID.to_string()),
            soul_content: Some("Custom prompt".to_string()),
            ..Default::default()
        };

        let resolved = resolve_definition(&child, None).unwrap();

        // Should have SDE capabilities
        assert!(resolved.capabilities.is_some());
        assert!(resolved.capabilities.as_ref().unwrap().coding.is_some());

        // Should have custom soul_content
        assert_eq!(resolved.soul_content, Some("Custom prompt".to_string()));
    }

    #[test]
    fn test_circular_inheritance_detected() {
        let agent = AgentDefinition {
            id: "loop-agent".to_string(),
            name: "Loop".to_string(),
            inherits_from: Some("loop-agent".to_string()), // Self-reference
            ..Default::default()
        };

        let result = resolve_definition(&agent, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Circular inheritance"));
    }

    #[test]
    fn test_merge_tools_unions_exclusions() {
        let parent = AgentToolSelection {
            excluded_tools: vec!["tool_a".to_string()],
            disabled_mcp_servers: vec!["srv1".to_string()],
            ..Default::default()
        };
        let child = AgentToolSelection {
            excluded_tools: vec!["tool_b".to_string()],
            disabled_mcp_tools: vec!["mcp__srv2__foo".to_string()],
            ..Default::default()
        };

        let merged = merge_tools(&parent, &child);
        assert!(merged.excluded_tools.contains(&"tool_a".to_string()));
        assert!(merged.excluded_tools.contains(&"tool_b".to_string()));
        assert!(merged.disabled_mcp_servers.contains(&"srv1".to_string()));
        assert!(merged
            .disabled_mcp_tools
            .contains(&"mcp__srv2__foo".to_string()));
        assert!(merged.system_restrict_to_tools.is_none());
    }

    #[test]
    fn test_merge_tools_child_restriction_wins() {
        let parent = AgentToolSelection {
            system_restrict_to_tools: Some(vec!["read_file".to_string()]),
            ..Default::default()
        };
        let child = AgentToolSelection {
            system_restrict_to_tools: Some(vec!["manage_agent_def".to_string()]),
            ..Default::default()
        };
        let merged = merge_tools(&parent, &child);
        assert_eq!(
            merged.system_restrict_to_tools,
            Some(vec!["manage_agent_def".to_string()])
        );
    }

    #[test]
    fn test_merge_tools_child_inherits_parent_restriction() {
        let parent = AgentToolSelection {
            system_restrict_to_tools: Some(vec!["read_file".to_string()]),
            ..Default::default()
        };
        let child = AgentToolSelection::default();
        let merged = merge_tools(&parent, &child);
        assert_eq!(
            merged.system_restrict_to_tools,
            Some(vec!["read_file".to_string()])
        );
    }

    #[test]
    fn test_merge_tools_unions_user_allowed() {
        let parent = AgentToolSelection {
            user_allowed_tools: vec!["read_file".to_string()],
            ..Default::default()
        };
        let child = AgentToolSelection {
            user_allowed_tools: vec!["web_fetch".to_string()],
            ..Default::default()
        };
        let merged = merge_tools(&parent, &child);
        assert!(merged.user_allowed_tools.contains(&"read_file".to_string()));
        assert!(merged.user_allowed_tools.contains(&"web_fetch".to_string()));
    }

    /// Regression for the resolver-symmetry audit (May 2026):
    ///
    /// Pre-fix, `merge_session_model` blended child scalar fields with parent
    /// `compaction` via `or_else`. The previous behavior is *correct only* if
    /// the user-supplied child carries the same scalars they want to keep.
    /// In practice, an agent definition that wanted to override only `mode`
    /// would re-deserialize with `processing_lock = true` (default) and
    /// `max_iterations = 500` (default) — silently clobbering a parent that
    /// configured `max_iterations = 1000`.
    ///
    /// New invariant: when the child supplies any `SessionModel`, the child
    /// wholly replaces the parent. The user opts in by writing the inner
    /// struct or omits it entirely to inherit.
    #[test]
    fn merge_session_model_is_all_or_nothing() {
        use crate::definitions::SessionModel;

        let parent = SessionModel {
            mode: Default::default(),
            compaction: None,
            processing_lock: false,
            max_iterations: 1000,
        };
        let child = SessionModel {
            mode: Default::default(),
            compaction: None,
            processing_lock: true, // serde default
            max_iterations: 500,   // serde default
        };

        let merged = merge_session_model(Some(&parent), Some(&child)).expect("must merge");
        // Child wholly replaces parent — the child's defaults win.
        assert_eq!(merged.max_iterations, 500);
        assert!(merged.processing_lock);

        // No-child case still inherits the entire parent struct.
        let inherited = merge_session_model(Some(&parent), None).expect("must inherit");
        assert_eq!(inherited.max_iterations, 1000);
        assert!(!inherited.processing_lock);
    }

    /// Regression: `merge_agent_policy` uses all-or-nothing semantics
    /// so a child can clear a parent's `blocked_commands` allowlist by
    /// supplying an explicit empty list. An "empty-Vec means inherit"
    /// rule would silently re-inherit the parent value.
    #[test]
    fn merge_agent_policy_is_all_or_nothing() {
        use crate::definitions::AgentPolicy;

        let parent = AgentPolicy {
            blocked_commands: vec!["sudo".to_string()],
            ..Default::default()
        };
        let child = AgentPolicy {
            // Intentionally empty — user wants *no* command restriction at all.
            blocked_commands: vec![],
            ..Default::default()
        };

        let merged = merge_agent_policy(Some(&parent), Some(&child)).expect("must merge");
        // Pre-fix this returned the parent's lists (empty-means-inherit).
        // Post-fix the child's explicit empty wins.
        assert!(merged.blocked_commands.is_empty());
    }
}
