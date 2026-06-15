//! Session-specific SQLite persistence (event cache, file
//! changes, token usage) on top of the shared `database::db` connection.
//!
//! ## Surface
//! - `agent_core_bridge::register()` — install concrete impls into
//!   `agent_core::foundation::{db_bridge, session_bridge}` so memory,
//!   consolidation, reflection, and token-usage paths can persist state
//!   without taking a back-edge on this crate.
//! - `commands::*` — ~23 `#[tauri::command]`s, re-registered from
//!   `app::commands::handler_list.inc` via the bare `session_persistence::…`
//!   path.
//!
//! ## Database location
//! `~/.orgii/sessions.db` (managed by `database::db`). FTS5 is used for
//! full-text event search; sequence numbers gate edit / truncate flows.
//!
//! ## Layering
//! Pure leaf — no back-edges into `app`. Depends only on `agent_core`
//! (for `foundation::{db_bridge, session_bridge}` slot registration and
//! `tools::names` constants) and `database` (for the connection pool).

pub mod agent_core_bridge;
pub mod commands;
mod connection;
mod crud;
mod editing;
pub(crate) mod schema;
mod sequence;
pub mod token_usage;
mod turn_index;
mod turn_index_debounce;
pub mod turn_intents;
mod turn_window;
mod types;

pub use turn_index::{
    ensure_turn_index_fresh, load_turn_index, rebuild_turn_index, CachedTurnSummary,
};
pub use turn_window::{
    load_initial_turn_window, load_turn_body_window, CachedInitialTurnWindow, CachedTurnBodyWindow,
};
pub use types::{
    CacheStats, CachedEvent, CachedSession, CrossSessionSearchHit, SearchResult, SessionMetadata,
    TruncateResult,
};

// Re-export connection for legacy callers in this crate; new code should
// use `database::db::get_connection` directly.
pub use connection::get_connection;

// Re-export schema init for `database::db` boot-time table setup.
pub use schema::init_session_tables;

pub use crud::{
    clear_old_sessions, delete_session, find_awaiting_user_events_by_function, get_all_sessions,
    get_cache_stats, get_event, get_session_metadata, load_events, load_session, save_events,
    save_session, search_all_sessions, search_events, update_session_specs,
};
pub use editing::{clear_session_history, delete_event, truncate_after_event, update_event};

// Tauri commands — registered in `app::commands::handler_list.inc` as
// `session_persistence::cache_*` (formerly `session::cache::cache_*`).
pub use commands::{
    cache_clear_old_sessions, cache_clear_session_history, cache_delete_event,
    cache_delete_session, cache_get_all_sessions, cache_get_event, cache_get_session_diff,
    cache_get_session_metadata, cache_get_stats, cache_load_events, cache_load_session,
    cache_load_turn_index, cache_save_events, cache_save_session, cache_search_all_sessions,
    cache_search_events, cache_truncate_after_event, cache_update_event, cache_update_session_specs,
    get_session_token_usage_records,
};
