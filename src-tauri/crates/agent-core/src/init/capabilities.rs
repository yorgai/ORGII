//! Capability flags + per-session resource derivation.
//!
//! These are pure functions over `(ResolvedAgent, IntegrationsConfig)` —
//! nothing is initialized that requires async I/O or session handles. The
//! caller wires the returned values into the runtime spec.

use std::collections::HashSet;
use std::sync::Arc;

use crate::core::definitions::resolved::ResolvedAgent;
use crate::integrations::config::IntegrationsConfig;
use crate::state::AgentAppState;

/// Snapshot of which top-level capabilities the session has.
///
/// All three flags are read multiple times during init (tool registration,
/// node registry creation, channel bus wiring). Computing them once up front
/// keeps the call sites short and makes it obvious which capabilities the
/// agent is actually claiming — instead of repeating the
/// `capabilities.foo.as_ref().map(|x| x.enabled).unwrap_or(false)` chain.
pub(super) struct CapabilityFlags {
    pub has_desktop: bool,
    pub has_gateway: bool,
}

impl CapabilityFlags {
    pub fn from_resolved(resolved: &ResolvedAgent) -> Self {
        Self {
            has_desktop: resolved
                .capabilities
                .desktop
                .as_ref()
                .map(|d| d.enabled)
                .unwrap_or(false),
            has_gateway: resolved.capabilities.gateway.is_some(),
        }
    }
}

/// Build the optional `NodeRegistry` for a session.
///
/// Only created when desktop is enabled AND nodes integration is on. The
/// registry is shared via `Arc<Mutex<...>>` because multiple node-using tools
/// hold references and may mutate the registered set during a single turn.
pub(super) fn build_node_registry(
    flags: &CapabilityFlags,
    integrations: &IntegrationsConfig,
) -> Option<Arc<tokio::sync::Mutex<crate::nodes::NodeRegistry>>> {
    if flags.has_desktop && integrations.nodes.enabled {
        Some(Arc::new(tokio::sync::Mutex::new(
            crate::nodes::NodeRegistry::new(integrations.nodes.allowed_commands.clone()),
        )))
    } else {
        None
    }
}

/// Clone the channel bus when the agent has gateway capability.
///
/// Returning `None` when there is no gateway prevents tools from emitting
/// channel events for agents that have no inbound surface — keeps the bus
/// noise-free for pure desktop / inline sessions.
pub(super) fn channel_bus_for(
    flags: &CapabilityFlags,
    state: &AgentAppState,
) -> Option<Arc<tokio::sync::Mutex<crate::bus::AgentMessageBus>>> {
    if flags.has_gateway {
        Some(state.bus.clone())
    } else {
        None
    }
}

/// Collect the disabled MCP servers configured on the resolved agent into a
/// `HashSet` (the order-insensitive lookup form used by tool registration).
pub(super) fn disabled_mcp_servers(resolved: &ResolvedAgent) -> HashSet<String> {
    resolved
        .tools
        .disabled_mcp_servers
        .iter()
        .cloned()
        .collect()
}

/// Collect the disabled per-MCP-tool entries (`mcp__<server>__<tool>`)
/// configured on the resolved agent into the `HashSet` form used by
/// `register_mcp_tools` for namespaced lookups.
///
/// Distinct from `disabled_mcp_servers` (server-wide hide) and
/// `derive_disabled_tools` (builtin-tool exclusions) — the three sets
/// occupy disjoint name namespaces.
pub(super) fn disabled_mcp_tools(resolved: &ResolvedAgent) -> HashSet<String> {
    resolved.tools.disabled_mcp_tools.iter().cloned().collect()
}
