//! Event conversion helpers: dedup, backfill, synthetic filtering,
//! and CachedEvent <-> SessionEvent conversion.

use std::collections::HashMap;

use crate::agent_sessions::event_pipeline::ingestion::function_map::resolve_ui_canonical;
use crate::agent_sessions::event_pipeline::payload_compaction::is_compacted_event;
use crate::agent_sessions::event_pipeline::types::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};
use session_persistence as sqlite_cache;

const ACTION_TYPE_TOOL_CALL: &str = "tool_call";
const ACTION_TYPE_TOOL_RESULT: &str = "tool_result";

const FILE_PATH_KEYS: &[&str] = &["file_path", "path", "fileName", "file_name", "target_file"];

// ============================================================================
// Post-load dedup: call_id collision + agent description collision
// ============================================================================

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

pub(crate) fn dedup_by_call_id(events: Vec<SessionEvent>) -> Vec<SessionEvent> {
    // winner_idx -> list of loser indices that should merge into it.
    let mut merges: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut drop_set: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut best_idx_by_call_id: HashMap<String, usize> = HashMap::new();

    // Pass 1: same call_id -> keep the tool_call identity row, merge the
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

pub(crate) fn backfill_tool_inputs_from_messages(session_id: &str, events: &mut [SessionEvent]) {
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

pub(crate) fn backfill_subagent_links(session_id: &str, events: &mut [SessionEvent]) {
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
        // real failure mode. If they ever fire it indicates a serde
        // recursion / cycle bug worth crashing on.
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
