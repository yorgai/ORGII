//! Agent-definition loader used during session runtime assembly.
//!
//! Reads the session's `agent_definition_id` from the persisted record,
//! then resolves the definition (builtin or user-defined) via the unified
//! resolver and returns its prompt-relevant payload (soul + def-id).
//!
//! `skills_config` is intentionally NOT returned here: it's threaded
//! through `UnifiedInitRequest` from the same `AgentDefinition` snapshot
//! that `ResolvedAgent::resolve` consumed, so the runtime's two parallel
//! skill caches (`resolved.skills` and `runtime.skills_config`) cannot
//! diverge. See `audit-skills-llm.spec.mjs` for the regression pin.
//!
//! Failures during read or resolve are logged and degrade to `None` so the
//! runtime can fall back to in-memory defaults — this mirrors the
//! behaviour `runtime_assemble::load_or_recover_definition` expects.

/// Load agent-definition payload for a session.
///
/// Returns `(soul_content, definition_id)`. Both are `Some` on the happy
/// path; any failure (missing record, missing `agent_definition_id`,
/// resolver error) returns the corresponding slot as `None` while emitting
/// a warning.
pub(super) fn load_agent_definition(session_id: &str) -> (Option<String>, Option<String>) {
    let record = match crate::session::persistence::get_session(session_id) {
        Ok(r) => r,
        Err(err) => {
            tracing::warn!("[init] Failed to read session {session_id} for agent def: {err}");
            None
        }
    };
    let def_id = record
        .as_ref()
        .and_then(|r| r.agent_definition_id.as_deref());

    let Some(def_id) = def_id else {
        return (None, None);
    };

    let store = crate::definitions::AgentDefinitionsStore::new();
    match crate::definitions::resolver::resolve_definition_by_id(def_id, Some(&store)) {
        Ok(def) => (def.soul_content, Some(def_id.to_string())),
        Err(err) => {
            tracing::warn!("[init] Failed to resolve agent definition '{def_id}': {err}");
            (None, Some(def_id.to_string()))
        }
    }
}
