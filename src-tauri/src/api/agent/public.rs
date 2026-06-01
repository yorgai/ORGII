//! Public (non-debug) agent REST endpoints.
//!
//! These are the stable, production-facing routes mounted under `/agent/*`.
//! Everything gated by `#[cfg(debug_assertions)]` lives in the sibling
//! `test/` module tree and is only wired into the router in dev builds.
//!
//! Production-call-path note: there is intentionally no `POST /agent/message`
//! one-shot endpoint here. Real session messaging goes through the
//! `agent_send_message` Tauri command (foreground) or the
//! `POST /agent/test/message` debug route (E2E). Both share the
//! `init::init_session` slow-path, so they pick up MCP wiring, plugin tools,
//! sub-agent overlays, capability gates, permission manager, and gateway
//! registry. A separate handcrafted `SessionRuntime { … }` here would
//! silently drift from that production wiring (different tool set,
//! different policy, no MCP) and used to live in this file before the
//! 2026-04-30 init-parity sweep retired it.

use axum::Json;
use serde::Serialize;

use super::dto;

/// Shape returned by `GET /agent/status`. Used as a coarse liveness +
/// configuration snapshot by the E2E harness; not consumed by the
/// frontend (the frontend reads runtime state through Tauri commands).
///
/// `integrations` carries the on-disk `IntegrationsConfig`, which is the
/// file backing the foreground `IntegrationsStore`. The shape is
/// camelCase to match the rest of the agent HTTP surface.
#[derive(Debug, Serialize)]
pub struct AgentStatusResponse {
    /// Always `"ok"` — the route handler does not crash on missing
    /// integrations / definitions, it falls back to defaults. The field
    /// exists so the harness can distinguish a 200 with a body from a
    /// 200 with no body / wrong shape after a future refactor.
    pub status: &'static str,
    pub model: String,
    pub workspace: String,
    pub integrations: agent_core::integrations::config::IntegrationsConfig,
}

/// GET /agent/status - Coarse status snapshot for the E2E harness.
///
/// Reports the OS-agent's `selected_model_id`, the personal workspace
/// path, and the on-disk `IntegrationsConfig`. The previous version
/// returned a `tools: Vec<String>` field with a hardcoded whitelist of
/// nine tool names that drifted from the live registry built by
/// `init::ensure_session_initialized` — that field was retired on
/// 2026-04-30 because every consumer (the channel E2E
/// `reset_policy_defaults` scenario) reads `integrations`, not `tools`.
pub async fn get_status() -> Json<AgentStatusResponse> {
    use agent_core::core::definitions::AgentDefinitionsStore;
    use agent_core::integrations::config::IntegrationsConfig;

    let store = AgentDefinitionsStore::new();
    let model = store
        .get(agent_core::definitions::builtin::OS_AGENT_ID)
        .and_then(|d| d.selected_model_id)
        .unwrap_or_default();

    // Same fall-back posture as `get_config`: the response type cannot
    // propagate `Result`, so a corrupt `~/.orgii/integrations.json`
    // surfaces in logs while the route still returns 200 with default
    // integration values. The foreground UI write path is gated
    // separately by `IntegrationsStore`'s `load_failure` latch.
    let integrations = match IntegrationsConfig::load_or_default() {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!(
                "[api] get_status: integrations.json failed to load — \
                 status response will carry default integration values \
                 until the file is fixed: {err}"
            );
            IntegrationsConfig::default()
        }
    };

    Json(AgentStatusResponse {
        status: "ok",
        model,
        workspace: app_paths::personal_workspace()
            .to_string_lossy()
            .into_owned(),
        integrations,
    })
}

/// GET /agent/config - Get resolved runtime view for the OS agent.
///
/// `ResolvedAgent::resolve` requires `selected_model_id`, which the OS agent
/// builtin does not set (it is user-configured at session time).  When
/// resolution fails with `MissingModel` we fall back to a *definition-only*
/// view that still carries the correct `learnings` and `embedding` fields —
/// the fields the UI actually reads from this endpoint.
pub async fn get_config() -> Json<dto::AgentRuntimeView> {
    use agent_core::core::definitions::{resolved::ResolvedAgent, AgentDefinitionsStore};
    use agent_core::core::session::overrides::SessionOverrides;

    // get_config returns a non-Result `AgentRuntimeView`, so a corrupt
    // `integrations.json` cannot be surfaced to the caller as a typed
    // error. Falling back to the in-memory default preserves the UI's
    // ability to render the agent definition (model id, learnings,
    // capabilities) but the integration-derived fields (embedding
    // provider/model, tool feature flags) will be defaults until the
    // user fixes the file. Log the parse error so the cause is
    // recoverable from logs instead of being completely silent.
    let integrations = match agent_core::integrations::config::IntegrationsConfig::load_or_default()
    {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!(
                "[api] get_config: integrations.json failed to load — UI will see default integration values until the file is fixed: {err}"
            );
            agent_core::integrations::config::IntegrationsConfig::default()
        }
    };
    let store = AgentDefinitionsStore::new();
    let def = store
        .get(agent_core::definitions::builtin::OS_AGENT_ID)
        .unwrap_or_else(agent_core::definitions::os_agent);

    match ResolvedAgent::resolve(&def, Some(&store), &SessionOverrides::default()) {
        Ok(resolved) => Json(dto::AgentRuntimeView::from((&resolved, &integrations))),
        Err(err) => {
            tracing::warn!(
                "[api] get_config: ResolvedAgent::resolve failed ({}); returning definition-only view",
                err
            );
            // Fall back to definition-level resolution (no model required) so
            // the UI still gets correct learnings / embedding values.
            let merged =
                agent_core::core::definitions::resolver::resolve_definition(&def, Some(&store))
                    .unwrap_or(def);
            Json(dto::AgentRuntimeView::from_definition(
                &merged,
                &integrations,
            ))
        }
    }
}

/// GET /agent/health - Liveness probe.
pub async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}
