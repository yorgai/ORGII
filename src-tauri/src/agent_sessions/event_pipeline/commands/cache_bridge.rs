//! SQLite Bridge Commands
//!
//! Load/save events from SQLite cache with SessionEvent <-> CachedEvent conversion.

use dev_record::cursor::history::CURSORIDE_SESSION_PREFIX;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::agent_sessions::event_pipeline::payload_compaction::{
    load_event_payload_body, EventPayloadBody,
};
use crate::agent_sessions::event_pipeline::types::SessionEvent;
use session_persistence as sqlite_cache;

use super::{
    save_events_retry, schedule_notify, EventStoreState, BULK_WRITE_MAX_RETRIES,
    event_conversion::{
        backfill_subagent_links, backfill_tool_inputs_from_messages, cached_event_to_session_event,
        dedup_by_call_id, is_synthetic_persistence_artifact, session_event_to_cached_event,
    },
};

fn is_cursor_ide_session_id(session_id: &str) -> bool {
    session_id.starts_with(CURSORIDE_SESSION_PREFIX)
}

// ============================================================================
// SQLite Bridge Commands
// ============================================================================

/// Load events from SQLite cache into the target session's store.
///
/// If the in-memory store already has events (e.g. a live streaming child
/// session), the cache load is skipped to avoid overwriting live data.
/// Returns the current event count (from memory or freshly loaded cache).
#[tauri::command]
pub async fn es_load_from_cache(
    app: AppHandle,
    state: State<'_, EventStoreState>,
    session_id: String,
) -> Result<usize, String> {
    let existing_count = state
        .with_store_opt(&session_id, |store| store.events().len())
        .unwrap_or(0);
    if existing_count > 0 {
        schedule_notify(&app, &state, &session_id);
        return Ok(existing_count);
    }

    let load_sid = session_id.clone();
    let cached = tokio::task::spawn_blocking(move || sqlite_cache::load_events(&load_sid))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let events: Vec<SessionEvent> = cached
        .into_iter()
        .map(|ce| cached_event_to_session_event(&ce))
        .collect();
    let mut events = dedup_by_call_id(events);
    backfill_tool_inputs_from_messages(&session_id, &mut events);
    backfill_subagent_links(&session_id, &mut events);
    let count = events.len();
    if count > 0 {
        state.with_store_mut(&session_id, |store| {
            store.set(events);
            store.repair_subagent_links();
            // Cancel any orphan interactive tool calls that are still
            // AwaitingUser. When the Rust process restarts the QuestionManager
            // loses its in-memory state, so these events would be stuck: the
            // AskQuestionCard would render but clicking Submit would fail.
            let cancelled = store.cancel_orphan_interactive_events();
            if !cancelled.is_empty() {
                tracing::info!(
                    "[cache_bridge] cancelled {} orphan interactive event(s) for session {}: {:?}",
                    cancelled.len(),
                    session_id,
                    cancelled,
                );
            }
        });
    }
    schedule_notify(&app, &state, &session_id);
    Ok(count)
}

/// Save a session's in-memory events to SQLite cache.
#[tauri::command]
pub async fn es_save_to_cache(
    state: State<'_, EventStoreState>,
    session_id: String,
) -> Result<usize, String> {
    if is_cursor_ide_session_id(&session_id) {
        return Ok(0);
    }

    let events = state
        .with_store_opt(&session_id, |store| store.events().to_vec())
        .unwrap_or_default();
    let cached: Vec<sqlite_cache::CachedEvent> = events
        .iter()
        .filter(|e| !is_synthetic_persistence_artifact(e))
        .map(session_event_to_cached_event)
        .collect();
    let count = cached.len();
    let save_sid = session_id.clone();
    let save_result = tokio::task::spawn_blocking(move || {
        save_events_retry(
            "es_save_to_cache",
            &save_sid,
            &cached,
            BULK_WRITE_MAX_RETRIES,
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Err(err) = save_result {
        tracing::warn!(
            "[event-pipeline] best-effort es_save_to_cache failed for {session_id}: {err}"
        );
        return Ok(0);
    }

    Ok(count)
}

// ============================================================================
// Direct Cache Commands (SessionEvent-based)
//
// These commands accept/return `SessionEvent` directly, performing the
// SessionEvent <-> CachedEvent conversion in Rust. This eliminates the
// JS-side conversion overhead that existed in sqliteCache.ts.
// ============================================================================

/// Search result containing a SessionEvent instead of CachedEvent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventSearchResult {
    pub event: SessionEvent,
    pub rank: f64,
    pub snippet: String,
}

/// Save SessionEvents directly to SQLite cache (conversion happens in Rust).
#[tauri::command]
pub async fn cache_save_session_events(
    session_id: String,
    events: Vec<SessionEvent>,
) -> Result<usize, String> {
    if is_cursor_ide_session_id(&session_id) {
        return Ok(0);
    }

    let cached: Vec<sqlite_cache::CachedEvent> = events
        .iter()
        .filter(|e| !is_synthetic_persistence_artifact(e))
        .map(session_event_to_cached_event)
        .collect();
    let count = cached.len();
    tokio::task::spawn_blocking(move || sqlite_cache::save_events(&session_id, &cached))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Load SessionEvents directly from SQLite cache (conversion happens in Rust).
#[tauri::command]
pub async fn cache_load_session_events(session_id: String) -> Result<Vec<SessionEvent>, String> {
    log::debug!("[cache_bridge] cache_load_session_events called for session_id={session_id}");
    let sid = session_id.clone();
    let cached = tokio::task::spawn_blocking(move || sqlite_cache::load_events(&sid))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let events: Vec<SessionEvent> = cached.iter().map(cached_event_to_session_event).collect();
    let mut events = dedup_by_call_id(events);
    backfill_tool_inputs_from_messages(&session_id, &mut events);
    backfill_subagent_links(&session_id, &mut events);
    Ok(events)
}

/// Search events via FTS5, returning SessionEvents directly.
#[tauri::command]
pub async fn cache_search_session_events(
    session_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SessionEventSearchResult>, String> {
    let results = tokio::task::spawn_blocking(move || {
        sqlite_cache::search_events(&session_id, &query, limit.unwrap_or(50))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(results
        .iter()
        .map(|r| SessionEventSearchResult {
            event: cached_event_to_session_event(&r.event),
            rank: r.rank,
            snippet: r.snippet.clone(),
        })
        .collect())
}

/// Update a single event in cache, accepting SessionEvent directly.
#[tauri::command]
pub async fn cache_update_session_event(
    session_id: String,
    event: SessionEvent,
) -> Result<bool, String> {
    // Silently drop updates targeting TS-side per-delta placeholders — they
    // must not reach SQLite (see `is_ts_placeholder_id` docs).
    if is_synthetic_persistence_artifact(&event) {
        return Ok(false);
    }
    let cached = session_event_to_cached_event(&event);
    tokio::task::spawn_blocking(move || sqlite_cache::update_event(&session_id, &cached))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Get a single event by ID, returning SessionEvent directly.
#[tauri::command]
pub async fn cache_get_session_event(
    session_id: String,
    event_id: String,
) -> Result<Option<SessionEvent>, String> {
    let cached =
        tokio::task::spawn_blocking(move || sqlite_cache::get_event(&session_id, &event_id))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    Ok(cached.map(|c| cached_event_to_session_event(&c)))
}

#[tauri::command]
pub async fn cache_load_event_payload(
    state: State<'_, EventStoreState>,
    session_id: String,
    event_id: String,
    field_path: String,
) -> Result<Option<EventPayloadBody>, String> {
    if let Some(Some(body)) = state.with_store_opt(&session_id, |store| {
        store
            .get_by_id(&event_id)
            .and_then(|event| load_event_payload_body(event, &field_path))
    }) {
        return Ok(Some(body));
    }

    let cached_session_id = session_id.clone();
    let cached_event_id = event_id.clone();
    let cached = tokio::task::spawn_blocking(move || {
        sqlite_cache::get_event(&cached_session_id, &cached_event_id)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    let Some(cached) = cached else {
        return Ok(None);
    };
    let event = cached_event_to_session_event(&cached);
    Ok(load_event_payload_body(&event, &field_path))
}

/// Full session payload: events + specs_json + timeRange.
///
/// Used by `cache_save_full_session` and `cache_load_full_session` to transfer
/// all data needed by the Simulator engine in one round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSessionPayload {
    pub session_id: String,
    pub events: Vec<SessionEvent>,
    pub specs_json: Option<String>,
    pub time_range_start: Option<String>,
    pub time_range_end: Option<String>,
}

/// Save a full session (events + specs + timeRange) in one call.
///
/// Replaces all existing events. Preferred over `cache_save_session_events`
/// when the caller also has specs/timeRange to persist.
#[tauri::command]
pub async fn cache_save_full_session(payload: FullSessionPayload) -> Result<(), String> {
    if is_cursor_ide_session_id(&payload.session_id) {
        return Ok(());
    }

    let cached_events: Vec<sqlite_cache::CachedEvent> = payload
        .events
        .iter()
        .filter(|e| !is_synthetic_persistence_artifact(e))
        .map(session_event_to_cached_event)
        .collect();

    let session = sqlite_cache::CachedSession {
        session_id: payload.session_id,
        events: cached_events,
        specs_json: payload.specs_json,
        time_range_start: payload.time_range_start,
        time_range_end: payload.time_range_end,
    };

    tokio::task::spawn_blocking(move || sqlite_cache::save_session(&session))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Load a full session (events + specs + timeRange) in one call.
///
/// Returns `null` if the session is not cached.
#[tauri::command]
pub async fn cache_load_full_session(
    session_id: String,
) -> Result<Option<FullSessionPayload>, String> {
    let result = tokio::task::spawn_blocking(move || sqlite_cache::load_session(&session_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    Ok(result.map(|s| {
        let events: Vec<SessionEvent> =
            s.events.iter().map(cached_event_to_session_event).collect();
        let mut events = dedup_by_call_id(events);
        backfill_tool_inputs_from_messages(&s.session_id, &mut events);
        backfill_subagent_links(&s.session_id, &mut events);
        FullSessionPayload {
            session_id: s.session_id,
            events,
            specs_json: s.specs_json,
            time_range_start: s.time_range_start,
            time_range_end: s.time_range_end,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        cached_event_to_session_event, dedup_by_call_id, is_synthetic_persistence_artifact,
    };
    use crate::agent_sessions::event_pipeline::commands::event_conversion::is_ts_placeholder_id;
    use crate::agent_sessions::event_pipeline::types::{
        ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, PayloadRef,
        SessionEvent,
    };

    #[test]
    fn ts_placeholder_msg_and_think_ids_match() {
        assert!(is_ts_placeholder_id("stream-msg-ts-session-1776099853993"));
        assert!(is_ts_placeholder_id(
            "stream-think-ts-session-1776099853993"
        ));
    }

    #[test]
    fn cached_event_normalizes_legacy_string_result() {
        let cached = session_persistence::CachedEvent {
            id: "legacy-string-result".to_string(),
            session_id: "session-history-regression".to_string(),
            event_type: "message".to_string(),
            function_name: Some("message".to_string()),
            thread_id: None,
            args_json: "{}".to_string(),
            result_json: "\"loaded historical assistant text\"".to_string(),
            content: "loaded historical assistant text".to_string(),
            created_at: "2026-05-16T00:00:00.000Z".to_string(),
            meta_json: Some(
                serde_json::json!({
                    "source": "assistant",
                    "displayText": "loaded historical assistant text",
                    "displayStatus": "completed",
                    "displayVariant": "message",
                    "activityStatus": "agent",
                    "uiCanonical": "message"
                })
                .to_string(),
            ),
            history_sequence: None,
        };

        let event = cached_event_to_session_event(&cached);
        let result = event.result.as_object().expect("result must be normalized");
        assert_eq!(
            result.get("content").and_then(|value| value.as_str()),
            Some("loaded historical assistant text")
        );
        assert_eq!(
            result.get("observation").and_then(|value| value.as_str()),
            Some("loaded historical assistant text")
        );
    }

    #[test]
    fn cached_event_normalizes_legacy_string_args() {
        let cached = session_persistence::CachedEvent {
            id: "legacy-string-args".to_string(),
            session_id: "session-history-regression".to_string(),
            event_type: "tool_call".to_string(),
            function_name: Some("tool_call".to_string()),
            thread_id: None,
            args_json: "\"legacy arguments\"".to_string(),
            result_json: "{}".to_string(),
            content: "legacy arguments".to_string(),
            created_at: "2026-05-16T00:00:00.000Z".to_string(),
            meta_json: Some(
                serde_json::json!({
                    "source": "assistant",
                    "displayText": "legacy arguments",
                    "displayStatus": "completed",
                    "displayVariant": "tool_call",
                    "activityStatus": "agent",
                    "uiCanonical": "tool_call"
                })
                .to_string(),
            ),
            history_sequence: None,
        };

        let event = cached_event_to_session_event(&cached);
        let args = event.args.as_object().expect("args must be normalized");
        assert_eq!(
            args.get("content").and_then(|value| value.as_str()),
            Some("legacy arguments")
        );
        assert_eq!(
            args.get("observation").and_then(|value| value.as_str()),
            Some("legacy arguments")
        );
    }

    #[test]
    fn rust_authoritative_ids_do_not_match() {
        assert!(!is_ts_placeholder_id(
            "stream-msg-sdeagent-a91612f3-4f94-4fac-a0c2-f6e85f0c1f63-1"
        ));
        assert!(!is_ts_placeholder_id(
            "stream-think-sdeagent-a91612f3-4f94-4fac-a0c2-f6e85f0c1f63-1"
        ));
    }

    #[test]
    fn unrelated_event_ids_do_not_match() {
        assert!(!is_ts_placeholder_id("tool-call-42"));
        assert!(!is_ts_placeholder_id("user-msg-1"));
        assert!(!is_ts_placeholder_id(""));
        // Prefix must be the full "stream-msg-ts-" / "stream-think-ts-" —
        // ids like "stream-msg-tsfoo-…" are not placeholders.
        assert!(!is_ts_placeholder_id("stream-msg-tsfoo"));
    }

    #[test]
    fn turn_placeholder_is_synthetic_persistence_artifact() {
        let placeholder = make_tool_call(
            "turn-placeholder-turn-1",
            None,
            "turn_placeholder",
            serde_json::json!({}),
            serde_json::json!({ "unloadedTurn": { "turnId": "turn-1" } }),
        );
        assert!(is_synthetic_persistence_artifact(&placeholder));

        let mut synthetic_header = make_tool_call(
            "turn-1",
            None,
            "user_message",
            serde_json::json!({}),
            serde_json::json!({ "syntheticTurnHeader": true }),
        );
        synthetic_header.source = EventSource::User;
        assert!(is_synthetic_persistence_artifact(&synthetic_header));

        let normal = make_tool_call(
            "tool-call-42",
            None,
            "bash",
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert!(!is_synthetic_persistence_artifact(&normal));
    }

    #[test]
    fn compacted_event_is_synthetic_persistence_artifact() {
        let mut compacted = make_tool_call(
            "tool-call-compacted",
            None,
            "bash",
            serde_json::json!({ "streamOutput": "preview" }),
            serde_json::json!({}),
        );
        compacted.payload_refs.push(PayloadRef {
            event_id: compacted.id.clone(),
            field_path: "args.streamOutput".to_string(),
            preview: "preview".to_string(),
            full_size_bytes: 128 * 1024,
            truncated: true,
        });

        assert!(is_synthetic_persistence_artifact(&compacted));
    }

    // --- dedup_by_call_id ---

    fn make_tool_call(
        id: &str,
        call_id: Option<&str>,
        function_name: &str,
        args: serde_json::Value,
        result: serde_json::Value,
    ) -> SessionEvent {
        SessionEvent {
            id: id.to_string(),
            chunk_id: None,
            session_id: "test-session".to_string(),
            created_at: "2026-04-16T00:00:00Z".to_string(),
            function_name: function_name.to_string(),
            ui_canonical: function_name.to_string(),
            action_type: "tool_call".to_string(),
            args,
            result,
            source: EventSource::Assistant,
            display_text: format!("Tool call: {function_name}"),
            display_status: EventDisplayStatus::Completed,
            display_variant: EventDisplayVariant::ToolCall,
            activity_status: ActivityStatus::Processed,
            thread_id: None,
            process_id: None,
            call_id: call_id.map(String::from),
            file_path: None,
            command: None,
            is_delta: None,
            repo_id: None,
            repo_path: None,
            extracted: None,
            payload_refs: Vec::new(),
            last_extract_at: None,
        }
    }

    /// Regression: when two rows share the same `callId` but each carries only
    /// half of the subagent payload — one has the enriched `args`
    /// (`subagentSessionId`), the other has the final `result.content` —
    /// dedup must preserve BOTH by merging the dropped row into the survivor.
    ///
    /// This is the exact DB shape observed in `sessions.db` for historical
    /// agent spawns: the EventStore write path stamps args but never writes
    /// result, and the message-level path persists the tool observation but
    /// misses the stamp. Previously the loser was discarded wholesale, which
    /// meant the subagent block either lacked nested trajectory (missing
    /// `subagentSessionId`) or lacked the final report (missing `result`).
    #[test]
    fn dedup_merges_split_subagent_rows_on_same_call_id() {
        let call_id = "toolu_test_split";
        let message_row = make_tool_call(
            "uuid-message-row",
            Some(call_id),
            "agent",
            serde_json::json!({
                "agent_id": "builtin:explore",
                "description": "Audit frontend",
                "prompt": "audit prompt",
            }),
            serde_json::json!({
                "content": "final audit report",
                "observation": "final audit report",
            }),
        );
        let eventstore_row = make_tool_call(
            &format!("tool-call-{call_id}"),
            Some(call_id),
            "agent",
            serde_json::json!({
                "agent_id": "builtin:explore",
                "description": "Audit frontend",
                "prompt": "audit prompt",
                "action": "delegate",
                "subagentSessionId": "agent-builtin:explore-abc123",
            }),
            serde_json::json!({}),
        );

        let out = dedup_by_call_id(vec![message_row, eventstore_row]);
        assert_eq!(out.len(), 1, "expected dedup to collapse two rows into one");

        let merged = &out[0];
        // Winner is the EventStore row (richer args).
        assert_eq!(merged.id, format!("tool-call-{call_id}"));

        let args = merged.args.as_object().expect("args must be an object");
        assert_eq!(
            args.get("subagentSessionId").and_then(|v| v.as_str()),
            Some("agent-builtin:explore-abc123"),
            "subagentSessionId must survive"
        );
        assert_eq!(
            args.get("action").and_then(|v| v.as_str()),
            Some("delegate")
        );

        let result = merged.result.as_object().expect("result must be an object");
        assert_eq!(
            result.get("content").and_then(|v| v.as_str()),
            Some("final audit report"),
            "result.content must be adopted from the dropped message row"
        );
    }

    #[test]
    fn dedup_merges_tool_result_row_into_matching_tool_call_row() {
        let call_id = "toolu_code_search";
        let mut tool_call = make_tool_call(
            &format!("tool-call-{call_id}"),
            Some(call_id),
            "code_search",
            serde_json::json!({
                "action": "grep",
                "pattern": "interactive terminal",
                "max_results": 30,
            }),
            serde_json::json!({}),
        );
        tool_call.display_status = EventDisplayStatus::Running;
        tool_call.activity_status = ActivityStatus::Agent;

        let mut tool_result = make_tool_call(
            &format!("tool-result-{call_id}"),
            Some(call_id),
            "code_search",
            serde_json::json!({}),
            serde_json::json!("src/terminal.ts:12:interactive terminal"),
        );
        tool_result.action_type = "tool_result".to_string();
        tool_result.display_status = EventDisplayStatus::Completed;
        tool_result.activity_status = ActivityStatus::Processed;

        let out = dedup_by_call_id(vec![tool_call, tool_result]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, format!("tool-call-{call_id}"));
        assert_eq!(out[0].action_type, "tool_call");
        assert_eq!(
            out[0].args.get("pattern").and_then(|value| value.as_str()),
            Some("interactive terminal")
        );
        assert_eq!(
            out[0].result.as_str(),
            Some("src/terminal.ts:12:interactive terminal")
        );
        assert_eq!(out[0].display_status, EventDisplayStatus::Completed);
        assert_eq!(out[0].activity_status, ActivityStatus::Processed);
    }

    /// Cross-call_id variant: same logical agent spawn gets written with a
    /// `toolu_xxx` id by the message layer and a distinct internal `tool_xxx`
    /// id by the EventStore layer. Pass 2 matches them by `args.description`
    /// and must merge, not just drop.
    #[test]
    fn dedup_merges_agent_spawns_with_different_call_ids_by_description() {
        let message_row = make_tool_call(
            "uuid-msg",
            Some("toolu_abc"),
            "agent",
            serde_json::json!({
                "description": "Refactor auth",
                "prompt": "do it",
            }),
            serde_json::json!({ "content": "refactor report body" }),
        );
        let eventstore_row = make_tool_call(
            "tool-call-internal",
            Some("tool_xyz"),
            "agent",
            serde_json::json!({
                "description": "Refactor auth",
                "prompt": "do it",
                "subagentSessionId": "agent-builtin:sde-42",
            }),
            serde_json::json!({}),
        );

        let out = dedup_by_call_id(vec![message_row, eventstore_row]);
        assert_eq!(out.len(), 1);

        let merged = &out[0];
        let args = merged.args.as_object().unwrap();
        assert_eq!(
            args.get("subagentSessionId").and_then(|v| v.as_str()),
            Some("agent-builtin:sde-42"),
            "subagentSessionId must be preserved on the surviving row"
        );

        let result = merged.result.as_object().unwrap();
        assert_eq!(
            result.get("content").and_then(|v| v.as_str()),
            Some("refactor report body"),
            "message row's result.content must be merged into the survivor"
        );
    }

    /// Unrelated tool calls with distinct call_ids must pass through untouched.
    #[test]
    fn dedup_leaves_unique_call_ids_intact() {
        let a = make_tool_call(
            "a",
            Some("call-a"),
            "read_file",
            serde_json::json!({ "path": "/foo" }),
            serde_json::json!({ "content": "ok" }),
        );
        let b = make_tool_call(
            "b",
            Some("call-b"),
            "read_file",
            serde_json::json!({ "path": "/bar" }),
            serde_json::json!({ "content": "ok" }),
        );

        let out = dedup_by_call_id(vec![a, b]);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].id, "a");
        assert_eq!(out[1].id, "b");
    }

    /// Winner's existing args keys must NEVER be overwritten by the loser.
    /// Only gaps are filled.
    #[test]
    fn dedup_preserves_winner_args_on_key_conflict() {
        let loser = make_tool_call(
            "loser",
            Some("cid"),
            "agent",
            serde_json::json!({
                "description": "x",
                "prompt": "OLD prompt",
            }),
            serde_json::json!({}),
        );
        let winner = make_tool_call(
            "winner",
            Some("cid"),
            "agent",
            serde_json::json!({
                "description": "x",
                "prompt": "NEW prompt",
                "subagentSessionId": "sid-1",
            }),
            serde_json::json!({}),
        );

        let out = dedup_by_call_id(vec![loser, winner]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "winner");
        let args = out[0].args.as_object().unwrap();
        assert_eq!(
            args.get("prompt").and_then(|v| v.as_str()),
            Some("NEW prompt"),
            "winner's prompt must not be overwritten by the loser"
        );
    }
}
