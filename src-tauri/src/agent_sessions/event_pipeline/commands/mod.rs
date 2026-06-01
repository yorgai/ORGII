//! Tauri commands for the Rust EventStore
//!
//! Thin wrappers around per-session `EventStore` instances and derived computations.
//! Each command acquires the `Mutex`, resolves the target session (explicit
//! `session_id` argument or the active session), performs the operation, and
//! returns.
//!
//! Notification scheduling (100ms batched `es:changed` events) is handled by
//! a background tokio task spawned at app startup. Each snapshot is tagged with
//! the `sessionId` it describes so the frontend can route to per-session
//! listeners.

mod analytics;
mod batch_update;
mod cache_bridge;
mod extractors;
mod history;
mod ingestion;
mod pagination;
mod search;
mod session_manager;
mod snapshot;
mod store_commands;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const STREAMING_SIMULATOR_UPSERT_LIMIT: usize = 48;

use session_persistence::CachedEvent;

use crate::agent_sessions::event_pipeline::derived::compute_derived;
use crate::agent_sessions::event_pipeline::payload_compaction::compact_event_for_snapshot;
use crate::agent_sessions::event_pipeline::session_manager::SessionStoreManager;
use crate::agent_sessions::event_pipeline::store::EventStore;
use crate::agent_sessions::event_pipeline::types::{
    SessionEvent, SnapshotDelta, StreamingSnapshot,
};

// ============================================================================
// Managed State
// ============================================================================

/// Multi-session EventStore state.
///
/// Holds one `EventStore` per session id. The "active" session is tracked by
/// `SessionStoreManager` and is the default target when a command is invoked
/// without an explicit `session_id` argument. Any session (active or not) can
/// be read, written, and broadcast independently — this is what enables
/// SubagentBlock chat-in-chat and cross-session replay.
pub struct EventStoreState {
    /// All live per-session stores. Populated lazily: the first write or read
    /// for a session materializes its `EventStore`.
    pub stores: Mutex<HashMap<String, EventStore>>,
    pub session_manager: Mutex<SessionStoreManager>,
    /// Tracks which sessions already have a batched notification pending.
    pub notify_pending: Mutex<HashSet<String>>,
}

impl Default for EventStoreState {
    fn default() -> Self {
        Self::new()
    }
}

impl EventStoreState {
    pub fn new() -> Self {
        Self {
            stores: Mutex::new(HashMap::new()),
            session_manager: Mutex::new(SessionStoreManager::new()),
            notify_pending: Mutex::new(HashSet::new()),
        }
    }

    /// Resolve the target session id for a command.
    ///
    /// - If `explicit` is `Some`, returns it unchanged.
    /// - Otherwise falls back to the active session from `SessionStoreManager`.
    /// - Returns an error string when neither is available (mis-use by caller).
    pub fn resolve_session_id(&self, explicit: Option<String>) -> Result<String, String> {
        if let Some(sid) = explicit {
            return Ok(sid);
        }
        let mgr = self
            .session_manager
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        mgr.active_id()
            .map(|s| s.to_string())
            .ok_or_else(|| "no active session and no explicit sessionId provided".to_string())
    }

    /// Run a closure against the target session's store (creating it if absent).
    ///
    /// Automatically registers the session in `SessionStoreManager` so it
    /// participates in LRU eviction and `active_id` resolution.
    pub fn with_store_mut<F, R>(&self, session_id: &str, f: F) -> R
    where
        F: FnOnce(&mut EventStore) -> R,
    {
        {
            let mut mgr = self
                .session_manager
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            mgr.register(session_id);
        }
        let mut stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        let store = stores.entry(session_id.to_string()).or_default();
        f(store)
    }

    /// Run a closure against the target session's store if it exists.
    /// Returns `None` without materializing a store for unknown sessions.
    pub fn with_store_opt<F, R>(&self, session_id: &str, f: F) -> Option<R>
    where
        F: FnOnce(&EventStore) -> R,
    {
        let stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        stores.get(session_id).map(f)
    }
}

// ============================================================================
// Notification Helpers
// ============================================================================

const NOTIFY_EVENT_NAME: &str = "es:changed";
const STREAMING_BATCH_MS: u64 = 33;
const ACTION_TYPE_TOOL_CALL: &str = "tool_call";
const ACTION_TYPE_TOOL_RESULT: &str = "tool_result";

/// Tauri `es:changed` payload wrapper. The `sessionId` is always present so
/// frontend listeners can route to the correct per-session subscriber.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEnvelope<T: Serialize> {
    session_id: String,
    #[serde(flatten)]
    snapshot: T,
}

/// Schedule a frontend notification for `session_id`. During streaming,
/// batches at `STREAMING_BATCH_MS` intervals per-session.
pub(crate) fn schedule_notify(app: &AppHandle, state: &EventStoreState, session_id: &str) {
    let streaming = state
        .with_store_opt(session_id, EventStore::is_streaming)
        .unwrap_or(false);

    if streaming {
        let mut pending = state
            .notify_pending
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if !pending.insert(session_id.to_string()) {
            return;
        }
        let app_handle = app.clone();
        let sid = session_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(STREAMING_BATCH_MS)).await;
            let state = app_handle.state::<EventStoreState>();
            {
                let mut pending = state
                    .notify_pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                pending.remove(&sid);
            }
            emit_snapshot(&app_handle, &state, &sid);
        });
    } else {
        emit_snapshot(app, state, session_id);
    }
}

fn emit_snapshot(app: &AppHandle, state: &EventStoreState, session_id: &str) {
    use crate::agent_sessions::event_pipeline::derived::{
        build_simulator_preview_indexes, is_visible_in_chat, is_visible_in_messages,
        is_visible_in_simulator, sort_if_unsorted, sort_simulator_events,
    };
    use crate::agent_sessions::event_pipeline::types::EventDisplayStatus;

    let mut stores = state.stores.lock().unwrap_or_else(|e| e.into_inner());
    let Some(store) = stores.get_mut(session_id) else {
        return;
    };
    if store.is_streaming() {
        let events = store.events();
        let mut chat_events = Vec::with_capacity(events.len() / 2);
        let mut sorted_simulator_events = Vec::with_capacity(events.len() / 2);
        let mut has_running_event = false;

        for e in events.iter() {
            if e.display_status == EventDisplayStatus::Running {
                has_running_event = true;
            }
            if is_visible_in_chat(e) {
                chat_events.push(compact_event_for_snapshot(e));
            }
            if is_visible_in_simulator(e) {
                sorted_simulator_events.push(compact_event_for_snapshot(e));
            }
        }

        sort_if_unsorted(&mut chat_events);
        sort_simulator_events(&mut sorted_simulator_events);
        let simulator_upsert_start = sorted_simulator_events
            .len()
            .saturating_sub(STREAMING_SIMULATOR_UPSERT_LIMIT);
        let simulator_event_upserts = sorted_simulator_events[simulator_upsert_start..].to_vec();
        let preview_indexes = build_simulator_preview_indexes(&sorted_simulator_events);

        let snapshot = StreamingSnapshot {
            version: store.version(),
            event_count: store.event_count(),
            chat_events,
            sorted_simulator_events: Vec::new(),
            simulator_event_upserts,
            sorted_simulator_event_ids: preview_indexes.sorted_simulator_event_ids,
            event_preview_by_id: preview_indexes.event_preview_by_id,
            created_at_by_id: preview_indexes.created_at_by_id,
            thread_id_by_id: preview_indexes.thread_id_by_id,
            function_name_by_id: preview_indexes.function_name_by_id,
            display_status_by_id: preview_indexes.display_status_by_id,
            display_variant_by_id: preview_indexes.display_variant_by_id,
            last_event: store.last_event().map(compact_event_for_snapshot),
            streaming: true,
            has_running_event,
        };
        let envelope = SnapshotEnvelope {
            session_id: session_id.to_string(),
            snapshot,
        };
        app.emit(NOTIFY_EVENT_NAME, &envelope).ok();
        return;
    }

    if store.should_emit_full_snapshot() {
        let derived = compute_derived(store.events(), store.version());
        store.mark_full_snapshot_emitted();
        let envelope = SnapshotEnvelope {
            session_id: session_id.to_string(),
            snapshot: derived,
        };
        app.emit(NOTIFY_EVENT_NAME, &envelope).ok();
        return;
    }

    let version = store.version();
    let event_count = store.event_count();
    let (base_version, changed_ids, removed_ids) = store.take_delta_tracking();
    let events = store.events();
    let changed_id_set = changed_ids.iter().collect::<std::collections::HashSet<_>>();
    let upserts = events
        .iter()
        .filter(|event| changed_id_set.contains(&event.id))
        .map(compact_event_for_snapshot)
        .collect::<Vec<_>>();
    let event_ids = events
        .iter()
        .map(|event| event.id.clone())
        .collect::<Vec<_>>();
    let mut chat_event_ids = Vec::with_capacity(events.len() / 2);
    let mut messages_event_ids = Vec::with_capacity(events.len() / 2);
    let mut simulator_preview_events = Vec::with_capacity(events.len() / 2);
    let mut has_running_event = false;
    for event in events {
        if event.display_status == EventDisplayStatus::Running {
            has_running_event = true;
        }
        if is_visible_in_chat(event) {
            chat_event_ids.push(event.id.clone());
        }
        if is_visible_in_messages(event) {
            messages_event_ids.push(event.id.clone());
        }
        if is_visible_in_simulator(event) {
            simulator_preview_events.push(compact_event_for_snapshot(event));
        }
    }
    sort_simulator_events(&mut simulator_preview_events);
    let preview_indexes = build_simulator_preview_indexes(&simulator_preview_events);
    let chat_event_count = chat_event_ids.len();
    let snapshot = SnapshotDelta {
        version,
        base_version,
        event_count,
        upserts,
        removed_ids,
        event_ids,
        chat_event_ids,
        messages_event_ids,
        sorted_simulator_event_ids: preview_indexes.sorted_simulator_event_ids,
        event_preview_by_id: preview_indexes.event_preview_by_id,
        created_at_by_id: preview_indexes.created_at_by_id,
        thread_id_by_id: preview_indexes.thread_id_by_id,
        function_name_by_id: preview_indexes.function_name_by_id,
        display_status_by_id: preview_indexes.display_status_by_id,
        display_variant_by_id: preview_indexes.display_variant_by_id,
        last_event_id: store.last_event().map(|event| event.id.clone()),
        chat_event_count,
        has_running_event,
        snapshot_delta: true,
    };
    let envelope = SnapshotEnvelope {
        session_id: session_id.to_string(),
        snapshot,
    };
    app.emit(NOTIFY_EVENT_NAME, &envelope).ok();
}

// ============================================================================
// SQLite Write-Through with Retry
// ============================================================================

/// Maximum retry attempts for critical write-throughs (subagent linkage stamps).
const CRITICAL_WRITE_MAX_RETRIES: u32 = 5;
/// Maximum retry attempts for bulk event writes.
pub(super) const BULK_WRITE_MAX_RETRIES: u32 = 3;
/// Base delay between retries (doubled each attempt).
const RETRY_BASE_DELAY_MS: u64 = 50;

/// Synchronous retry loop for `save_events`.
///
/// SQLite WAL mode allows concurrent readers but only one writer at a time.
/// During high-throughput subagent execution (many tool calls per second across
/// parent + child sessions), concurrent writes pile up and the 5s
/// `busy_timeout` can be exhausted. Without retry, critical stamps like
/// `subagentSessionId` are lost from disk and the UI breaks on session reload.
///
/// Must be called from a blocking-safe context (inside `spawn_blocking` or
/// a sync function that's OK to sleep briefly).
pub(crate) fn save_events_retry(
    label: &str,
    sid: &str,
    events: &[CachedEvent],
    max_retries: u32,
) -> Result<(), String> {
    use session_persistence as sqlite_cache;

    for attempt in 0..max_retries {
        match sqlite_cache::save_events(sid, events) {
            Ok(_) => return Ok(()),
            Err(err) if attempt + 1 < max_retries => {
                let delay_ms = RETRY_BASE_DELAY_MS * (1 << attempt);
                let attempt_num = attempt + 1;
                tracing::debug!(
                    "[event-pipeline] {label} write-through attempt {attempt_num}/{max_retries} \
                     failed for {sid}: {err} — retrying in {delay_ms}ms"
                );
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }
            Err(err) => {
                let message = format!(
                    "[event-pipeline] {label} write-through failed for {sid} \
                     after {max_retries} attempts: {err}"
                );
                tracing::warn!("{message}");
                return Err(message);
            }
        }
    }

    Err(format!(
        "[event-pipeline] {label} write-through failed for {sid}: no attempts were run"
    ))
}

/// Fire-and-forget variant: spawns `save_events_retry` onto `spawn_blocking`.
pub(super) fn persist_events_with_retry(
    label: &'static str,
    sid: String,
    events: Vec<CachedEvent>,
    max_retries: u32,
) {
    tokio::task::spawn_blocking(move || {
        let _ = save_events_retry(label, &sid, &events, max_retries);
    });
}

/// Push live events into any session's store from Rust-side code (no Tauri
/// command round-trip). Callers: `UnifiedEventHandler` (parent) and
/// `UnifiedSubagentHandler` (child) — both funnel every SessionEvent they
/// produce through this single write path.
///
/// After merging into the in-memory store, non-placeholder events are
/// persisted to the `events` SQLite table via `spawn_blocking` (fire-and-
/// forget). This write-through means interrupted sessions keep their
/// history even if `broadcast_complete` / the 30s frontend timer never run.
pub fn push_events_to_session(
    app: &AppHandle,
    state: &EventStoreState,
    session_id: &str,
    events: Vec<SessionEvent>,
) {
    if events.is_empty() {
        return;
    }

    let result_call_ids: HashSet<String> = events
        .iter()
        .filter(|event| event.action_type == ACTION_TYPE_TOOL_RESULT)
        .filter_map(|event| event.call_id.clone())
        .collect();

    let mut persistable: Vec<_> = events
        .iter()
        .filter(|e| !cache_bridge::is_ts_placeholder_id(&e.id))
        .map(|e| cache_bridge::session_event_to_cached_event(e))
        .collect();

    let merged_tool_calls = state.with_store_mut(session_id, |store| {
        store.merge_events(events);
        if result_call_ids.is_empty() {
            return Vec::new();
        }
        store
            .events()
            .iter()
            .filter(|event| {
                event.action_type == ACTION_TYPE_TOOL_CALL
                    && event
                        .call_id
                        .as_ref()
                        .is_some_and(|call_id| result_call_ids.contains(call_id))
            })
            .cloned()
            .collect::<Vec<_>>()
    });

    for event in merged_tool_calls {
        if cache_bridge::is_ts_placeholder_id(&event.id) {
            continue;
        }
        persistable.push(cache_bridge::session_event_to_cached_event(&event));
    }

    schedule_notify(app, state, session_id);

    if !persistable.is_empty() {
        persist_events_with_retry(
            "push_events",
            session_id.to_string(),
            persistable,
            BULK_WRITE_MAX_RETRIES,
        );
    }
}

/// Merge `merge_args` into the last still-running spawning tool_call event
/// (matching any of `function_names`) and persist the updated event to SQLite.
///
/// This is the write-through counterpart of `EventStore::update_spawning_tool_args`.
/// In-memory patches that are never written back (e.g. stamping
/// `subagentSessionId` onto the parent's `agent` tool_call event at spawn time)
/// would otherwise be lost on session reload: the SQLite copy still has the
/// pre-patch args, so re-opened sessions would show subagent blocks with no
/// child-session trajectory. Callers that need the patch to survive reload
/// (subagent linkage, elapsed-time stamping) should use this helper instead
/// of calling `update_spawning_tool_args` directly.
///
/// Returns the event id of the patched event when one was found.
pub fn update_spawning_tool_args_with_persist(
    app: &AppHandle,
    state: &EventStoreState,
    session_id: &str,
    function_names: &[&str],
    merge_args: serde_json::Value,
) -> Option<String> {
    let updated = state.with_store_mut(session_id, |store| {
        let id = store.update_spawning_tool_args(function_names, merge_args)?;
        store.get_by_id(&id).cloned().map(|event| (id, event))
    });

    let (event_id, event) = updated?;

    schedule_notify(app, state, session_id);

    if !cache_bridge::is_ts_placeholder_id(&event.id) {
        let cached = cache_bridge::session_event_to_cached_event(&event);
        persist_events_with_retry(
            "spawning-tool",
            session_id.to_string(),
            vec![cached],
            CRITICAL_WRITE_MAX_RETRIES,
        );
    }

    Some(event_id)
}

/// Like `update_spawning_tool_args_with_persist` but targets a specific
/// tool_call event by its LLM-assigned `call_id` instead of the ambiguous
/// "last running spawning tool" heuristic.
///
/// Required for parallel `background: true` subagent launches so each
/// handler stamps its own parent event.
pub fn update_tool_args_by_call_id_with_persist(
    app: &AppHandle,
    state: &EventStoreState,
    session_id: &str,
    call_id: &str,
    merge_args: serde_json::Value,
) -> Option<String> {
    let updated = state.with_store_mut(session_id, |store| {
        let id = store.update_tool_args_by_call_id(call_id, merge_args)?;
        store.get_by_id(&id).cloned().map(|event| (id, event))
    });

    let (event_id, event) = updated?;

    schedule_notify(app, state, session_id);

    if !cache_bridge::is_ts_placeholder_id(&event.id) {
        let cached = cache_bridge::session_event_to_cached_event(&event);
        persist_events_with_retry(
            "call-id",
            session_id.to_string(),
            vec![cached],
            CRITICAL_WRITE_MAX_RETRIES,
        );
    }

    Some(event_id)
}

// ============================================================================
// Re-exports
//
// Re-export all Tauri commands from submodules. Using `pub use *` ensures the
// `#[tauri::command]` macro-generated `__cmd__` functions are also exported.
// ============================================================================

// Store commands
pub use store_commands::*;

// Session manager commands
pub use session_manager::*;

// Snapshot commands
pub use snapshot::*;

// Cache bridge commands
pub use cache_bridge::*;

// Analytics commands
pub use analytics::*;

// Pagination commands
pub use pagination::*;

// Batch update commands
pub use batch_update::*;

// Ingestion commands
pub use ingestion::*;

// Extractor commands
pub use extractors::*;

// Search commands
pub use search::*;

// History commands
pub use history::*;
