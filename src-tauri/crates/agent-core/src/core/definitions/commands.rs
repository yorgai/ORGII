//! Tauri commands for agent definition and org CRUD operations.

use super::builtin::get_builtin_agents;
use super::orgs::{AgentOrgsStore, OrgDefinition};
use super::patch::AgentDefinitionPatch;
use super::schema::AgentDefinition;
use super::store::AgentDefinitionsStore;
use crate::foundation::security::CommandRiskRules;
use crate::integrations::patch::IntegrationsConfigPatch;
use crate::integrations::IntegrationsConfig;
use crate::session::prompt::cache::PromptCacheInvalidationReason;
use crate::state::AgentAppState;

// ── Agent Definition commands ──

/// Returns all agent definitions: builtin agents first, then user-created
/// agents. The user-only sibling `agent_definitions_list` was retired —
/// every consumer wants the unified builtin + user list, and a
/// "user-only" view can always be derived by filtering on
/// `AgentDefinition::built_in`.
#[tauri::command]
pub async fn agent_definitions_list_all(
    state: tauri::State<'_, AgentDefinitionsStore>,
) -> Result<Vec<AgentDefinition>, String> {
    let mut all = get_builtin_agents();
    let user_agents = state
        .agents
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;
    all.extend(user_agents.clone());
    Ok(all)
}

#[tauri::command]
pub async fn agent_definitions_add(
    state: tauri::State<'_, AgentDefinitionsStore>,
    agent_json: String,
) -> Result<String, String> {
    let mut agent: AgentDefinition =
        serde_json::from_str(&agent_json).map_err(|err| format!("Invalid agent JSON: {}", err))?;
    super::builtin::strip_forbidden_sub_agents(&mut agent);
    let id = agent.id.clone();

    let mut agents = state
        .agents
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;

    if agents.iter().any(|existing| existing.id == id) {
        return Err(format!("Agent with id '{}' already exists", id));
    }

    agents.push(agent);
    state.persist(&agents);
    Ok(id)
}

#[tauri::command]
pub async fn agent_definitions_update(
    state: tauri::State<'_, AgentDefinitionsStore>,
    app_state: tauri::State<'_, AgentAppState>,
    agent_json: String,
) -> Result<(), String> {
    let mut agent: AgentDefinition =
        serde_json::from_str(&agent_json).map_err(|err| format!("Invalid agent JSON: {}", err))?;
    super::builtin::strip_forbidden_sub_agents(&mut agent);
    let agent_id = agent.id.clone();

    {
        let mut agents = state
            .agents
            .lock()
            .map_err(|err| format!("Lock error: {}", err))?;

        let idx = agents
            .iter()
            .position(|existing| existing.id == agent.id)
            .ok_or_else(|| format!("Agent '{}' not found", agent.id))?;

        agents[idx] = agent;
        state.persist(&agents);
    }
    app_state
        .invalidate_prompt_caches_for_agent_definition(
            &agent_id,
            PromptCacheInvalidationReason::AgentDefinitionChanged,
        )
        .await;
    Ok(())
}

#[tauri::command]
pub async fn agent_definitions_remove(
    state: tauri::State<'_, AgentDefinitionsStore>,
    app_state: tauri::State<'_, AgentAppState>,
    agent_id: String,
) -> Result<bool, String> {
    let removed = {
        let mut agents = state
            .agents
            .lock()
            .map_err(|err| format!("Lock error: {}", err))?;

        let len_before = agents.len();
        agents.retain(|agent| agent.id != agent_id);
        let removed = agents.len() < len_before;

        if removed {
            state.persist(&agents);
        }
        removed
    };
    if removed {
        app_state
            .invalidate_prompt_caches_for_agent_definition(
                &agent_id,
                PromptCacheInvalidationReason::AgentDefinitionChanged,
            )
            .await;
    }
    Ok(removed)
}

// ── Org commands ──

#[tauri::command]
pub async fn agent_orgs_list(
    state: tauri::State<'_, AgentOrgsStore>,
) -> Result<Vec<OrgDefinition>, String> {
    let orgs = state
        .orgs
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;
    Ok(orgs.clone())
}

#[tauri::command]
pub async fn agent_orgs_add(
    state: tauri::State<'_, AgentOrgsStore>,
    org_json: String,
) -> Result<String, String> {
    let org: OrgDefinition =
        serde_json::from_str(&org_json).map_err(|err| format!("Invalid org JSON: {}", err))?;
    let id = org.id.clone();

    let mut orgs = state
        .orgs
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;

    if orgs.iter().any(|existing| existing.id == id) {
        return Err(format!("Org with id '{}' already exists", id));
    }

    orgs.push(org);
    state.persist(&orgs);
    Ok(id)
}

#[tauri::command]
pub async fn agent_orgs_update(
    state: tauri::State<'_, AgentOrgsStore>,
    org_json: String,
) -> Result<(), String> {
    let org: OrgDefinition =
        serde_json::from_str(&org_json).map_err(|err| format!("Invalid org JSON: {}", err))?;

    let mut orgs = state
        .orgs
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;

    let idx = orgs
        .iter()
        .position(|existing| existing.id == org.id)
        .ok_or_else(|| format!("Org '{}' not found", org.id))?;

    orgs[idx] = org;
    state.persist(&orgs);
    Ok(())
}

#[tauri::command]
pub async fn agent_orgs_remove(
    state: tauri::State<'_, AgentOrgsStore>,
    org_id: String,
) -> Result<bool, String> {
    let mut orgs = state
        .orgs
        .lock()
        .map_err(|err| format!("Lock error: {}", err))?;

    let len_before = orgs.len();
    orgs.retain(|org| org.id != org_id);
    let removed = orgs.len() < len_before;

    if removed {
        state.persist(&orgs);
    }
    Ok(removed)
}

/// One row in the Inbox flat chat list — a persisted agent-org run that
/// has anchored a coordinator session. The Inbox renders one row per
/// run (so a single org may have multiple chats), ordered by recent
/// activity. `org_id` is included so the frontend can join with its
/// already-loaded `agent_orgs_list` data to render the org name as a
/// sub-label without an extra round-trip per row.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxRunSummary {
    pub run_id: String,
    pub org_id: String,
    pub root_session_id: String,
    pub status: String,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// List every persisted run that has anchored a coordinator session,
/// across all orgs, ordered by `updated_at DESC`. The Inbox renders
/// the result as its flat chat list (one row per run).
///
/// `limit` caps the response at 200 rows. The current Inbox UI does
/// not paginate — orgs that build up thousands of historical runs
/// should re-introduce pagination here before lifting the cap.
#[tauri::command]
pub async fn agent_org_run_list(limit: Option<usize>) -> Result<Vec<InboxRunSummary>, String> {
    use crate::core::coordination::agent_org_runs::AgentOrgRunStore;
    const MAX_LIMIT: usize = 200;
    let effective_limit = limit.map(|n| n.min(MAX_LIMIT)).unwrap_or(MAX_LIMIT);
    let runs = AgentOrgRunStore::list_runs(effective_limit)?;
    for run in &runs {
        AgentOrgRunStore::reconcile_if_terminal(&run.id)?;
    }
    let runs = AgentOrgRunStore::list_runs(effective_limit)?;
    Ok(runs
        .into_iter()
        .filter_map(|run| {
            let root_session_id = run.root_session_id?;
            Some(InboxRunSummary {
                run_id: run.id,
                org_id: run.org_id,
                root_session_id,
                status: run.status.as_str().to_string(),
                summary: run.summary,
                created_at: run.created_at,
                updated_at: run.updated_at,
            })
        })
        .collect())
}
// ─────────────────────────────────────────────────────────────────────────────
// RPC contract §13 — Typed patch RPCs.
//
// The four commands below replace the retired blob-based
// `agent_get_config` / `agent_update_config` surface. Frontend consumers
// that need to read / mutate a single agent's configuration call
// `agent_def_get` / `agent_def_update_patch`; consumers that need
// app-level integrations (channels, plugins, web search, exec)
// call `integrations_get` / `integrations_update_patch`.
//
// Patch semantics: every field on both patch types is `Option<T>`. `None`
// leaves the existing value unchanged; `Some(value)` replaces the whole
// sub-struct. See `core::definitions::patch` and
// `integrations::patch` for the full rationale.
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_def_get(
    state: tauri::State<'_, AgentDefinitionsStore>,
    agent_id: String,
) -> Result<AgentDefinition, String> {
    state
        .get(&agent_id)
        .ok_or_else(|| format!("agent '{}' not found", agent_id))
}

#[tauri::command]
pub async fn agent_command_risk_rules_default() -> CommandRiskRules {
    CommandRiskRules::default()
}

#[tauri::command]
pub async fn agent_def_update_patch(
    state: tauri::State<'_, AgentDefinitionsStore>,
    app_state: tauri::State<'_, AgentAppState>,
    agent_id: String,
    patch: AgentDefinitionPatch,
) -> Result<AgentDefinition, String> {
    let updated = if super::builtin::is_builtin_agent(&agent_id) {
        let gated = patch.gate_for_builtin();
        state.update_with_overlay(&agent_id, |def| gated.apply(def))
    } else {
        state.update(&agent_id, |def| patch.apply(def))
    }?;
    app_state
        .invalidate_prompt_caches_for_agent_definition(
            &agent_id,
            PromptCacheInvalidationReason::AgentDefinitionChanged,
        )
        .await;
    Ok(updated)
}

/// Drop any user overlay on a `builtin:*` agent definition, reverting it
/// to the compiled-in default. Returns the resulting definition (the
/// freshly-seeded compiled-in builtin). No-op when no overlay exists;
/// returns an error for non-builtin ids.
#[tauri::command]
pub async fn agent_def_reset_builtin(
    state: tauri::State<'_, AgentDefinitionsStore>,
    app_state: tauri::State<'_, AgentAppState>,
    agent_id: String,
) -> Result<AgentDefinition, String> {
    state.reset_builtin(&agent_id)?;
    let definition = state
        .get(&agent_id)
        .ok_or_else(|| format!("builtin '{}' missing after reset", agent_id))?;
    app_state
        .invalidate_prompt_caches_for_agent_definition(
            &agent_id,
            PromptCacheInvalidationReason::AgentDefinitionChanged,
        )
        .await;
    Ok(definition)
}

#[tauri::command]
pub async fn integrations_get(
    state: tauri::State<'_, AgentAppState>,
) -> Result<IntegrationsConfig, String> {
    Ok(state.integrations.snapshot())
}

#[tauri::command]
pub async fn integrations_update_patch(
    state: tauri::State<'_, AgentAppState>,
    patch: IntegrationsConfigPatch,
) -> Result<IntegrationsConfig, String> {
    state
        .integrations
        .update(|cfg| -> Result<(), std::convert::Infallible> {
            patch.apply(cfg);
            Ok(())
        })
        .map_err(|err| format!("{}", err))
}
