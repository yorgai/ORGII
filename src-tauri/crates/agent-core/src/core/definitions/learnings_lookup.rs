//! Background-safe lookup for `AgentLearningsConfig`.
//!
//! Background subsystems (reflection, active-learning, consolidation) only
//! need to know the per-agent learnings policy — they do **not** need a
//! resolved model id (they reuse the session's recorded model and account).
//! Calling `ResolvedAgent::resolve()` from those subsystems was forcing
//! agents to declare `selected_model_id` purely to read three boolean
//! flags, which broke `builtin:sde` (see Documentation/Agent/learnings-decoupling--0424.md).
//!
//! This helper:
//! - Loads the agent definition by id.
//! - Walks `inherits_from` via [`super::resolver::resolve_definition`]
//!   (which does **not** require `selected_model_id`).
//! - Returns the per-agent [`super::schema::AgentLearningsConfig`] with
//!   inheritance applied, falling back to `Default` when the agent (or
//!   its inheritance chain) does not specify one.
//!
//! Falls back to `AgentLearningsConfig::default()` for unknown agent ids
//! so callers may continue without crashing — this matches the historic
//! behaviour of the consolidation entry point and keeps the failure mode
//! explicit at the call site (the caller decides whether `enabled = true`
//! by default is the right thing to do for them).

use super::resolver::resolve_definition;
use super::schema::AgentLearningsConfig;
use super::store::AgentDefinitionsStore;

/// Resolve the [`AgentLearningsConfig`] for `agent_id`. Never fails on
/// missing `selected_model_id` — that is a runtime-session concern and
/// has no bearing on whether learnings should run.
pub fn resolve_learnings_for(agent_id: &str) -> AgentLearningsConfig {
    let store = AgentDefinitionsStore::new();
    let Some(def) = store.get(agent_id) else {
        return AgentLearningsConfig::default();
    };
    match resolve_definition(&def, Some(&store)) {
        Ok(merged) => merged.learnings.unwrap_or_default(),
        Err(err) => {
            // Inheritance resolution failed (e.g. broken `inherits_from`
            // chain). Fall back to the un-inherited config so background
            // subsystems can still run, but log so the broken chain is
            // diagnosable rather than silently producing different
            // learnings policies than the resolved-agent path.
            tracing::warn!(
                agent_id = %agent_id,
                error = %err,
                "[learnings_lookup] inheritance resolution failed; using un-inherited learnings config"
            );
            def.learnings.unwrap_or_default()
        }
    }
}
