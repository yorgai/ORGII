//! Debug-only Tauri command: introspect the live skills configuration
//! for an active session.
//!
//! `debug_session_skills_snapshot(session_id)` reports everything an
//! audit spec needs to prove the L4→L5 hop for the Skills subsystem:
//!
//!   * `definition_*` — the raw `AgentDefinition.skills_config` snapshot
//!     read off the session's `definition` field (captured at launch).
//!     `definition_present = false` means the agent had `skills_config:
//!     None` on disk and the resolver fell back to defaults.
//!   * `resolved_skills_enabled` / `resolved_skills_disabled` —
//!     `ResolvedAgent.skills` (the `SkillsParams` struct). The resolver
//!     collapses `enabled: Option<bool>` to `bool` (`None` → `true`)
//!     and forwards `exclude` as `disabled`. **Note:** the resolver
//!     does NOT carry the `include` whitelist — that lives only on
//!     `runtime.skills_config`, see below.
//!   * `runtime_skills_config_*` — `SessionRuntime.skills_config`,
//!     a *parallel* capture-at-launch copy of the full
//!     `AgentSkillsConfig` (with `include`). The per-turn prompt
//!     builder reads BOTH `runtime.resolved.skills.disabled` AND
//!     `runtime.skills_config.exclude`, so the audit spec must prove
//!     they agree.
//!   * `effective_per_turn_disabled` — the union the prompt builder
//!     actually feeds to `SkillsLoader::build_skill_listing_attachment`
//!     (`resolved.skills.disabled` extended with
//!     `runtime.skills_config.exclude`, sorted+deduped here for
//!     deterministic comparison). Only the per-turn listing path
//!     consults this — the persistent always-on / `include`-filtered
//!     loading uses `runtime.skills_config` directly.
//!   * `effective_include_filter` — the per-turn whitelist
//!     forwarded to the loader (`runtime.skills_config.include`,
//!     `None` when missing or empty so the loader treats it as
//!     "no filter").
//!
//! Mirrors `model_dump` / `tools_dump` / `subagent_dump`: the Rust
//! command is always callable; the frontend `__e2e` helper guards on
//! `debug_assertions || WEBDRIVER=1` so production users never see it.
//!
//! Intended use: an audit spec writes a sentinel skills patch via
//! `agent_def_update_patch` (or toggles a row via `skills_toggle`),
//! boots a session, and asserts that the live snapshot reflects
//! exactly what was on disk *at launch time*. A subsequent on-disk
//! mutation must NOT alter the running session's snapshot — that's
//! the capture-at-launch invariant for skills, which is doubly
//! interesting because skills have two parallel runtime caches
//! (`resolved.skills` and `runtime.skills_config`) that must agree.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::state::AgentAppState;

fn build_effective_skill_listing(
    runtime: &crate::state::session_runtime::SessionRuntime,
    effective_disabled: &[String],
    include_filter: Option<&[String]>,
) -> Option<String> {
    if !runtime.resolved.skills.enabled {
        return None;
    }

    let workspace_root = runtime.workspace_state.read().workspace_root.clone();
    let skills_dir = workspace_root.join(".orgii");
    let loader = crate::skills::loader::SkillsLoader::new(&skills_dir)
        .with_builtin_dir(crate::skills::loader::global_skills_dir())
        .with_agent_id(runtime.resolved.agent_id.clone())
        .with_load_workspace_settings(runtime.resolved.load_workspace_resources);
    loader.build_skill_listing_attachment(effective_disabled, include_filter)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSkillsSnapshot {
    pub session_id: String,
    pub agent_id: String,

    /// `true` iff the captured-at-launch `AgentDefinition.skills_config`
    /// on `session.definition` was `Some`. When `false` the
    /// `definition_*` fields below are zero-valued.
    pub definition_present: bool,
    /// `AgentDefinition.skills_config.enabled` captured at launch.
    /// `None` = "inherit global setting" (resolver folds it to `true`).
    pub definition_enabled: Option<bool>,
    /// `AgentDefinition.skills_config.include` captured at launch.
    pub definition_include: Vec<String>,
    /// `AgentDefinition.skills_config.exclude` captured at launch.
    pub definition_exclude: Vec<String>,

    /// `ResolvedAgent.skills.enabled` — the resolver's collapsed bool
    /// (`Option<bool>::None` → `true`).
    pub resolved_skills_enabled: bool,
    /// `ResolvedAgent.skills.disabled` — the resolver's view of the
    /// blacklist. Currently mirrors `definition_exclude` 1:1; the
    /// snapshot exposes both so a spec can pin that.
    pub resolved_skills_disabled: Vec<String>,

    /// `SessionRuntime.skills_config` is `Some` iff the runtime has a
    /// captured-at-launch copy. It can differ from `definition_present`
    /// in principle (the in-memory recover path can repopulate from a
    /// stored definition lookup), so the spec asserts agreement
    /// independently.
    pub runtime_skills_config_present: bool,
    pub runtime_skills_config_enabled: Option<bool>,
    pub runtime_skills_config_include: Vec<String>,
    pub runtime_skills_config_exclude: Vec<String>,

    /// `union(resolved.skills.disabled, runtime.skills_config.exclude)`,
    /// sorted + deduped. Mirrors the per-turn merge in
    /// `processor::prompt::build_dynamic_sections`. Spec uses this to
    /// pin that the prompt builder's two-source merge is consistent.
    pub effective_per_turn_disabled: Vec<String>,
    /// `runtime.skills_config.include` when non-empty, else `None`.
    /// Mirrors how `processor::prompt` produces the loader argument.
    pub effective_include_filter: Option<Vec<String>>,
    /// The exact skill catalogue text produced from the captured runtime
    /// inputs above, using the same `SkillsLoader::build_skill_listing_attachment`
    /// call that `processor::prompt` uses for the live per-turn system section.
    pub effective_skill_listing: Option<String>,
}

#[tauri::command]
pub async fn debug_session_skills_snapshot(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
) -> Result<SessionSkillsSnapshot, String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("session not found: {}", session_id))?;

    let runtime = session
        .runtime
        .read()
        .await
        .clone()
        .ok_or_else(|| format!("session runtime not initialized: {}", session_id))?;

    let agent_id = session.definition.id.clone();

    let def_skills = session.definition.skills_config.clone();
    let definition_present = def_skills.is_some();
    let (definition_enabled, definition_include, definition_exclude) = match &def_skills {
        Some(cfg) => (cfg.enabled, cfg.include.clone(), cfg.exclude.clone()),
        None => (None, Vec::new(), Vec::new()),
    };

    let resolved_skills_enabled = runtime.resolved.skills.enabled;
    let resolved_skills_disabled = runtime.resolved.skills.disabled.clone();

    let rt_skills = runtime.skills_config.clone();
    let runtime_skills_config_present = rt_skills.is_some();
    let (
        runtime_skills_config_enabled,
        runtime_skills_config_include,
        runtime_skills_config_exclude,
    ) = match &rt_skills {
        Some(cfg) => (cfg.enabled, cfg.include.clone(), cfg.exclude.clone()),
        None => (None, Vec::new(), Vec::new()),
    };

    // Mirror the per-turn merge in
    // `core/session/turn/processor/prompt.rs::build_dynamic_sections`:
    //   effective_disabled = resolved.skills.disabled.clone()
    //   if let Some(sc) = runtime.skills_config: effective_disabled.extend(sc.exclude.clone())
    let mut effective_set: BTreeSet<String> = resolved_skills_disabled.iter().cloned().collect();
    if let Some(ref cfg) = rt_skills {
        for entry in &cfg.exclude {
            effective_set.insert(entry.clone());
        }
    }
    let effective_per_turn_disabled: Vec<String> = effective_set.into_iter().collect();

    let effective_include_filter = match &rt_skills {
        Some(cfg) if !cfg.include.is_empty() => Some(cfg.include.clone()),
        _ => None,
    };
    let effective_skill_listing = build_effective_skill_listing(
        &runtime,
        &effective_per_turn_disabled,
        effective_include_filter.as_deref(),
    );

    Ok(SessionSkillsSnapshot {
        session_id: session_id.clone(),
        agent_id,

        definition_present,
        definition_enabled,
        definition_include,
        definition_exclude,

        resolved_skills_enabled,
        resolved_skills_disabled,

        runtime_skills_config_present,
        runtime_skills_config_enabled,
        runtime_skills_config_include,
        runtime_skills_config_exclude,

        effective_per_turn_disabled,
        effective_include_filter,
        effective_skill_listing,
    })
}
