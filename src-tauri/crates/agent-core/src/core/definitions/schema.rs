//! Agent definition schema — the unified struct for all agents.
//!
//! All agents are instances of `AgentDefinition`. There are two categories:
//!
//! - **Builtin agents** (`builtin:*`): Defined in Rust code, cannot be modified by users.
//! - **User agents** (no prefix): Created by users, stored in `~/.orgii/agent-definitions.json`.
//!
//! # Template Inheritance
//!
//! Agents can inherit from other agents via the `inherits_from` field.
//! The inheritance chain is resolved at runtime, with child properties
//! overriding parent properties.
//!
//! ```text
//! builtin:base (root template)
//!     ├── builtin:os (desktop automation)
//!     ├── builtin:sde (coding assistant)
//!     ├── builtin:wingman (desktop co-pilot)
//!     └── user-defined agents (inherit from any builtin or other user agent)
//! ```
//!
//! # ID Convention
//!
//! - `builtin:*` — System-provided, immutable
//! - `<name>` (no prefix) — User-created, fully editable

use serde::{Deserialize, Serialize};

use super::capabilities::CapabilitySet;
use crate::core::config::ReliabilityConfig;
use crate::foundation::security::{AutonomyLevel, CommandRiskRules};
use crate::integrations::config::ExecutionMode;

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_false(value: &bool) -> bool {
    !*value
}
// ============================================
// Session Model Types
// ============================================

/// How agent sessions are managed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionMode {
    /// Single global session (e.g. channel agents).
    Singleton,
    /// Each conversation gets its own session (e.g. coding agents).
    #[default]
    PerSession,
}

/// Session model — controls how agent sessions are managed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModel {
    /// Session mode.
    #[serde(default)]
    pub mode: SessionMode,

    /// Context compaction configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<CompactionConfig>,

    /// When `true` (default), the launch path acquires the per-session
    /// processing mutex so concurrent turns are serialised. When `false`,
    /// the launch skips the lock entirely so the agent can interleave
    /// requests (e.g. OS Agent's "always-on" daemon flow). The
    /// `DialogScheduler` FIFO queue still serialises scheduler-based
    /// callers independently of this flag.
    #[serde(default = "app_utils::default_true")]
    pub processing_lock: bool,

    /// Maximum iterations per turn.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}

fn default_max_iterations() -> u32 {
    500
}

pub const DEFAULT_MAX_TOOL_USE_CONCURRENCY: u32 = 10;

pub fn default_max_tool_use_concurrency() -> u32 {
    DEFAULT_MAX_TOOL_USE_CONCURRENCY
}

/// Fallback for `AgentDefinition.max_instances` when unset.
pub const DEFAULT_MAX_SUBAGENT_INSTANCES: u32 = 30;

impl Default for SessionModel {
    fn default() -> Self {
        Self {
            mode: SessionMode::default(),
            compaction: None,
            processing_lock: true,
            max_iterations: default_max_iterations(),
        }
    }
}

// ============================================
// Agent Tier
// ============================================

/// Tier classification — primary agents are core to the org, secondary are support.
///
/// Built-in OS and SDE agents default to `Primary`.
/// Custom agents default to `Secondary` but can be set to either.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTier {
    /// Core agent — shown in the Primary group in the Members panel.
    Primary,
    /// Supporting agent — shown in the Secondary group.
    #[default]
    Secondary,
}

// ============================================
// Unified Agent Policy
// ============================================

/// Unified agent policy — the single per-agent security surface stored
/// on `AgentDefinition`.
///
/// The runtime execution policy (`foundation::security::SecurityPolicy`)
/// is built from this at session launch via `to_runtime_security`;
/// defaults for the richer runtime fields (`confirmation_commands`,
/// `forbidden_paths`, `max_actions_per_hour`, `block_high_risk_commands`)
/// are applied at conversion time — they are policy invariants rather
/// than per-agent configuration.
///
/// Tool allow/deny is NOT carried here — it lives entirely on
/// `AgentDefinition.tools.excludedTools` (per-agent name-based deny
/// applied at tool-registration time) and on the runtime
/// access-mode tool policy at session init.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicy {
    /// Access mode (read-only / read + write).
    #[serde(default)]
    pub autonomy: AutonomyLevel,

    /// Restrict file/shell operations to the session workspace directory.
    #[serde(default)]
    pub workspace_only: bool,

    /// Blocked base-command names (e.g. `["rm", "sudo"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_commands: Vec<String>,

    /// User-configurable medium/high risk command classification rules.
    #[serde(default)]
    pub risk_rules: CommandRiskRules,
}

impl AgentPolicy {
    /// Build a runtime [`SecurityPolicy`] for this policy at session launch.
    ///
    /// The agent-level fields (`autonomy`, `workspace_only`,
    /// `blocked_commands`) ride on `AgentPolicy`, and the
    /// session-invariant defaults
    /// (`confirmation_commands`, `forbidden_paths`, `max_actions_per_hour`,
    /// `block_high_risk_commands`) are supplied here.
    pub fn to_runtime_security(
        &self,
        workspace_dir: std::path::PathBuf,
    ) -> crate::foundation::security::SecurityPolicy {
        use crate::foundation::security::SecurityPolicy;

        SecurityPolicy::new(
            self.autonomy,
            workspace_dir,
            self.workspace_only,
            self.blocked_commands.clone(),
            default_confirmation_commands(),
            default_forbidden_paths(),
            default_max_actions_per_hour(),
            true, // block_high_risk_commands — invariant across agents
            self.risk_rules.clone(),
        )
    }
}

fn default_confirmation_commands() -> Vec<String> {
    [
        "git push",
        "gh pr",
        "gh issue",
        "gh release",
        "npm publish",
        "yarn publish",
        "pnpm publish",
        "cargo publish",
        "twine upload",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_forbidden_paths() -> Vec<String> {
    [
        "/etc",
        "/root",
        "/proc",
        "/sys",
        "/dev",
        "~/.ssh",
        "~/.gnupg",
        "~/.aws",
        "~/.config/gcloud",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

fn default_max_actions_per_hour() -> u32 {
    100
}

// ============================================
// Supporting Types
// ============================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubAgentIsolation {
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentRef {
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub isolation: Option<SubAgentIsolation>,
}

/// Re-exported canonical compaction config. The design unifies the previous
/// schema-layer stub with the richer `model_context::compaction::CompactionConfig`
/// so every reader consumes the same fields (summary model, token floors,
/// buffer sizes, etc.) instead of silently losing them when deserialized
/// through the schema-layer stub.
pub use crate::core::model_context::compaction::CompactionConfig;

/// Per-agent skills configuration.
/// When `None` on `AgentDefinition`, the agent uses the default
/// skills enablement (all built-in skills active, nothing disabled).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsConfig {
    /// Override global `skills_enabled`. `None` = inherit global setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Whitelist: only load these skills. Empty = load all available.
    /// Read by `processor::prompt` and forwarded to
    /// `SkillsLoader::build_skill_listing_attachment` as a whitelist
    /// filter — distinct from the resolved `SkillsParams`, which only
    /// carries the blacklist. Currently no UI editor populates this
    /// field; programmatic writes to the agent JSON take effect at the
    /// next resolve.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub include: Vec<String>,
    /// Blacklist: skills excluded from this agent. Populated by the
    /// `skills_toggle` RPC when the user disables a row in the agent's
    /// skills table.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
    /// Additional read-only skill directories to scan for this agent.
    /// Each entry must point at a directory whose immediate children are
    /// skill folders containing `SKILL.md`. Used by prebuilt agents that
    /// ship with a curated skill pack outside the user's global skills.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_dirs: Vec<String>,
}

/// Tool selection for an agent definition.
///
/// Three orthogonal axes — the resolver merges them into a single
/// `ResolvedToolSelection` consumed at runtime.
///
/// Capabilities are the outer runtime boundary. The lists below express
/// per-agent allow/deny deltas inside that boundary; they cannot grant a
/// tool whose `RequiredCapability` is not satisfied by the agent's
/// `CapabilitySet`.
///
/// - `system_restrict_to_tools` — **system-pinned allowlist** authored
///   by builtin definitions (Wingman, explore agent, memory_extractor,
///   memory_consolidator, etc.). The UI exposes
///   it read-only. `None` means "no system restriction"; `Some(list)`
///   means "the agent's role caps it to this set, but users can
///   *subtract* via `excluded_tools` and *add* capability-allowed tools
///   via `user_allowed_tools`".
///
/// - `user_allowed_tools` — **user additions** on top of the system
///   set. Always materialised (never `None`) so we can patch
///   incrementally. Empty means "no user additions".
///
/// - `excluded_tools` — **user subtractions**. Honoured regardless of
///   whether the tool came from the system set or the user-added set.
///
/// `None` for `system_restrict_to_tools` and an empty
/// `user_allowed_tools` means "agent sees every capability-allowed
/// builtin tool minus `excluded_tools`" (the open default that builtin
/// OS / SDE / Custom agents start from). The legacy field name
/// `restrict_to_tools` is
/// accepted via serde alias so older persisted `agent-definitions.json`
/// files migrate transparently — once such a definition is re-saved it
/// is rewritten under the new field name.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolSelection {
    /// SYSTEM-pinned allowlist authored by builtin definitions.
    /// `None` = no system restriction. Read-only in user UI.
    /// Accepts the legacy `restrict_to_tools` / `restrictToTools`
    /// field names from older persisted definitions.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "restrict_to_tools",
        alias = "restrictToTools"
    )]
    pub system_restrict_to_tools: Option<Vec<String>>,

    /// USER additions on top of `system_restrict_to_tools`. This can
    /// restore tools hidden by the system allow-list, but cannot cross
    /// capability boundaries at resolve time.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub user_allowed_tools: Vec<String>,

    /// USER subtractions. Honoured regardless of system or user
    /// allowlist; surfaces the per-agent toggle-offs from the UI.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_tools: Vec<String>,

    /// MCP server names to hide entirely (all tools under these
    /// servers are removed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_mcp_servers: Vec<String>,

    /// Individual MCP tools to hide, using the
    /// `mcp__<server>__<tool>` naming convention.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_mcp_tools: Vec<String>,
}

/// Delegation configuration — controls how this agent behaves when
/// invoked as a delegate. Per-agent iteration caps belong on
/// `session_model.max_iterations` (consumed by `processor::execute`);
/// subagents themselves run unlimited (loop guarded by repeat
/// detection, error-loop breaker, and cancellation).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationConfig {
    /// Whether this agent can be invoked via the `delegate` tool.
    #[serde(default = "app_utils::default_true")]
    pub delegatable: bool,
    /// Dynamic context to inject into the system prompt when running as delegate.
    /// Options: "code_accounts", "team_members", "agent_definitions", "agent_orgs",
    /// "environment"
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_builders: Vec<String>,
}

impl Default for DelegationConfig {
    fn default() -> Self {
        Self {
            delegatable: true,
            context_builders: Vec::new(),
        }
    }
}

// ============================================
// Agent Definition
// ============================================

/// The unified agent definition — all agents are instances of this struct.
///
/// Builtin agents (OS, SDE, Gateway) are defined in `builtin/` module.
/// Custom agents are stored in `~/.orgii/agent-definitions.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    /// Unique identifier. Builtin agents use "builtin:" prefix.
    pub id: String,

    /// Human-readable name.
    pub name: String,

    /// Description of what this agent does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Whether this is a builtin agent (cannot be modified by users).
    #[serde(default)]
    pub built_in: bool,

    /// Tier classification (primary = core, secondary = supporting).
    #[serde(default)]
    pub tier: AgentTier,

    // ── Template Inheritance ──
    /// Parent template to inherit from.
    /// e.g., "builtin:base", "builtin:sde", "custom:my-agent"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherits_from: Option<String>,

    // ── Capabilities ──
    /// Capability set — defines what this agent can do.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<CapabilitySet>,

    // ── Session Model ──
    /// Session model — controls how sessions are managed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_model: Option<SessionModel>,

    // ── LLM / runtime fields ──
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u64>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,

    /// "Soul" = the agent's role + voice definition. This is the
    /// canonical built-in part of an agent's system prompt — its
    /// answer to "who am I and how do I behave?". For built-in
    /// agents it is compiled from `prompts/<agent>.md` (e.g.
    /// `prompts/os.md`, `prompts/sde.md`). Custom agents author it
    /// directly via the Agent wizard.
    ///
    /// Stacked at order 10 by `IdentitySection` in the prompt
    /// pipeline. There is no global user-level personality file —
    /// each agent owns its own `soul_content`, edited per-agent in
    /// the Agent Orgs UI. See `core/session/prompt/sections_v2.rs`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soul_content: Option<String>,

    /// When `true`, the unified prompt builder injects ONLY the
    /// identity (`soul_content`) and the minimal meta sections that
    /// every agent needs (tool listing, rules loaded from `.orgii/`,
    /// L3 learnings). It suppresses all the "default" sections that
    /// assume a coding/OS agent is running: channel environment,
    /// SDE / channel behavioral rules, runtime line, sub-agent
    /// delegation guide, command-approval framework,
    /// model-identity disclaimer, task-routing advice, etc.
    ///
    /// Use for agents whose soul is itself a complete, self-contained
    /// role definition (for example a custom triage/router agent must
    /// not be told "you are an SDE coding assistant" after its own
    /// soul has introduced it as a router). Default: `false`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub sovereign_prompt: bool,

    /// Sub-agents that can be spawned by this agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_agents: Option<Vec<SubAgentRef>>,

    /// Tool selection for this agent (allowlist / blacklist of built-in and
    /// MCP tools). Defaults to "inherit everything" when all fields are empty.
    #[serde(default)]
    pub tools: AgentToolSelection,

    /// Load workspace-scoped skills, MCP servers, and plugins for this agent.
    /// User/global resources still load when this is false. `None` resolves to true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_workspace_resources: Option<bool>,

    /// Load workspace-scoped rules for this agent. User/global rules still load when this is false.
    /// `None` resolves to true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_workspace_rules: Option<bool>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load_workspace_settings: Option<bool>,

    /// Per-agent skills configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills_config: Option<AgentSkillsConfig>,

    /// Preferred code account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_account_id: Option<String>,

    /// Preferred model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_model_id: Option<String>,

    /// Delegation configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation_config: Option<DelegationConfig>,

    // ── Visual / Display metadata ──
    /// Icon identifier used by frontend to resolve an SVG/React component.
    /// For builtin agents: "os", "sde", "gateway", etc.
    /// For CLI agents: "claude_code", "cursor_cli", "codex", etc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<String>,

    // ── Per-agent runtime fields ──
    /// Enable animation in UI (OS-only in UI).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animate: Option<bool>,

    /// Execution mode for coding tool dispatch (`Direct` vs `WorkStation`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<ExecutionMode>,

    /// Per-agent shell/subprocess timeout in seconds. `None` = inherit
    /// the resolver default (`DEFAULT_EXEC_TIMEOUT_SECS`, currently 60s).
    /// Consumed by `ExecTool` via `ResolvedAgent.exec_timeout`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exec_timeout: Option<u64>,

    /// Maximum read-only tool/sub-agent tool calls that may execute
    /// concurrently from one assistant message. `None` = resolver default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tool_use_concurrency: Option<u32>,

    /// Maximum number of times this agent may be spawned as a subagent
    /// within a single parent session turn. Prevents runaway LLM delegation
    /// loops. `None` = use `DEFAULT_MAX_SUBAGENT_INSTANCES`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_instances: Option<u32>,

    // NOTE: `restrict_to_workspace` was a parallel toggle that meant the
    // same thing as `agent_policy.workspace_only`, just plumbed through a
    // different field. The two could drift and confuse the per-agent UI.
    // The flag is now derived exclusively from `policy.workspace_only`
    // at resolve / tool-registration time. Do not reintroduce the field.
    /// Per-agent L3 learnings policy: enabled flag, plus the two
    /// post-session sub-agent toggles (`extract_memories_enabled`,
    /// `auto_dream_enabled`). Embedding-engine settings are app-level —
    /// see `IntegrationsConfig.embedding`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learnings: Option<AgentLearningsConfig>,

    /// Unified agent policy (security autonomy + tool rules, under one
    /// field so callers do not have to reconcile a split). `None` =
    /// inherit from parent via template, or default at resolve time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_policy: Option<AgentPolicy>,

    /// Provider reliability settings (retry, circuit breaker, fallback
    /// chain). `None` = use `ReliabilityConfig::default()` at resolve
    /// time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reliability: Option<ReliabilityConfig>,
}

// ============================================
// Agent Learnings Policy
// ============================================

/// Per-agent L3 learnings policy.
///
/// Agent-intrinsic (per-`AgentDefinition`) — distinct from
/// `IntegrationsConfig.embedding`, which holds app-level embedding-engine
/// settings (provider, model, chunk sizes).
///
/// # Fields
///
/// - `enabled` — master switch for the L3 *write* path. When `false`,
///   reflection / active-learning / consolidation skip this agent. The
///   read path (prompt injection of historical learnings) is intentionally
///   NOT gated by this flag — users who opt out still benefit from prior
///   learnings and can deprecate them via the Learnings Browser.
/// - `extract_memories_enabled` — whether the memory-extractor sub-agent
///   runs on session end.
/// - `auto_dream_enabled` — whether the memory-consolidator ("auto-dream")
///   sub-agent runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLearningsConfig {
    #[serde(default = "app_utils::default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub extract_memories_enabled: bool,
    #[serde(default)]
    pub auto_dream_enabled: bool,
}

impl Default for AgentLearningsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            extract_memories_enabled: false,
            auto_dream_enabled: false,
        }
    }
}
