//! Typed patch shape for `AgentDefinition`.
//!
//! Agent patch contract §11.9 + §13 — the single wire shape that the four new Tauri
//! RPCs (`agent_def_get`, `agent_def_update_patch`, `integrations_get`,
//! `integrations_update_patch`) use to mutate agent config.
//!
//! # Shape
//!
//! Every mutable field on `AgentDefinition` has a matching
//! `Option<T>` field on `AgentDefinitionPatch`. Semantics:
//!
//! - **Field absent from wire (JSON `{}`)** — deserialised as `None`,
//!   leave the existing value unchanged.
//! - **Field present with a value** — replace the existing value
//!   wholesale with the supplied value.
//!
//! # Replace-vs-merge trade-off
//!
//! This patch does **not** deep-merge nested structs. Setting
//! `learnings: Some(cfg)` replaces the whole `AgentLearningsConfig`.
//! The rationale (§11.9.4): callers can always read the current value
//! via `agent_def_get`, mutate the fields they care about locally, then
//! send the full sub-struct back — no deep-merge logic anywhere in the
//! stack means no "what does merging arrays mean?" edge cases and no
//! hidden magic at the boundary.
//!
//! # No translator functions
//!
//! This module intentionally has **no** function matching the
//! translator-smell pattern `fn *(..) -> AgentConfig`. `apply_patch`
//! takes `AgentDefinition` in and gives `AgentDefinition` out — the
//! patch itself is a new-world type (same shape as `AgentDefinition`,
//! one extra `Option` layer per field).

use serde::{Deserialize, Deserializer, Serialize};

/// Custom deserializer that distinguishes "field absent" (`None`) from
/// "field present and null" (`Some(None)`) for a nullable patch field,
/// encoded on the wire as a JSON `null` vs a missing key.
///
/// Used with `Option<Option<T>>` so that:
///
/// - `{}` (key missing) deserialises to `None` → leave target unchanged
/// - `{"x": null}` deserialises to `Some(None)` → clear target
/// - `{"x": <value>}` deserialises to `Some(Some(value))` → set target
///
/// Combined with `serde(default)`, this gives full tri-state semantics.
fn deserialize_optional_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

use super::capabilities::CapabilitySet;
use super::schema::{
    AgentDefinition, AgentLearningsConfig, AgentPolicy, AgentSkillsConfig, AgentTier,
    AgentToolSelection, CompactionConfig, DelegationConfig, SessionMode, SessionModel, SubAgentRef,
};
use crate::core::config::ReliabilityConfig;
use crate::foundation::security::policy::AutonomyLevel;
use crate::foundation::security::CommandRiskRules;
use crate::integrations::config::ExecutionMode;

/// Field-level patch for [`AgentPolicy`]. Absent fields keep the target's
/// current value — the frontend no longer has to echo the full struct
/// (the old wholesale-replace semantics forced `_agentPolicy` shadow
/// copies and read-modify-write reconstruction in TS, and any forgotten
/// echo silently reset siblings).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentPolicyPatch {
    pub autonomy: Option<AutonomyLevel>,
    pub workspace_only: Option<bool>,
    pub blocked_commands: Option<Vec<String>>,
    pub forbidden_paths: Option<Vec<String>>,
    pub risk_rules: Option<CommandRiskRules>,
}

impl AgentPolicyPatch {
    fn apply(self, target: &mut AgentPolicy) {
        if let Some(v) = self.autonomy {
            target.autonomy = v;
        }
        if let Some(v) = self.workspace_only {
            target.workspace_only = v;
        }
        if let Some(v) = self.blocked_commands {
            target.blocked_commands = v;
        }
        if let Some(v) = self.forbidden_paths {
            target.forbidden_paths = v;
        }
        if let Some(v) = self.risk_rules {
            target.risk_rules = v;
        }
    }
}

/// Field-level patch for [`SessionModel`]. Absent fields keep the
/// target's current values — editing just `compaction` can no longer
/// snap `mode` back to `PerSession` (a previously-shipped bug class).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionModelPatch {
    pub mode: Option<SessionMode>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub compaction: Option<Option<CompactionConfig>>,
    pub processing_lock: Option<bool>,
    pub max_iterations: Option<u32>,
}

impl SessionModelPatch {
    fn apply(self, target: &mut SessionModel) {
        if let Some(v) = self.mode {
            target.mode = v;
        }
        if let Some(v) = self.compaction {
            target.compaction = v;
        }
        if let Some(v) = self.processing_lock {
            target.processing_lock = v;
        }
        if let Some(v) = self.max_iterations {
            target.max_iterations = v;
        }
    }
}

/// Field-level patch for [`AgentToolSelection`]. Absent fields keep the
/// target's current values — the Settings tool editor sends only the
/// lists it edited instead of read-modify-writing the whole struct.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentToolSelectionPatch {
    /// System-pinned allowlist. Tri-state: absent = keep, `null` = clear,
    /// list = set. Stripped by `gate_for_builtin` for builtin agents.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable",
        alias = "restrictToTools"
    )]
    pub system_restrict_to_tools: Option<Option<Vec<String>>>,
    pub user_allowed_tools: Option<Vec<String>>,
    pub excluded_tools: Option<Vec<String>>,
    pub disabled_mcp_servers: Option<Vec<String>>,
    pub disabled_mcp_tools: Option<Vec<String>>,
}

impl AgentToolSelectionPatch {
    fn apply(self, target: &mut AgentToolSelection) {
        if let Some(v) = self.system_restrict_to_tools {
            target.system_restrict_to_tools = v;
        }
        if let Some(v) = self.user_allowed_tools {
            target.user_allowed_tools = v;
        }
        if let Some(v) = self.excluded_tools {
            target.excluded_tools = v;
        }
        if let Some(v) = self.disabled_mcp_servers {
            target.disabled_mcp_servers = v;
        }
        if let Some(v) = self.disabled_mcp_tools {
            target.disabled_mcp_tools = v;
        }
    }
}

/// Typed patch for [`AgentDefinition`]. Every field is `Option<T>`:
/// `None` means "leave this field unchanged", `Some(value)` replaces
/// the existing value wholesale.
///
/// `id` and `built_in` are intentionally not present — identity and
/// builtin flag are structural properties set at creation time and
/// cannot be mutated via this patch surface.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentDefinitionPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tier: Option<AgentTier>,
    pub inherits_from: Option<String>,
    pub capabilities: Option<CapabilitySet>,
    pub session_model: Option<SessionModelPatch>,
    /// Tri-state nullable on the wire (`null` clears, `0` is treated as
    /// "auto" sentinel and also clears, positive values replace).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub context_window: Option<Option<u64>>,
    /// Same tri-state semantics as `context_window`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub max_tokens: Option<Option<u64>>,
    pub temperature: Option<f64>,
    /// Tri-state nullable field on the wire:
    /// - absent (`{}`) → leave unchanged
    /// - present with `null` → clear the target field
    /// - present with a string → replace the target field
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub soul_content: Option<Option<String>>,
    pub sovereign_prompt: Option<bool>,
    pub sub_agents: Option<Vec<SubAgentRef>>,
    pub tools: Option<AgentToolSelectionPatch>,
    pub load_workspace_resources: Option<bool>,
    pub load_workspace_rules: Option<bool>,
    pub skills_config: Option<AgentSkillsConfig>,
    /// Tri-state nullable on the wire:
    /// - absent (`{}`) → leave unchanged
    /// - present `null` → clear (resolver falls back to inheritance)
    /// - present string → set
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub selected_account_id: Option<Option<String>>,
    /// Same tri-state semantics as `selected_account_id`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub selected_model_id: Option<Option<String>>,
    pub delegation_config: Option<DelegationConfig>,
    pub icon_id: Option<String>,
    pub animate: Option<bool>,
    pub execution_mode: Option<ExecutionMode>,
    /// Tri-state per-agent timeout override.
    /// - absent → leave target untouched
    /// - present `null` → clear (resolver default applies)
    /// - present number → set
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub exec_timeout: Option<Option<u64>>,
    /// Tri-state per-agent max concurrent tool-use override.
    /// - absent → leave target untouched
    /// - present `null` or `0` → clear (resolver default applies)
    /// - present positive number → set
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nullable"
    )]
    pub max_tool_use_concurrency: Option<Option<u32>>,
    // NOTE: `restrict_to_workspace` patch was removed alongside the
    // schema field. The single source of truth is now
    // `agent_policy.workspace_only` — write there if you want to flip
    // workspace restriction per-agent.
    pub learnings: Option<AgentLearningsConfig>,
    pub agent_policy: Option<AgentPolicyPatch>,
    pub reliability: Option<ReliabilityConfig>,
}

impl AgentDefinitionPatch {
    /// Strip fields that are immutable for builtin agents.
    ///
    /// Builtin agents have system-authored identity, capability set,
    /// sub-agent roster, and system-restricted tool allowlist. Users can
    /// still edit:
    /// - presentational fields (`name`, `description`, `icon_id`, `animate`)
    /// - per-agent runtime knobs (`session_model`, context/
    ///   token/temperature, `learnings`, `agent_policy`, `reliability`,
    ///   `delegation_config`, `selected_account_id`, `selected_model_id`,
    ///   `execution_mode`, `exec_timeout`)
    /// - tool deltas via `tools.user_allowed_tools` and `tools.excluded_tools`
    ///   (the `tools` patch is forwarded; it's the inner `system_restrict_to_tools`
    ///   field that is preserved by the frontend's read-modify-write)
    ///
    /// Fields that are stripped here:
    /// - `tier` — structural placement
    /// - `inherits_from` — inheritance graph
    /// - `capabilities` — system-pinned capability set
    /// - `sovereign_prompt` — identity flag (system-authored)
    /// - `tools.system_restrict_to_tools` — system-pinned tool allowlist
    ///   (the rest of the `tools` patch — `user_allowed_tools`,
    ///   `excluded_tools`, `disabled_mcp_servers`, `disabled_mcp_tools` —
    ///   passes through so users can add/remove tools on builtins)
    ///
    /// Fields that pass through (user-editable on builtins):
    /// - `soul_content` — Personality editor override
    /// - `sub_agents` — Sub-Agents tab roster (OS/SDE expose this UI)
    /// - `skills_config` — Skills tab include/exclude (the dedicated
    ///   `skills_toggle` RPC writes to the same field on builtin agents
    ///   via `update_with_overlay`, so the patch path must agree)
    pub fn gate_for_builtin(mut self) -> Self {
        self.tier = None;
        self.inherits_from = None;
        self.capabilities = None;
        self.sovereign_prompt = None;
        if let Some(ref mut tools) = self.tools {
            tools.system_restrict_to_tools = None;
        }
        self
    }

    /// Apply this patch to `target` in place. Every `Some` field is
    /// wholesale-written onto the corresponding field on `target`;
    /// `None` fields are left alone.
    pub fn apply(self, target: &mut AgentDefinition) {
        if let Some(v) = self.name {
            target.name = v;
        }
        if let Some(v) = self.description {
            target.description = Some(v);
        }
        if let Some(v) = self.tier {
            target.tier = v;
        }
        if let Some(v) = self.inherits_from {
            target.inherits_from = Some(v);
        }
        if let Some(v) = self.capabilities {
            target.capabilities = Some(v);
        }
        if let Some(v) = self.session_model {
            let mut current = target.session_model.clone().unwrap_or_default();
            v.apply(&mut current);
            target.session_model = Some(current);
        }
        if let Some(v) = self.context_window {
            // 0 is the "auto" sentinel — clear instead of storing Some(0).
            target.context_window = v.filter(|&n| n > 0);
        }
        if let Some(v) = self.max_tokens {
            target.max_tokens = v.filter(|&n| n > 0);
        }
        if let Some(v) = self.temperature {
            target.temperature = Some(v);
        }
        if let Some(v) = self.soul_content {
            target.soul_content = v;
        }
        if let Some(v) = self.sovereign_prompt {
            target.sovereign_prompt = v;
        }
        if let Some(v) = self.sub_agents {
            target.sub_agents = Some(v);
        }
        if let Some(v) = self.tools {
            v.apply(&mut target.tools);
        }
        if let Some(v) = self.load_workspace_resources {
            target.load_workspace_resources = Some(v);
        }
        if let Some(v) = self.load_workspace_rules {
            target.load_workspace_rules = Some(v);
        }
        if let Some(v) = self.skills_config {
            target.skills_config = Some(v);
        }
        if let Some(v) = self.selected_account_id {
            target.selected_account_id = v;
        }
        if let Some(v) = self.selected_model_id {
            target.selected_model_id = v;
        }
        if let Some(v) = self.delegation_config {
            target.delegation_config = Some(v);
        }
        if let Some(v) = self.icon_id {
            target.icon_id = Some(v);
        }
        if let Some(v) = self.animate {
            target.animate = Some(v);
        }
        if let Some(v) = self.execution_mode {
            target.execution_mode = Some(v);
        }
        if let Some(v) = self.exec_timeout {
            // 0 is treated as "clear" since 0s timeout is not meaningful.
            target.exec_timeout = v.filter(|&n| n > 0);
        }
        if let Some(v) = self.max_tool_use_concurrency {
            target.max_tool_use_concurrency = v.filter(|&n| n > 0);
        }
        if let Some(v) = self.learnings {
            target.learnings = Some(v);
        }
        if let Some(v) = self.agent_policy {
            let mut current = target.agent_policy.clone().unwrap_or_default();
            v.apply(&mut current);
            target.agent_policy = Some(current);
        }
        if let Some(v) = self.reliability {
            target.reliability = Some(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::definitions::schema::AgentLearningsConfig;

    #[test]
    fn empty_patch_leaves_target_unchanged() {
        let mut target = AgentDefinition {
            id: "builtin:sde".to_string(),
            name: "SDE".to_string(),
            built_in: true,
            ..Default::default()
        };
        let before = target.clone();

        let patch = AgentDefinitionPatch::default();
        patch.apply(&mut target);

        assert_eq!(target.id, before.id);
        assert_eq!(target.name, before.name);
        assert_eq!(target.built_in, before.built_in);
    }

    #[test]
    fn patch_replaces_name_only() {
        let mut target = AgentDefinition {
            id: "builtin:sde".to_string(),
            name: "Old".to_string(),
            description: Some("desc".to_string()),
            ..Default::default()
        };

        let patch = AgentDefinitionPatch {
            name: Some("New".to_string()),
            ..Default::default()
        };
        patch.apply(&mut target);

        assert_eq!(target.name, "New");
        assert_eq!(target.description.as_deref(), Some("desc"));
    }

    #[test]
    fn patch_replaces_learnings_wholesale() {
        let mut target = AgentDefinition {
            id: "builtin:sde".to_string(),
            learnings: Some(AgentLearningsConfig {
                enabled: false,
                ..Default::default()
            }),
            ..Default::default()
        };

        let new_cfg = AgentLearningsConfig {
            auto_dream_enabled: true,
            ..Default::default()
        };

        let patch = AgentDefinitionPatch {
            learnings: Some(new_cfg),
            ..Default::default()
        };
        patch.apply(&mut target);

        let after = target.learnings.as_ref().unwrap();
        assert!(after.enabled, "new config is default (enabled=true)");
        assert!(after.auto_dream_enabled);
    }

    #[test]
    fn patch_deserialises_from_empty_json() {
        let patch: AgentDefinitionPatch =
            serde_json::from_str("{}").expect("empty object decodes to all-None patch");
        assert!(patch.name.is_none());
        assert!(patch.learnings.is_none());
    }

    #[test]
    fn gate_for_builtin_strips_system_fields_keeps_user_fields() {
        use crate::core::definitions::capabilities::{CapabilitySet, CodingCapability};

        let patch = AgentDefinitionPatch {
            name: Some("My OS".to_string()),
            description: Some("custom desc".to_string()),
            tier: Some(AgentTier::Secondary),
            inherits_from: Some("base".to_string()),
            capabilities: Some(CapabilitySet {
                coding: Some(CodingCapability::default()),
                ..Default::default()
            }),
            soul_content: Some(Some("hijacked".to_string())),
            sovereign_prompt: Some(true),
            sub_agents: Some(vec![]),
            skills_config: Some(AgentSkillsConfig::default()),
            tools: Some(AgentToolSelectionPatch::default()),
            learnings: Some(AgentLearningsConfig::default()),
            agent_policy: Some(AgentPolicyPatch::default()),
            ..Default::default()
        };

        let gated = patch.gate_for_builtin();

        assert!(gated.tier.is_none(), "tier stripped");
        assert!(gated.inherits_from.is_none(), "inherits_from stripped");
        assert!(gated.capabilities.is_none(), "capabilities stripped");
        assert!(
            gated.sovereign_prompt.is_none(),
            "sovereign_prompt stripped"
        );

        assert!(
            gated.sub_agents.is_some(),
            "sub_agents kept — Sub-Agents tab edits builtin rosters"
        );
        assert!(
            gated.skills_config.is_some(),
            "skills_config kept — skills_toggle writes the same field"
        );
        assert!(
            gated.soul_content.is_some(),
            "soul_content kept — users can override builtin personality"
        );
        assert_eq!(gated.name.as_deref(), Some("My OS"), "name kept");
        assert_eq!(
            gated.description.as_deref(),
            Some("custom desc"),
            "description kept"
        );
        assert!(
            gated.tools.is_some(),
            "tools kept (inner field preserves system fields via read-modify-write)"
        );
        assert!(gated.learnings.is_some(), "learnings kept");
        assert!(gated.agent_policy.is_some(), "agent_policy kept");
    }

    #[test]
    fn gate_for_builtin_strips_system_restrict_to_tools_inside_tools_patch() {
        let patch = AgentDefinitionPatch {
            tools: Some(AgentToolSelectionPatch {
                system_restrict_to_tools: Some(Some(vec!["tampered".to_string()])),
                user_allowed_tools: Some(vec!["user_kept".to_string()]),
                excluded_tools: Some(vec!["user_excluded".to_string()]),
                ..Default::default()
            }),
            ..Default::default()
        };

        let gated = patch.gate_for_builtin();
        let tools = gated.tools.expect("tools kept");
        assert!(
            tools.system_restrict_to_tools.is_none(),
            "system_restrict_to_tools stripped on builtin"
        );
        assert_eq!(
            tools.user_allowed_tools,
            Some(vec!["user_kept".to_string()])
        );
        assert_eq!(
            tools.excluded_tools,
            Some(vec!["user_excluded".to_string()])
        );
    }

    #[test]
    fn soul_content_tri_state_absent_keeps_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            soul_content: Some("kept".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch = serde_json::from_str("{}").expect("empty object decodes");
        patch.apply(&mut target);
        assert_eq!(target.soul_content.as_deref(), Some("kept"));
    }

    #[test]
    fn soul_content_tri_state_explicit_null_clears_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            soul_content: Some("to be cleared".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"soulContent":null}"#).expect("explicit null decodes");
        patch.apply(&mut target);
        assert!(target.soul_content.is_none(), "explicit null clears");
    }

    #[test]
    fn soul_content_tri_state_string_replaces_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            soul_content: Some("old".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"soulContent":"new"}"#).expect("string decodes");
        patch.apply(&mut target);
        assert_eq!(target.soul_content.as_deref(), Some("new"));
    }

    #[test]
    fn context_window_sentinel_zero_clears_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            context_window: Some(200_000),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"contextWindow":0}"#).expect("0 decodes");
        patch.apply(&mut target);
        assert!(
            target.context_window.is_none(),
            "0 sentinel cleared context_window"
        );
    }

    #[test]
    fn context_window_explicit_null_clears_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            context_window: Some(200_000),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"contextWindow":null}"#).expect("null decodes");
        patch.apply(&mut target);
        assert!(target.context_window.is_none());
    }

    #[test]
    fn context_window_absent_leaves_target_unchanged() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            context_window: Some(200_000),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch = serde_json::from_str("{}").expect("empty decodes");
        patch.apply(&mut target);
        assert_eq!(target.context_window, Some(200_000));
    }

    #[test]
    fn context_window_positive_value_replaces() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            context_window: None,
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"contextWindow":128000}"#).expect("number decodes");
        patch.apply(&mut target);
        assert_eq!(target.context_window, Some(128_000));
    }

    #[test]
    fn apply_tools_patch_with_none_system_field_preserves_target_system_field() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            built_in: true,
            tools: AgentToolSelection {
                system_restrict_to_tools: Some(vec!["sys_pinned".to_string()]),
                user_allowed_tools: vec![],
                excluded_tools: vec![],
                ..Default::default()
            },
            ..Default::default()
        };

        let patch = AgentDefinitionPatch {
            tools: Some(AgentToolSelectionPatch {
                system_restrict_to_tools: None,
                user_allowed_tools: Some(vec!["user_added".to_string()]),
                excluded_tools: None,
                ..Default::default()
            }),
            ..Default::default()
        };
        patch.apply(&mut target);

        assert_eq!(
            target.tools.system_restrict_to_tools.as_deref(),
            Some(&["sys_pinned".to_string()][..]),
            "target system_restrict_to_tools preserved when patch.tools.system_restrict_to_tools is None"
        );
        assert_eq!(target.tools.user_allowed_tools, vec!["user_added"]);
    }

    #[test]
    fn selected_model_id_tri_state_absent_keeps_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_model_id: Some("kept".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch = serde_json::from_str("{}").expect("empty object decodes");
        patch.apply(&mut target);
        assert_eq!(target.selected_model_id.as_deref(), Some("kept"));
    }

    #[test]
    fn selected_model_id_tri_state_explicit_null_clears_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_model_id: Some("to be cleared".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"selectedModelId":null}"#).expect("explicit null decodes");
        patch.apply(&mut target);
        assert!(target.selected_model_id.is_none(), "explicit null clears");
    }

    #[test]
    fn selected_model_id_tri_state_string_replaces_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_model_id: Some("old".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"selectedModelId":"new"}"#).expect("string decodes");
        patch.apply(&mut target);
        assert_eq!(target.selected_model_id.as_deref(), Some("new"));
    }

    #[test]
    fn selected_account_id_tri_state_absent_keeps_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_account_id: Some("acct-kept".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch = serde_json::from_str("{}").expect("empty object decodes");
        patch.apply(&mut target);
        assert_eq!(target.selected_account_id.as_deref(), Some("acct-kept"));
    }

    #[test]
    fn selected_account_id_tri_state_explicit_null_clears_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_account_id: Some("acct-old".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"selectedAccountId":null}"#).expect("explicit null decodes");
        patch.apply(&mut target);
        assert!(target.selected_account_id.is_none(), "explicit null clears");
    }

    #[test]
    fn selected_account_id_tri_state_string_replaces_target() {
        let mut target = AgentDefinition {
            id: "builtin:os".to_string(),
            selected_account_id: Some("acct-old".to_string()),
            ..Default::default()
        };
        let patch: AgentDefinitionPatch =
            serde_json::from_str(r#"{"selectedAccountId":"acct-new"}"#).expect("string decodes");
        patch.apply(&mut target);
        assert_eq!(target.selected_account_id.as_deref(), Some("acct-new"));
    }

    #[test]
    fn patch_deserialises_camel_case_field_names() {
        let patch: AgentDefinitionPatch = serde_json::from_str(
            r#"{"learnings":{"enabled":true,"extractMemoriesEnabled":false,"autoDreamEnabled":false},"soulContent":"hi","loadWorkspaceResources":false,"loadWorkspaceRules":true}"#,
        )
        .expect("camelCase decodes");
        assert!(patch.learnings.is_some());
        assert_eq!(
            patch.soul_content,
            Some(Some("hi".to_string())),
            "soulContent string decodes to Some(Some(\"hi\"))"
        );
        assert_eq!(patch.load_workspace_resources, Some(false));
        assert_eq!(patch.load_workspace_rules, Some(true));
    }
}
