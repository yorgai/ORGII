//! HTTP DTO layer for the agent REST API (the REST DTO layer (design doc §6, step 7)).
//!
//! Invariant **I-DTO-BOUNDARY** (§0): external HTTP clients consume
//! versioned DTOs; the internal `ResolvedAgent` / `AgentDefinition` /
//! `IntegrationsConfig` structs **never** leak through the wire.
//!
//! # Why a separate type?
//!
//! `ResolvedAgent` is a *runtime* shape — its field set is allowed to
//! change whenever the resolve algorithm changes. `IntegrationsConfig`
//! is an *on-disk* shape — its serde representation is allowed to grow
//! new optional fields. Both are internal contracts. HTTP clients need
//! a different stability guarantee: a client written against `version: 1`
//! must keep working until we explicitly bump to `version: 2`.
//!
//! Keeping the DTO definition in this module means:
//!
//! - Editing `ResolvedAgent` does not silently change the wire format.
//! - Editing the DTO without bumping `version` is a code-review red flag
//!   reviewers can grep for (`AgentRuntimeView::VERSION`).
//! - The conversion from internal → DTO is centralised in `From` impls,
//!   so no endpoint has to assemble a DTO by hand.
//!
//! # Versioning policy
//!
//! - `version: 1` ships with Commit B of the agent-definition rollout.
//! - Adding a new field with a sensible serde default → keep `version: 1`.
//! - Renaming, removing, or changing the type of an existing field →
//!   bump to `version: 2` and keep the old DTO around as
//!   `AgentRuntimeViewV1` until clients have migrated.
//!
//! This is the *only* place in the backend that declares a `version:`
//! field on a wire payload — keep it that way.

use serde::{Deserialize, Serialize};

use agent_core::core::definitions::resolved::ResolvedAgent;
use agent_core::core::definitions::schema::AgentDefinition;
use agent_core::foundation::security::policy::AutonomyLevel;
use agent_core::integrations::config::{ExecutionMode, IntegrationsConfig};

/// Stable, versioned view of an agent's runtime configuration.
///
/// Built from `(&ResolvedAgent, &IntegrationsConfig)` so the UI can render
/// app-level agent settings alongside resolved agent fields without merging
/// two payloads client-side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeView {
    /// Wire version. Bump on breaking changes; today: 1.
    pub version: u32,

    pub agent_id: String,
    pub name: String,
    pub model: String,
    pub max_tokens: u64,
    pub context_window: u64,
    pub temperature: f64,

    pub execution_mode: ExecutionModeView,
    pub autonomy: AutonomyLevelView,
    pub workspace_only: bool,

    /// Per-agent L3 learnings policy.
    pub learnings: AgentLearningsView,
    /// App-level embedding-engine settings (mirrored on the agent view so
    /// the UI can render the indexing card without making a second call).
    pub embedding: EmbeddingView,
    pub compaction: CompactionView,
    pub tools: ToolSelectionView,
    pub skills: SkillsView,

    pub animate: bool,
    pub sovereign_prompt: bool,
    pub max_iterations: u32,

    /// Selected key-vault account, if any. Mirrors
    /// `ResolvedAgent::selected_account_id` — kept as `Option` because
    /// "no account selected" is a real user-facing state.
    #[serde(default)]
    pub selected_account_id: Option<String>,
}

impl AgentRuntimeView {
    /// Current wire version. Increment iff the shape of this struct
    /// changes in a way old clients cannot handle.
    pub const VERSION: u32 = 1;

    /// Build a *definition-only* view when `ResolvedAgent::resolve` cannot
    /// proceed (e.g. the OS agent has no `selected_model_id` configured yet).
    ///
    /// Fields that require a fully resolved agent (model, tokens, temperature,
    /// tools, skills, etc.) are set to safe defaults. The UI fields that
    /// actually matter for this fallback path (`learnings`, `embedding`) are
    /// populated correctly from `def` and `integrations`.
    pub fn from_definition(def: &AgentDefinition, integrations: &IntegrationsConfig) -> Self {
        let learnings = def.learnings.clone().unwrap_or_default();
        Self {
            version: Self::VERSION,
            agent_id: def.id.clone(),
            name: def.name.clone(),
            model: String::new(),
            max_tokens: 8192,
            context_window: 200_000,
            temperature: 0.0,
            execution_mode: ExecutionModeView::Direct,
            autonomy: AutonomyLevelView::from(AutonomyLevel::default()),
            workspace_only: false,
            learnings: AgentLearningsView::from(&learnings),
            embedding: EmbeddingView::from(&integrations.embedding),
            compaction: CompactionView::default(),
            tools: ToolSelectionView::default(),
            skills: SkillsView::default(),
            animate: false,
            sovereign_prompt: false,
            max_iterations: 50,
            selected_account_id: None,
        }
    }
}

impl From<(&ResolvedAgent, &IntegrationsConfig)> for AgentRuntimeView {
    fn from((resolved, integrations): (&ResolvedAgent, &IntegrationsConfig)) -> Self {
        Self {
            version: Self::VERSION,
            agent_id: resolved.agent_id.clone(),
            name: resolved.name.clone(),
            model: resolved.selected_model_id.clone(),
            max_tokens: resolved.max_tokens,
            context_window: resolved.context_window,
            temperature: resolved.temperature,
            execution_mode: ExecutionModeView::from(resolved.execution_mode),
            autonomy: AutonomyLevelView::from(resolved.policy.autonomy),
            workspace_only: resolved.policy.workspace_only,
            learnings: AgentLearningsView::from(&resolved.learnings),
            embedding: EmbeddingView::from(&integrations.embedding),
            compaction: CompactionView::from(&resolved.compaction),
            tools: ToolSelectionView::from(&resolved.tools),
            skills: SkillsView::from(&resolved.skills),
            animate: resolved.animate,
            sovereign_prompt: resolved.sovereign_prompt,
            max_iterations: resolved.session_model.max_iterations,
            selected_account_id: resolved.selected_account_id.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

/// Stable view of `ExecutionMode`. Keeps the wire string set frozen
/// independently of the internal enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionModeView {
    Direct,
    WorkStation,
}

impl From<ExecutionMode> for ExecutionModeView {
    fn from(mode: ExecutionMode) -> Self {
        match mode {
            ExecutionMode::Direct => Self::Direct,
            ExecutionMode::WorkStation => Self::WorkStation,
        }
    }
}

/// Stable view of `AutonomyLevel` exposed as the UI Access Mode.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutonomyLevelView {
    ReadOnly,
    Full,
}

impl From<AutonomyLevel> for AutonomyLevelView {
    fn from(level: AutonomyLevel) -> Self {
        match level {
            AutonomyLevel::ReadOnly => Self::ReadOnly,
            AutonomyLevel::Full => Self::Full,
        }
    }
}

/// Stable view of `AgentLearningsConfig` (per-agent L3 policy).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLearningsView {
    pub enabled: bool,
    pub extract_memories_enabled: bool,
    pub auto_dream_enabled: bool,
}

impl From<&agent_core::core::definitions::schema::AgentLearningsConfig> for AgentLearningsView {
    fn from(cfg: &agent_core::core::definitions::schema::AgentLearningsConfig) -> Self {
        Self {
            enabled: cfg.enabled,
            extract_memories_enabled: cfg.extract_memories_enabled,
            auto_dream_enabled: cfg.auto_dream_enabled,
        }
    }
}

/// Stable view of `EmbeddingConfig` (app-level embedding-engine settings).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingView {
    pub provider: String,
    #[serde(default)]
    pub model: Option<String>,
}

impl From<&agent_core::integrations::config::EmbeddingConfig> for EmbeddingView {
    fn from(cfg: &agent_core::integrations::config::EmbeddingConfig) -> Self {
        Self {
            provider: cfg.provider.clone(),
            model: cfg.model.clone(),
        }
    }
}

/// Stable view of `CompactionConfig` — surfaces the three knobs a
/// frontend can meaningfully expose.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionView {
    pub enabled: bool,
    pub trigger_ratio: f32,
    pub keep_ratio: f32,
}

impl From<&agent_core::core::definitions::schema::CompactionConfig> for CompactionView {
    fn from(cfg: &agent_core::core::definitions::schema::CompactionConfig) -> Self {
        Self {
            enabled: cfg.enabled,
            trigger_ratio: cfg.trigger_ratio,
            keep_ratio: cfg.keep_ratio,
        }
    }
}

/// Stable view of `ResolvedToolSelection`. The wire format is intentionally
/// flat — this is the shape the UI's tool panel expects.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSelectionView {
    pub restrict_to: Vec<String>,
    pub excluded: Vec<String>,
    pub disabled_mcp_servers: Vec<String>,
    pub disabled_mcp_tools: Vec<String>,
}

impl From<&agent_core::core::definitions::resolved::ResolvedToolSelection> for ToolSelectionView {
    fn from(sel: &agent_core::core::definitions::resolved::ResolvedToolSelection) -> Self {
        Self {
            restrict_to: sel.restrict_to.clone(),
            excluded: sel.excluded.clone(),
            disabled_mcp_servers: sel.disabled_mcp_servers.clone(),
            disabled_mcp_tools: sel.disabled_mcp_tools.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsView {
    pub enabled: bool,
    pub disabled: Vec<String>,
}

impl From<&agent_core::core::definitions::resolved::SkillsParams> for SkillsView {
    fn from(s: &agent_core::core::definitions::resolved::SkillsParams) -> Self {
        Self {
            enabled: s.enabled,
            disabled: s.disabled.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// IntegrationsView
// ---------------------------------------------------------------------------

/// Stable, versioned view of `IntegrationsConfig`.
///
/// Mirrors the on-disk shape but is wire-stable independent of how
/// `IntegrationsConfig` is serialised internally. The DTO intentionally
/// re-uses the same nested config types because they are themselves
/// `Serialize` and have stable serde representations — wrapping them
/// again would double the maintenance surface for no gain.
///
/// If a nested config type ever needs to evolve in a way that breaks
/// the wire format, lift it out and define a `*View` here, in the same
/// file as `AgentRuntimeView`'s sub-views.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsView {
    pub version: u32,

    pub channels: agent_core::integrations::channels::config::ChannelsConfig,
    pub databases: agent_core::core::config::DatabasesConfig,
    pub nodes: agent_core::integrations::config::NodesConfig,
    pub web_search: agent_core::integrations::config::WebSearchConfig,
    /// App-level embedding-engine settings.
    pub embedding: agent_core::integrations::config::EmbeddingConfig,
}

impl IntegrationsView {
    pub const VERSION: u32 = 1;
}

impl From<&IntegrationsConfig> for IntegrationsView {
    fn from(cfg: &IntegrationsConfig) -> Self {
        Self {
            version: Self::VERSION,
            channels: cfg.channels.clone(),
            databases: cfg.databases.clone(),
            nodes: cfg.nodes.clone(),
            web_search: cfg.web_search.clone(),
            embedding: cfg.embedding.clone(),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::core::definitions::builtin::get_builtin_agent;

    fn resolved_for(id: &str) -> ResolvedAgent {
        use agent_core::core::session::overrides::SessionOverrides;
        let mut def = get_builtin_agent(id).expect("builtin exists");
        if def.selected_model_id.is_none() {
            def.selected_model_id = Some("test/default-model".into());
        }
        ResolvedAgent::resolve(&def, None, &SessionOverrides::default()).expect("resolves")
    }

    #[test]
    fn agent_runtime_view_carries_version_and_core_fields() {
        let resolved = resolved_for("builtin:os");
        let integrations = IntegrationsConfig::default();

        let view = AgentRuntimeView::from((&resolved, &integrations));

        assert_eq!(view.version, AgentRuntimeView::VERSION);
        assert_eq!(view.version, 1);
        assert_eq!(view.agent_id, resolved.agent_id);
        assert_eq!(view.model, resolved.selected_model_id);
        assert_eq!(view.max_tokens, resolved.max_tokens);
        assert_eq!(view.temperature, resolved.temperature);
    }

    #[test]
    fn agent_runtime_view_serialises_in_camel_case() {
        let resolved = resolved_for("builtin:os");
        let integrations = IntegrationsConfig::default();
        let view = AgentRuntimeView::from((&resolved, &integrations));

        let json = serde_json::to_value(&view).expect("serialises");
        let obj = json.as_object().expect("object");

        for required in [
            "version",
            "agentId",
            "model",
            "maxTokens",
            "contextWindow",
            "executionMode",
            "autonomy",
            "learnings",
            "embedding",
        ] {
            assert!(
                obj.contains_key(required),
                "AgentRuntimeView JSON missing camelCase key '{}': {}",
                required,
                json
            );
        }

        // Snake-case must NOT leak through:
        for forbidden in ["agent_id", "max_tokens"] {
            assert!(
                !obj.contains_key(forbidden),
                "AgentRuntimeView JSON should not expose snake_case key '{}'",
                forbidden
            );
        }
    }

    #[test]
    fn integrations_view_carries_version_and_subsections() {
        let cfg = IntegrationsConfig::default();
        let view = IntegrationsView::from(&cfg);

        assert_eq!(view.version, IntegrationsView::VERSION);
        assert_eq!(view.version, 1);
        let json = serde_json::to_value(&view).expect("serialises");
        let obj = json.as_object().expect("object");
        for required in ["version", "channels", "databases", "nodes", "webSearch"] {
            assert!(
                obj.contains_key(required),
                "IntegrationsView JSON missing key '{}': {}",
                required,
                json
            );
        }
    }

    #[test]
    fn execution_mode_view_round_trips() {
        for mode in [ExecutionMode::Direct, ExecutionMode::WorkStation] {
            let view = ExecutionModeView::from(mode);
            let json = serde_json::to_string(&view).expect("serialises");
            let back: ExecutionModeView = serde_json::from_str(&json).expect("deserialises");
            // Confirm the round-trip preserves the variant by re-serialising.
            assert_eq!(
                serde_json::to_string(&back).unwrap(),
                json,
                "ExecutionModeView round-trip mismatch for {:?}",
                mode
            );
        }
    }

    #[test]
    fn autonomy_view_serialises_lowercase() {
        let json = serde_json::to_string(&AutonomyLevelView::Full).unwrap();
        assert_eq!(json, "\"full\"");
        let json = serde_json::to_string(&AutonomyLevelView::ReadOnly).unwrap();
        assert_eq!(json, "\"readonly\"");
    }
}

#[cfg(test)]
#[path = "dto_extended_tests.rs"]
mod dto_extended_tests_ext;
