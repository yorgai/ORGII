//! SQLite Bridge Commands
//!
//! Load/save events from SQLite cache with SessionEvent <-> CachedEvent conversion.

use std::collections::{HashMap, HashSet};

use dev_record::cursor_db_history::CURSORIDE_SESSION_PREFIX;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::agent_sessions::event_pipeline::ingestion::function_map::resolve_ui_canonical;
use crate::agent_sessions::event_pipeline::payload_compaction::{
    is_compacted_event, load_event_payload_body, EventPayloadBody,
};
use crate::agent_sessions::event_pipeline::types::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};
use session_persistence as sqlite_cache;

use super::{save_events_retry, schedule_notify, EventStoreState, BULK_WRITE_MAX_RETRIES};

const ACTION_TYPE_TOOL_CALL: &str = "tool_call";
const ACTION_TYPE_TOOL_RESULT: &str = "tool_result";

const FILE_PATH_KEYS: &[&str] = &["file_path", "path", "fileName", "file_name", "target_file"];

fn is_cursor_ide_session_id(session_id: &str) -> bool {
    session_id.starts_with(CURSORIDE_SESSION_PREFIX)
}

// ============================================================================
// Post-load dedup: call_id collision + agent description collision
// ============================================================================
//
// Two persistence paths write to the `events` table for the same logical tool
// call: (1) `push_events_to_session` (EventStore write-through, IDs like
// `tool-call-{callId}`) and (2) message-level persistence (`save_tool_call_msg`
// → `agent_messages`, later surfaced as events with UUID IDs).
//
// The two rows are NOT interchangeable — each carries data the other lacks:
//
//   EventStore row (`tool-call-{callId}`):
//     - args: enriched with `subagentSessionId`, `action: "delegate"`, etc.
//     - result: typically empty `{}` — the stamping path never writes result
//   Message row (UUID id):
//     - args: original, un-stamped from the model (no `subagentSessionId`)
//     - result: the full tool observation / subagent report
//
// A naive "keep richer args, drop the other" collapse either hides the final
// result (if the EventStore row wins) or hides the `subagentSessionId`
// required to render nested subagent trajectory (if the message row wins).
//
// Fix: merge-on-drop. Before discarding the loser, copy over any fields the
// winner is missing:
//   - If the winner's `result` is empty/null, adopt the loser's `result`.
//   - For each arg key present in the loser but missing from the winner,
//     copy it into the winner (winner's existing keys are never overwritten).
//
// Pass 1 handles same-`call_id` collisions; pass 2 handles cross-`call_id`
// agent spawn duplicates (Claude-native `toolu_xxx` id vs internal `tool_xxx`
// id) matched by `args.description`.

/// True when a JSON value is null, `{}`, `[]`, or an empty string.
fn is_empty_json(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => true,
        serde_json::Value::Object(m) => m.is_empty(),
        serde_json::Value::Array(a) => a.is_empty(),
        serde_json::Value::String(s) => s.is_empty(),
        _ => false,
    }
}

/// Merge non-empty fields from `loser` into `winner`. Only fills gaps — never
/// overwrites an existing value on the winner. The loser is consumed so owned
/// values can be moved rather than cloned.
fn merge_loser_into_winner(winner: &mut SessionEvent, loser: SessionEvent) {
    let loser_is_terminal_result = loser.action_type == ACTION_TYPE_TOOL_RESULT
        && matches!(
            loser.display_status,
            EventDisplayStatus::Completed | EventDisplayStatus::Failed
        );
    let loser_display_status = loser.display_status.clone();
    let loser_activity_status = loser.activity_status.clone();

    if is_empty_json(&winner.result) && !is_empty_json(&loser.result) {
        winner.result = loser.result;
    }

    if let (Some(winner_args), Some(loser_args)) =
        (winner.args.as_object_mut(), loser.args.as_object())
    {
        for (key, value) in loser_args {
            if !winner_args.contains_key(key) {
                winner_args.insert(key.clone(), value.clone());
            }
        }
    }

    // Preserve the richer display_text if the winner lacks one.
    if winner.display_text.trim().is_empty() && !loser.display_text.trim().is_empty() {
        winner.display_text = loser.display_text;
    }

    if loser_is_terminal_result {
        winner.display_status = loser_display_status;
        winner.activity_status = loser_activity_status;
    }

    // Recompute extractors so derived fields (e.g. subagent result content)
    // reflect the merged payload.
    winner.recompute_extracted();
}

fn dedup_by_call_id(events: Vec<SessionEvent>) -> Vec<SessionEvent> {
    use std::collections::HashMap;

    // winner_idx -> list of loser indices that should merge into it.
    let mut merges: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut drop_set: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut best_idx_by_call_id: HashMap<String, usize> = HashMap::new();

    // Pass 1: same call_id → keep the tool_call identity row, merge the
    // matching tool_result/result-bearing row into it. If both are tool_call
    // rows, keep the one with richer args.
    for (idx, event) in events.iter().enumerate() {
        if event.action_type != "tool_call" && event.action_type != "tool_result" {
            continue;
        }
        let Some(ref cid) = event.call_id else {
            continue;
        };
        let arg_count = event.args.as_object().map_or(0, |m| m.len());

        if let Some(&prev_idx) = best_idx_by_call_id.get(cid) {
            let prev = &events[prev_idx];
            let prev_arg_count = prev.args.as_object().map_or(0, |m| m.len());
            let current_is_call = event.action_type == "tool_call";
            let prev_is_call = prev.action_type == "tool_call";
            let (winner, loser) = match (current_is_call, prev_is_call) {
                (true, false) => (idx, prev_idx),
                (false, true) => (prev_idx, idx),
                _ if arg_count > prev_arg_count => (idx, prev_idx),
                _ => (prev_idx, idx),
            };
            drop_set.insert(loser);
            merges.entry(winner).or_default().push(loser);
            best_idx_by_call_id.insert(cid.clone(), winner);
        } else {
            best_idx_by_call_id.insert(cid.clone(), idx);
        }
    }

    // Pass 2: agent tool_calls with different call_ids but same description.
    // Prefer the one with `subagentSessionId`; fall back to richest args.
    let mut best_idx_by_agent_desc: HashMap<String, usize> = HashMap::new();
    for (idx, event) in events.iter().enumerate() {
        if drop_set.contains(&idx) {
            continue;
        }
        if event.action_type != "tool_call" || event.function_name != "agent" {
            continue;
        }
        let Some(desc) = event
            .args
            .as_object()
            .and_then(|m| m.get("description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        if desc.is_empty() {
            continue;
        }

        let has_sid = event
            .args
            .as_object()
            .is_some_and(|m| m.contains_key("subagentSessionId"));
        let arg_count = event.args.as_object().map_or(0, |m| m.len());

        if let Some(&prev_idx) = best_idx_by_agent_desc.get(&desc) {
            let prev_has_sid = events[prev_idx]
                .args
                .as_object()
                .is_some_and(|m| m.contains_key("subagentSessionId"));
            let prev_arg_count = events[prev_idx].args.as_object().map_or(0, |m| m.len());

            let new_wins = (has_sid && !prev_has_sid)
                || (has_sid == prev_has_sid && arg_count > prev_arg_count);
            let (winner, loser) = if new_wins {
                (idx, prev_idx)
            } else {
                (prev_idx, idx)
            };
            drop_set.insert(loser);
            merges.entry(winner).or_default().push(loser);
            best_idx_by_agent_desc.insert(desc, winner);
        } else {
            best_idx_by_agent_desc.insert(desc, idx);
        }
    }

    if drop_set.is_empty() {
        return events;
    }

    // Apply merges: move loser payloads into winner in a single pass.
    // Use `Option<SessionEvent>` placeholders so we can take ownership out of
    // the vec without shifting indices.
    let mut slots: Vec<Option<SessionEvent>> = events.into_iter().map(Some).collect();

    for (winner_idx, loser_indices) in &merges {
        // Collect losers first so the winner borrow can be mutable afterwards.
        let mut losers: Vec<SessionEvent> = Vec::with_capacity(loser_indices.len());
        for &loser_idx in loser_indices {
            if let Some(loser) = slots[loser_idx].take() {
                losers.push(loser);
            }
        }
        if let Some(winner) = slots[*winner_idx].as_mut() {
            for loser in losers {
                merge_loser_into_winner(winner, loser);
            }
        }
    }

    slots
        .into_iter()
        .enumerate()
        .filter_map(
            |(idx, opt)| {
                if drop_set.contains(&idx) {
                    None
                } else {
                    opt
                }
            },
        )
        .collect()
}

// ============================================================================
// Subagent link backfill for historical sessions
// ============================================================================
//
// Sessions recorded before `stamp_subagent_session_id_on_parent` existed have
// parent `agent` tool_call rows with only `{agent_id, description, prompt}` —
// no `subagentSessionId`. Without that field, `SubagentAdapter` can't
// subscribe to the child session's event stream and the SubagentBlock shows
// only the final `result.content`, hiding the nested tool trajectory.
//
// Strategy:
//
// 1. Query `get_child_sessions(parent)` → children ordered by `created_at`.
// 2. Build a lookup set of already-linked child session IDs (from events that
//    already have `args.subagentSessionId`).
// 3. Collect parent's `agent` tool_call events that are missing a link,
//    in persisted chronological order.
// 4. Filter children to those not yet linked.
// 5. Pair remaining children to remaining candidates positionally (both are
//    chronologically sorted). Each match stamps `subagentSessionId` + `action`
//    and recomputes extractors.
//
// If the remaining children outnumber remaining candidates we stamp as many
// as we can. Excess children are ignored. This is safe because each child
// session's `parent_session_id` guarantees it belongs to this parent — the
// only ambiguity is *which* candidate maps to *which* child, and chronological
// order is the strongest heuristic available.
fn read_tool_inputs_by_call_id(
    session_id: &str,
) -> Result<HashMap<String, serde_json::Value>, String> {
    use rusqlite::params;

    let conn = sqlite_cache::get_connection().map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT tool_call_id, tool_input
             FROM agent_messages
             WHERE session_id = ?1
               AND tool_call_id IS NOT NULL
               AND tool_input IS NOT NULL
               AND TRIM(tool_input) != ''",
        )
        .map_err(|err| err.to_string())?;

    let rows = stmt
        .query_map(params![session_id], |row| {
            let call_id: String = row.get(0)?;
            let tool_input: String = row.get(1)?;
            Ok((call_id, tool_input))
        })
        .map_err(|err| err.to_string())?;

    let mut inputs = HashMap::new();
    for row in rows {
        let (call_id, tool_input) = row.map_err(|err| err.to_string())?;
        let parsed = serde_json::from_str::<serde_json::Value>(&tool_input)
            .map_err(|err| format!("failed to parse tool_input for call_id {call_id}: {err}"))?;
        inputs.insert(call_id, normalize_event_record_value(parsed));
    }

    Ok(inputs)
}

fn extract_file_path_from_json(value: &serde_json::Value) -> Option<String> {
    let obj = value.as_object()?;
    FILE_PATH_KEYS.iter().find_map(|key| {
        obj.get(*key)
            .and_then(|path| path.as_str())
            .filter(|path| !path.trim().is_empty())
            .map(String::from)
    })
}

fn merge_missing_args_from_tool_input(event: &mut SessionEvent, tool_input: &serde_json::Value) {
    if let (Some(event_args), Some(input_args)) =
        (event.args.as_object_mut(), tool_input.as_object())
    {
        for (key, value) in input_args {
            if !event_args.contains_key(key) {
                event_args.insert(key.clone(), value.clone());
            }
        }
    }

    if event.file_path.is_none() {
        event.file_path = extract_file_path_from_json(&event.args)
            .or_else(|| extract_file_path_from_json(tool_input));
    }

    event.recompute_extracted();
}

fn backfill_tool_inputs_from_messages(session_id: &str, events: &mut [SessionEvent]) {
    let candidates: Vec<usize> = events
        .iter()
        .enumerate()
        .filter(|(_, event)| event.action_type == ACTION_TYPE_TOOL_CALL)
        .filter(|(_, event)| event.call_id.is_some())
        .filter(|(_, event)| {
            event.args.as_object().is_none_or(|args| args.is_empty()) || event.file_path.is_none()
        })
        .map(|(idx, _)| idx)
        .collect();

    if candidates.is_empty() {
        return;
    }

    let tool_inputs = match read_tool_inputs_by_call_id(session_id) {
        Ok(inputs) => inputs,
        Err(err) => {
            tracing::warn!(
                "[cache_bridge] failed to load tool inputs for {}: {}",
                session_id,
                err
            );
            return;
        }
    };

    if tool_inputs.is_empty() {
        return;
    }

    let mut backfilled = 0usize;
    for idx in candidates {
        let Some(call_id) = events[idx].call_id.as_deref() else {
            continue;
        };
        let Some(tool_input) = tool_inputs.get(call_id) else {
            continue;
        };
        merge_missing_args_from_tool_input(&mut events[idx], tool_input);
        backfilled += 1;
    }

    if backfilled > 0 {
        tracing::info!(
            "[cache_bridge] backfilled {} tool event(s) from agent_messages for {}",
            backfilled,
            session_id
        );
    }
}

fn backfill_subagent_links(session_id: &str, events: &mut [SessionEvent]) {
    let total_agent_events = events
        .iter()
        .filter(|e| e.action_type == "tool_call" && e.function_name == "agent")
        .count();
    log::debug!(
        "[cache_bridge] backfill_subagent_links: session={session_id} total_agent_tool_calls={total_agent_events} total_events={}",
        events.len()
    );

    let children = match agent_core::session::persistence::get_child_sessions(session_id) {
        Ok(rows) => rows,
        Err(err) => {
            log::debug!(
                "[cache_bridge] backfill_subagent_links: get_child_sessions({session_id}) failed: {err}"
            );
            return;
        }
    };

    log::debug!(
        "[cache_bridge] backfill_subagent_links: children_count={} children={:?}",
        children.len(),
        children.iter().map(|c| &c.session_id).collect::<Vec<_>>()
    );

    if children.is_empty() {
        return;
    }

    // Collect session IDs already linked to events (from stamp or prior merge).
    let already_linked: std::collections::HashSet<&str> = events
        .iter()
        .filter_map(|e| {
            e.args
                .as_object()
                .and_then(|m| m.get("subagentSessionId"))
                .and_then(|v| v.as_str())
        })
        .collect();

    log::debug!(
        "[cache_bridge] backfill_subagent_links: already_linked={:?}",
        already_linked
    );

    // Children not yet linked to any event.
    let unlinked_children: Vec<_> = children
        .iter()
        .filter(|c| !already_linked.contains(c.session_id.as_str()))
        .collect();

    if unlinked_children.is_empty() {
        log::debug!("[cache_bridge] backfill_subagent_links: all children already linked, skip");
        return;
    }

    // Candidate events: `agent` tool_calls missing `subagentSessionId`.
    let candidates: Vec<usize> = events
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.action_type == "tool_call"
                && e.function_name == "agent"
                && e.args
                    .as_object()
                    .is_none_or(|m| !m.contains_key("subagentSessionId"))
        })
        .map(|(idx, _)| idx)
        .collect();

    log::debug!(
        "[cache_bridge] backfill_subagent_links: candidates={} unlinked_children={}",
        candidates.len(),
        unlinked_children.len()
    );

    if candidates.is_empty() {
        log::debug!("[cache_bridge] backfill_subagent_links: no candidates, skip");
        return;
    }

    let mut stamped = 0usize;
    for (candidate_idx, child) in candidates.iter().zip(unlinked_children.iter()) {
        let Some(obj) = events[*candidate_idx].args.as_object_mut() else {
            continue;
        };
        obj.insert(
            "subagentSessionId".to_string(),
            serde_json::Value::String(child.session_id.clone()),
        );
        obj.entry("action")
            .or_insert_with(|| serde_json::Value::String("delegate".to_string()));
        events[*candidate_idx].recompute_extracted();
        stamped += 1;
    }

    if stamped > 0 {
        log::info!(
            "[cache_bridge] backfill_subagent_links: stamped {stamped} subagentSessionId(s) onto {session_id}"
        );
    }
}

// ============================================================================
// Synthetic event filtering
// ============================================================================

pub(crate) fn is_ts_placeholder_id(id: &str) -> bool {
    id.starts_with("stream-msg-ts-") || id.starts_with("stream-think-ts-")
}

pub(crate) fn is_turn_placeholder_event(event: &SessionEvent) -> bool {
    event.function_name == "turn_placeholder" || event.id.starts_with("turn-placeholder-")
}

pub(crate) fn is_synthetic_turn_header_event(event: &SessionEvent) -> bool {
    event
        .result
        .get("syntheticTurnHeader")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub(crate) fn is_synthetic_persistence_artifact(event: &SessionEvent) -> bool {
    is_ts_placeholder_id(&event.id)
        || is_turn_placeholder_event(event)
        || is_synthetic_turn_header_event(event)
        || is_compacted_event(event)
}

// ============================================================================
// CachedEvent <-> SessionEvent Conversion
// ============================================================================

pub(crate) fn normalize_event_record_value(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(_) => value,
        serde_json::Value::String(text) => serde_json::json!({
            "content": text,
            "observation": text,
        }),
        serde_json::Value::Null => serde_json::json!({}),
        other => serde_json::json!({ "value": other }),
    }
}

/// Convert a `CachedEvent` (from SQLite) to `SessionEvent` (in-memory).
///
/// Mirrors the JS `fromCachedEvent` in `sqliteCache.ts` — metadata fields
/// are packed into `meta_json`.
pub(crate) fn cached_event_to_session_event(cached: &sqlite_cache::CachedEvent) -> SessionEvent {
    // The three JSON columns below were originally serialized from
    // `serde_json::Value`, so a parse failure here means the SQLite
    // row was tampered with or the schema drifted. Defaulting to
    // `{}` keeps the rest of the session loadable (better UX than
    // failing the whole snapshot load on one corrupt row), but we
    // warn so the corruption shows up in logs instead of being
    // indistinguishable from a tool that legitimately had no args.
    let meta: serde_json::Value = match cached.meta_json.as_deref() {
        Some(json) => match serde_json::from_str(json) {
            Ok(v) => v,
            Err(err) => {
                tracing::warn!(
                    "[cache_bridge] failed to parse meta_json for event {:?}: {} (raw: {:?})",
                    cached.id,
                    err,
                    json
                );
                serde_json::json!({})
            }
        },
        None => serde_json::json!({}),
    };

    let meta_obj = meta.as_object();

    let args: serde_json::Value = match serde_json::from_str(&cached.args_json) {
        Ok(v) => normalize_event_record_value(v),
        Err(err) => {
            tracing::warn!(
                "[cache_bridge] failed to parse args_json for event {:?}: {} (raw: {:?})",
                cached.id,
                err,
                cached.args_json
            );
            serde_json::json!({})
        }
    };
    let result: serde_json::Value = match serde_json::from_str(&cached.result_json) {
        Ok(v) => normalize_event_record_value(v),
        Err(err) => {
            tracing::warn!(
                "[cache_bridge] failed to parse result_json for event {:?}: {} (raw: {:?})",
                cached.id,
                err,
                cached.result_json
            );
            serde_json::json!({})
        }
    };

    let source_str = meta_obj
        .and_then(|m| m.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("system");
    let source = match source_str {
        "user" => EventSource::User,
        "assistant" => EventSource::Assistant,
        _ => EventSource::System,
    };

    let display_text = meta_obj
        .and_then(|m| m.get("displayText"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| cached.function_name.as_deref().unwrap_or("unknown"))
        .to_string();

    let display_status_str = meta_obj
        .and_then(|m| m.get("displayStatus"))
        .and_then(|v| v.as_str())
        .unwrap_or("running");
    let display_status = serde_json::from_value(serde_json::json!(display_status_str))
        .unwrap_or(EventDisplayStatus::Running);

    let display_variant_str = meta_obj
        .and_then(|m| m.get("displayVariant"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool_call");
    let display_variant = serde_json::from_value(serde_json::json!(display_variant_str))
        .unwrap_or(EventDisplayVariant::ToolCall);

    let activity_status_str = meta_obj
        .and_then(|m| m.get("activityStatus"))
        .and_then(|v| v.as_str())
        .unwrap_or("agent");
    let activity_status = serde_json::from_value(serde_json::json!(activity_status_str))
        .unwrap_or(ActivityStatus::Agent);

    let chunk_id = meta_obj
        .and_then(|m| m.get("chunk_id"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let call_id = meta_obj
        .and_then(|m| m.get("callId"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let file_path = meta_obj
        .and_then(|m| m.get("filePath"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let command = meta_obj
        .and_then(|m| m.get("command"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let is_delta = meta_obj
        .and_then(|m| m.get("isDelta"))
        .and_then(|v| v.as_bool());

    let repo_id = meta_obj
        .and_then(|m| m.get("repoId"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let repo_path = meta_obj
        .and_then(|m| m.get("repoPath"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let process_id = meta_obj
        .and_then(|m| m.get("processId"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let function_name = cached.function_name.clone().unwrap_or_default();
    let ui_canonical = meta_obj
        .and_then(|m| m.get("uiCanonical"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| resolve_ui_canonical(&function_name));

    let mut event = SessionEvent {
        id: cached.id.clone(),
        chunk_id,
        session_id: cached.session_id.clone(),
        created_at: cached.created_at.clone(),
        function_name,
        ui_canonical,
        action_type: cached.event_type.clone(),
        args,
        result,
        source,
        display_text,
        display_status,
        display_variant,
        activity_status,
        thread_id: cached.thread_id.clone(),
        process_id,
        call_id,
        file_path,
        command,
        is_delta,
        repo_id,
        repo_path,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    // Restore from SQLite cache — always compute a fresh extraction.
    event.recompute_extracted();
    event
}

/// Convert a `SessionEvent` to `CachedEvent` for SQLite storage.
///
/// Mirrors the JS `toCachedEvent` — packs display/metadata fields into `meta_json`.
pub fn session_event_to_cached_event(event: &SessionEvent) -> sqlite_cache::CachedEvent {
    let meta = serde_json::json!({
        "source": event.source,
        "displayText": event.display_text,
        "displayStatus": event.display_status,
        "displayVariant": event.display_variant,
        "activityStatus": event.activity_status,
        "uiCanonical": event.ui_canonical,
        "chunk_id": event.chunk_id,
        "callId": event.call_id,
        "filePath": event.file_path,
        "command": event.command,
        "isDelta": event.is_delta,
        "processId": event.process_id,
        "repoId": event.repo_id,
        "repoPath": event.repo_path,
    });

    let content = build_searchable_content(event);

    sqlite_cache::CachedEvent {
        id: event.id.clone(),
        session_id: event.session_id.clone(),
        event_type: event.action_type.clone(),
        function_name: if event.function_name.is_empty() {
            None
        } else {
            Some(event.function_name.clone())
        },
        thread_id: event.thread_id.clone(),
        // `serde_json::Value` is structurally always serializable, so
        // these `expect`s document the invariant rather than masking a
        // real failure mode (Rule 41 in ARCHITECTURE.md). If they ever
        // fire it indicates a serde recursion / cycle bug worth crashing on.
        args_json: serde_json::to_string(&event.args)
            .expect("args is serde_json::Value, must serialize"),
        result_json: serde_json::to_string(&normalize_event_record_value(event.result.clone()))
            .expect("result is serde_json::Value, must serialize"),
        content,
        created_at: event.created_at.clone(),
        meta_json: Some(
            serde_json::to_string(&meta).expect("meta is serde_json::Value, must serialize"),
        ),
        history_sequence: None,
    }
}

/// Build searchable text content from a SessionEvent.
fn build_searchable_content(event: &SessionEvent) -> String {
    let mut parts = Vec::with_capacity(4);
    if !event.function_name.is_empty() {
        parts.push(event.function_name.as_str());
    }
    if !event.display_text.is_empty() {
        let truncated = if event.display_text.len() > 500 {
            let mut end = 500;
            while end > 0 && !event.display_text.is_char_boundary(end) {
                end -= 1;
            }
            &event.display_text[..end]
        } else {
            &event.display_text
        };
        parts.push(truncated);
    }
    parts.join(" ")
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTurnBodyWindow {
    pub turn_id: String,
    pub events: Vec<SessionEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInitialTurnWindow {
    pub turns: Vec<sqlite_cache::CachedTurnSummary>,
    pub events: Vec<SessionEvent>,
}

fn turn_user_preview_text(turn: &sqlite_cache::CachedTurnSummary) -> String {
    let preview = turn.user_preview.trim();
    preview
        .strip_prefix("user_message ")
        .unwrap_or(preview)
        .trim()
        .to_string()
}

fn turn_has_user_header(
    turn: &sqlite_cache::CachedTurnSummary,
    present_event_ids: &HashSet<String>,
) -> bool {
    present_event_ids.contains(&turn.turn_id)
        || turn
            .user_event_ids
            .iter()
            .any(|event_id| present_event_ids.contains(event_id))
}

fn make_turn_user_header_event(
    session_id: &str,
    turn: &sqlite_cache::CachedTurnSummary,
) -> SessionEvent {
    let display_text = turn_user_preview_text(turn);
    let result = serde_json::json!({
        "syntheticTurnHeader": true,
        "type": "user",
        "message": {
            "content": display_text,
            "role": "user",
        },
    });

    let mut event = SessionEvent {
        id: turn.turn_id.clone(),
        chunk_id: Some(turn.turn_id.clone()),
        session_id: session_id.to_string(),
        created_at: turn.started_at.clone(),
        function_name: "user_message".to_string(),
        ui_canonical: "user_message".to_string(),
        action_type: "raw".to_string(),
        args: serde_json::json!({}),
        result,
        source: EventSource::User,
        display_text,
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::Message,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: None,
        file_path: None,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    event.recompute_extracted();
    event
}

fn make_turn_placeholder_event(
    session_id: &str,
    turn: &sqlite_cache::CachedTurnSummary,
) -> SessionEvent {
    let event_count = turn.body_event_count.max(0);
    let duration_ms = turn.duration_ms.unwrap_or(0).max(0);
    let result = serde_json::json!({
        "unloadedTurn": {
            "turnId": turn.turn_id,
            "eventCount": event_count,
            "bodyEventCount": event_count,
            "durationMs": duration_ms,
            "startedAt": turn.started_at,
            "endedAt": turn.ended_at,
            "nextTurnId": turn.next_turn_id,
        },
    });

    let mut event = SessionEvent {
        id: format!("turn-placeholder-{}", turn.turn_id),
        chunk_id: Some(format!("turn-placeholder-{}", turn.turn_id)),
        session_id: session_id.to_string(),
        created_at: turn
            .ended_at
            .clone()
            .unwrap_or_else(|| turn.started_at.clone()),
        function_name: "turn_placeholder".to_string(),
        ui_canonical: "turn_placeholder".to_string(),
        action_type: "turn_placeholder".to_string(),
        args: serde_json::json!({}),
        result,
        source: EventSource::Assistant,
        display_text: format!("Turn {} is not loaded yet.", turn.turn_id),
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::Message,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: None,
        file_path: None,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    };
    event.recompute_extracted();
    event
}

#[tauri::command]
pub async fn cache_load_session_turn_body(
    session_id: String,
    turn_id: String,
) -> Result<SessionTurnBodyWindow, String> {
    let sid = session_id.clone();
    let tid = turn_id.clone();
    let window =
        tokio::task::spawn_blocking(move || sqlite_cache::load_turn_body_window(&sid, &tid))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;

    let events: Vec<SessionEvent> = window
        .events
        .iter()
        .map(cached_event_to_session_event)
        .collect();
    let mut events = dedup_by_call_id(events);
    backfill_tool_inputs_from_messages(&session_id, &mut events);
    backfill_subagent_links(&session_id, &mut events);

    Ok(SessionTurnBodyWindow {
        turn_id: window.turn_id,
        events,
    })
}

async fn load_initial_turn_window_events(
    session_id: &str,
    recent_turn_count: Option<usize>,
) -> Result<SessionInitialTurnWindow, String> {
    let sid = session_id.to_string();
    let recent_count = recent_turn_count.unwrap_or(5);
    let window = tokio::task::spawn_blocking(move || {
        sqlite_cache::load_initial_turn_window(&sid, recent_count)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let recent_start = window.turns.len().saturating_sub(recent_count);
    let recent_turn_ids = window.turns[recent_start..]
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect::<HashSet<_>>();

    let mut events: Vec<SessionEvent> = window
        .events
        .iter()
        .map(cached_event_to_session_event)
        .collect();
    let present_event_ids: HashSet<String> = events.iter().map(|event| event.id.clone()).collect();
    events.extend(
        window
            .turns
            .iter()
            .filter(|turn| !turn_has_user_header(turn, &present_event_ids))
            .map(|turn| make_turn_user_header_event(session_id, turn)),
    );
    events.extend(
        window.turns[..recent_start]
            .iter()
            .filter(|turn| !recent_turn_ids.contains(turn.turn_id.as_str()))
            .filter(|turn| turn.body_event_count > 0)
            .map(|turn| make_turn_placeholder_event(session_id, turn)),
    );
    events.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut events = dedup_by_call_id(events);
    backfill_tool_inputs_from_messages(session_id, &mut events);
    backfill_subagent_links(session_id, &mut events);

    Ok(SessionInitialTurnWindow {
        turns: window.turns,
        events,
    })
}

#[tauri::command]
pub async fn cache_load_session_initial_turn_window(
    session_id: String,
    recent_turn_count: Option<usize>,
) -> Result<SessionInitialTurnWindow, String> {
    load_initial_turn_window_events(&session_id, recent_turn_count).await
}

#[tauri::command]
pub async fn es_load_initial_turn_window(
    app: AppHandle,
    state: State<'_, EventStoreState>,
    session_id: String,
    recent_turn_count: Option<usize>,
) -> Result<usize, String> {
    let window = load_initial_turn_window_events(&session_id, recent_turn_count).await?;
    let count = window.events.len();
    state.with_store_mut(&session_id, |store| {
        store.set_round_window(window.events);
        store.repair_subagent_links();
    });
    schedule_notify(&app, &state, &session_id);
    Ok(count)
}

#[tauri::command]
pub async fn es_unload_turn_body(
    app: AppHandle,
    state: State<'_, EventStoreState>,
    session_id: String,
    turn_id: String,
) -> Result<usize, String> {
    let lookup_sid = session_id.clone();
    let lookup_turn_id = turn_id.clone();
    let turn = tokio::task::spawn_blocking(move || sqlite_cache::load_turn_index(&lookup_sid))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|summary| summary.turn_id == lookup_turn_id)
        .ok_or_else(|| format!("turn not found: {turn_id}"))?;

    let placeholder = make_turn_placeholder_event(&session_id, &turn);
    let removed = state.with_store_mut(&session_id, |store| {
        store.unload_turn_body(&turn_id, placeholder)
    });
    if removed > 0 {
        schedule_notify(&app, &state, &session_id);
    }
    Ok(removed)
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
        is_ts_placeholder_id,
    };
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
