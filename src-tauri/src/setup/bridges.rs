use crate::agent_sessions;

/// Wire the IoC slots `agent_core::bus::event_pipeline_bridge` uses to drive
/// the live `EventStore` pipeline (push, notify, write-through stamps,
/// pin/unpin, streaming flush). Registered once at startup so `agent_core`
/// never has to depend on `agent_sessions::event_pipeline::commands`.
pub(crate) fn register_event_pipeline_bridge() {
    agent_sessions::event_pipeline::agent_core_bridge::register();
}

/// Wire the IoC slot `agent_core::foundation::db_bridge` uses to open
/// `rusqlite::Connection`s for memory, consolidation, reflection, and
/// learnings persistence. Registered once at startup so `agent_core`
/// never has to depend on `session_persistence::get_connection`.
pub(crate) fn register_persistence_bridge() {
    session_persistence::agent_core_bridge::register();
}

/// Wire the `core_types::session_event::EXTRACTOR` slot to the real
/// `event_pipeline::extractors::extract_event_data` implementation.
/// Registered once at startup so `SessionEvent::recompute_extracted`
/// keeps producing typed rendering envelopes after the type was lifted
/// into `core_types`. Without this, `recompute_extracted` is a silent
/// no-op and frontend blocks would render against raw `args`/`result`
/// JSON.
pub(crate) fn register_session_event_extractor() {
    agent_sessions::event_pipeline::extractors::register_extractor_hook();
}

/// Wire `project_management::lineage::git_bridge` to the real
/// `git2`-backed `get_commit_diff`. `commit_tracker` matches commit
/// hunks against `node_provenance` and needs the diff at every commit;
/// without this register, the slot panics with a clear message.
pub(crate) fn register_lineage_git_bridge() {
    git_api::lineage_bridge::register();
}

/// Wire the `agent_core::foundation::session_bridge::launch_cli_agent`
/// slot to the real `cli_agent_create` + `cli_agent_run` adapter in
/// `agent_sessions::cli::agent_core_bridge`. Paired with
/// `register_persistence_bridge`, which fills the session_bridge's
/// token-usage slot from the same wire crate.
pub(crate) fn register_cli_launch_bridge() {
    agent_sessions::cli::agent_core_bridge::register();
}
