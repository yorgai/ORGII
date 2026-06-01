//! Shared agent infrastructure for LLM-based agents.
//!
//! # Where to start
//!
//! New to this codebase? Read [`ARCHITECTURE.md`](../../agent_core/ARCHITECTURE.md)
//! first — it's a one-page map that tells you where every subsystem lives,
//! how a single user message flows through the agent, and which naming
//! conventions you should follow when adding code.
//!
//! # Architecture Overview
//!
//! The agent core is organized into a 4-layer hierarchy.
//! Dependencies flow downward only: agents/state → intelligence/integrations → core → foundation.
//!
//! ## Layer 0: Foundation (`foundation/`)
//! Infrastructure primitives — message bus, persistence, security,
//! node control, tool infrastructure, flow awareness, and shared utilities.
//!
//! ## Layer 1: Core (`core/`)
//! Core agent logic — configuration, LLM providers, model context, tool registry,
//! turn execution, agent definitions, user interaction, session management, prompt builders.
//!
//! ## Layer 2a: Intelligence (`intelligence/`)
//! Advanced features — semantic memory, skills, MCP protocol, lifecycle
//! hooks, and autonomy policies.
//!
//! ## Layer 2b: Integrations (`integrations/`)
//! External integrations — chat channels (Telegram, Discord, Feishu,
//! WeCom, Weixin), message gateway, and rule-based automation.
//!
//! ## Layer 3: State & Commands
//! Tauri managed state and command handlers.

// Layer modules
pub mod core;
pub mod foundation;
pub mod integrations;
pub mod intelligence;
pub mod state;
// Standalone modules
pub mod init;
pub mod lifecycle;
pub mod orchestrator_notify;

// `#[doc(hidden)]` curated debug surface for app/api/agent/test/* HTTP
// routes. See debug.rs — every item exposed here would otherwise force a
// `pub(crate)` → `pub` promotion in its home module.
#[doc(hidden)]
pub mod debug;

#[cfg(test)]
pub mod test_support;

// Canonical re-exports: flatten sub-layer modules to `agent_core::` for ergonomic imports
pub use self::core::{
    config, coordination, definitions, interaction, model_context, providers, session, tools,
    turn_executor,
};
pub use foundation::{bus, flow_awareness, nodes, persistence, security, tool_infra, utils};
pub use integrations::{automation, channels, gateway};
pub use intelligence::{mcp, memory, policies, skills};
