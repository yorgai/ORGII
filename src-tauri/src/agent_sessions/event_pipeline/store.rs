//! EventStore — high-performance per-session event storage
//!
//! Stores events in a `Vec<SessionEvent>` with O(1) lookup via `HashMap<String, usize>`.
//! Each instance manages one session; the command layer in `commands/mod.rs` holds
//! a `HashMap<sessionId, EventStore>` for multi-session support and handles
//! batch-throttled `es:changed` notifications to the frontend.

use std::collections::{HashMap, HashSet};

use crate::agent_sessions::event_pipeline::types::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
    SessionEventPatch,
};

const MAX_EVENTS: usize = 8000;
const TURN_PLACEHOLDER_FUNCTION_NAME: &str = "turn_placeholder";
const TURN_PLACEHOLDER_ID_PREFIX: &str = "turn-placeholder-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HydrationMode {
    Full,
    RoundWindow,
    LivePartial,
}

fn is_synthetic_transcript_placeholder(event: &SessionEvent) -> bool {
    event
        .result
        .get("syntheticUserInput")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn transcript_text(event: &SessionEvent) -> Option<String> {
    let display_text = event.display_text.trim();
    if !display_text.is_empty() {
        return Some(display_text.to_string());
    }

    event
        .result
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|value| value.as_str())
        .or_else(|| event.result.get("content").and_then(|value| value.as_str()))
        .or_else(|| {
            event
                .result
                .get("observation")
                .and_then(|value| value.as_str())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn transcript_message_key(event: &SessionEvent) -> Option<(EventSource, String)> {
    match event.source {
        EventSource::User | EventSource::Assistant => {
            transcript_text(event).map(|text| (event.source.clone(), text))
        }
        _ => None,
    }
}

fn normalized_event_text(event: &SessionEvent) -> String {
    event
        .display_text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_completed_authoritative_stream_transcript(event: &SessionEvent) -> bool {
    let is_stream_transcript = matches!(
        event.display_variant,
        EventDisplayVariant::Message | EventDisplayVariant::Thinking
    ) && (event.id.starts_with("stream-msg-")
        || event.id.starts_with("stream-think-"));

    event.source == EventSource::Assistant
        && is_stream_transcript
        && event.display_status == EventDisplayStatus::Completed
        && event.is_delta != Some(true)
        && !normalized_event_text(event).is_empty()
}

fn is_authoritative_transcript_message(event: &SessionEvent) -> bool {
    transcript_message_key(event).is_some() && !is_synthetic_transcript_placeholder(event)
}

fn reconcile_loaded_synthetic_transcript_placeholders(events: &mut Vec<SessionEvent>) -> usize {
    let authoritative_keys: Vec<(EventSource, String)> = events
        .iter()
        .filter(|event| is_authoritative_transcript_message(event))
        .filter_map(transcript_message_key)
        .collect();

    let removed_ids: HashSet<String> = events
        .iter()
        .filter(|event| {
            is_synthetic_transcript_placeholder(event)
                && transcript_message_key(event)
                    .as_ref()
                    .is_some_and(|key| authoritative_keys.iter().any(|candidate| candidate == key))
        })
        .map(|event| event.id.clone())
        .collect();

    let removed = removed_ids.len();
    if removed > 0 {
        events.retain(|event| !removed_ids.contains(&event.id));
    }
    removed
}

fn is_turn_placeholder(event: &SessionEvent) -> bool {
    event.function_name == TURN_PLACEHOLDER_FUNCTION_NAME
        || event.id.starts_with(TURN_PLACEHOLDER_ID_PREFIX)
}

fn placeholder_turn_id(event: &SessionEvent) -> Option<&str> {
    event
        .result
        .get("unloadedTurn")
        .and_then(|value| value.get("turnId"))
        .and_then(|value| value.as_str())
}

fn placeholder_next_turn_id(event: &SessionEvent) -> Option<&str> {
    event
        .result
        .get("unloadedTurn")
        .and_then(|value| value.get("nextTurnId"))
        .and_then(|value| value.as_str())
}

fn loaded_turn_ids_from_events(events: &[SessionEvent]) -> HashSet<String> {
    events
        .iter()
        .filter(|event| event.source == EventSource::User)
        .map(|event| event.id.clone())
        .collect()
}

fn timeline_source_order(source: &EventSource) -> u8 {
    match source {
        EventSource::User => 0,
        EventSource::Assistant => 1,
        EventSource::System => 2,
    }
}

/// Core event store for a single session.
pub struct EventStore {
    events: Vec<SessionEvent>,
    id_index: HashMap<String, usize>,
    call_id_index: HashMap<String, usize>,
    version: u64,
    streaming: bool,
    repo_id: Option<String>,
    repo_path: Option<String>,
    hydration_mode: HydrationMode,
    changed_ids: HashSet<String>,
    removed_ids: HashSet<String>,
    last_full_snapshot_version: u64,
}

impl Default for EventStore {
    fn default() -> Self {
        Self::new()
    }
}

impl EventStore {
    pub fn new() -> Self {
        Self {
            events: Vec::with_capacity(256),
            id_index: HashMap::with_capacity(256),
            call_id_index: HashMap::with_capacity(64),
            version: 0,
            streaming: false,
            repo_id: None,
            repo_path: None,
            hydration_mode: HydrationMode::Full,
            changed_ids: HashSet::new(),
            removed_ids: HashSet::new(),
            last_full_snapshot_version: 0,
        }
    }

    pub fn set_repo_context(&mut self, repo_id: Option<String>, repo_path: Option<String>) {
        self.repo_id = repo_id;
        self.repo_path = repo_path;
    }

    pub fn repo_id(&self) -> Option<&str> {
        self.repo_id.as_deref()
    }

    pub fn repo_path(&self) -> Option<&str> {
        self.repo_path.as_deref()
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    pub fn is_streaming(&self) -> bool {
        self.streaming
    }

    pub fn set_streaming(&mut self, streaming: bool) {
        self.streaming = streaming;
        if streaming && self.hydration_mode == HydrationMode::RoundWindow {
            self.hydration_mode = HydrationMode::LivePartial;
        }
    }

    pub fn hydration_mode(&self) -> HydrationMode {
        self.hydration_mode
    }

    pub fn mark_round_window(&mut self) {
        self.hydration_mode = HydrationMode::RoundWindow;
    }

    pub fn mark_full_hydration(&mut self) {
        self.hydration_mode = HydrationMode::Full;
    }

    fn mark_live_partial_if_windowed(&mut self) {
        if self.hydration_mode == HydrationMode::RoundWindow {
            self.hydration_mode = HydrationMode::LivePartial;
        }
    }

    pub fn should_emit_full_snapshot(&self) -> bool {
        self.last_full_snapshot_version == 0 || self.last_full_snapshot_version > self.version
    }

    pub fn mark_full_snapshot_emitted(&mut self) {
        self.last_full_snapshot_version = self.version;
        self.changed_ids.clear();
        self.removed_ids.clear();
    }

    pub fn take_delta_tracking(&mut self) -> (u64, Vec<String>, Vec<String>) {
        let base_version = self.last_full_snapshot_version;
        self.last_full_snapshot_version = self.version;
        let changed_ids = self.changed_ids.drain().collect();
        let removed_ids = self.removed_ids.drain().collect();
        (base_version, changed_ids, removed_ids)
    }

    fn mark_changed(&mut self, id: impl Into<String>) {
        self.changed_ids.insert(id.into());
    }

    fn mark_removed(&mut self, id: impl Into<String>) {
        let id = id.into();
        self.changed_ids.remove(&id);
        self.removed_ids.insert(id);
    }

    pub fn events(&self) -> &[SessionEvent] {
        &self.events
    }

    pub fn last_event(&self) -> Option<&SessionEvent> {
        self.events.last()
    }

    pub fn get_by_id(&self, id: &str) -> Option<&SessionEvent> {
        self.id_index.get(id).map(|&idx| &self.events[idx])
    }

    /// Replace all events (session load / clear).
    pub fn set(&mut self, events: Vec<SessionEvent>) {
        self.set_with_hydration(events, HydrationMode::Full);
    }

    pub fn set_round_window(&mut self, events: Vec<SessionEvent>) {
        self.set_with_hydration(events, HydrationMode::RoundWindow);
    }

    fn set_with_hydration(&mut self, mut events: Vec<SessionEvent>, hydration_mode: HydrationMode) {
        reconcile_loaded_synthetic_transcript_placeholders(&mut events);
        self.events = events;
        self.hydration_mode = hydration_mode;
        self.cap_events();
        self.rebuild_indexes();
        self.version += 1;
        self.last_full_snapshot_version = 0;
        self.changed_ids.clear();
        self.removed_ids.clear();
    }

    /// Append events, deduplicating by ID.
    /// Auto-stamps repo context on events that don't already carry one.
    pub fn append(&mut self, new_events: Vec<SessionEvent>) {
        if new_events.is_empty() {
            return;
        }
        self.mark_live_partial_if_windowed();
        let mut changed = false;
        for mut event in new_events {
            if self.id_index.contains_key(&event.id) {
                continue;
            }
            self.stamp_repo(&mut event);
            if is_authoritative_transcript_message(&event) {
                self.remove_matching_synthetic_transcript_placeholders(&event);
            }
            let event_id = event.id.clone();
            let idx = self.events.len();
            self.insert_index_entries(&event, idx);
            self.events.push(event);
            self.mark_changed(event_id);
            changed = true;
        }
        if !changed {
            return;
        }
        self.cap_events();
        self.version += 1;
    }

    /// Update a single event by ID via a patch. O(1) lookup.
    pub fn update_by_id(&mut self, id: &str, patch: &SessionEventPatch) -> bool {
        if let Some(&idx) = self.id_index.get(id) {
            patch.apply_to(&mut self.events[idx]);
            self.mark_changed(id.to_string());
            self.version += 1;
            true
        } else {
            false
        }
    }

    /// Upsert: update existing event by ID, or append if not found.
    pub fn upsert(&mut self, mut event: SessionEvent) {
        self.mark_live_partial_if_windowed();
        self.stamp_repo(&mut event);
        if self.replace_matching_stream_placeholder(&mut event) {
            self.version += 1;
            return;
        }
        if self.replace_duplicate_stream_transcript_in_current_turn(&mut event) {
            self.version += 1;
            return;
        }

        if let Some(&idx) = self.id_index.get(&event.id) {
            if Self::would_downgrade_terminal_tool_call(&self.events[idx], &event) {
                return;
            }
            if let Some(ref old_cid) = self.events[idx].call_id {
                self.call_id_index.remove(old_cid);
            }
            if let Some(ref new_cid) = event.call_id {
                self.call_id_index.insert(new_cid.clone(), idx);
            }
            let event_id = event.id.clone();
            self.events[idx] = event;
            self.mark_changed(event_id);
        } else {
            if is_authoritative_transcript_message(&event) {
                self.remove_matching_synthetic_transcript_placeholders(&event);
            }
            let event_id = event.id.clone();
            let idx = self.events.len();
            self.insert_index_entries(&event, idx);
            self.events.push(event);
            self.mark_changed(event_id);
            self.cap_events();
        }
        self.version += 1;
    }

    /// Merge incoming events into the store:
    /// - tool_result events are merged into their matching tool_call via call_id (O(1))
    /// - Existing IDs are updated in place
    /// - New IDs are appended
    ///
    /// When merging tool_result into tool_call:
    /// - Result is taken from tool_result
    /// - Args are preserved from original tool_call (start event has args, end has result)
    /// - Display status updated to Completed
    pub fn merge_events(&mut self, incoming: Vec<SessionEvent>) {
        self.merge_events_with_hydration(incoming, true);
    }

    fn remove_turn_placeholders_for_turns(&mut self, turn_ids: &HashSet<String>) -> usize {
        if turn_ids.is_empty() {
            return 0;
        }
        let removed_ids: Vec<String> = self
            .events
            .iter()
            .filter(|event| {
                is_turn_placeholder(event)
                    && placeholder_turn_id(event).is_some_and(|turn_id| turn_ids.contains(turn_id))
            })
            .map(|event| event.id.clone())
            .collect();
        let removed = removed_ids.len();
        if removed > 0 {
            self.events.retain(|event| !removed_ids.contains(&event.id));
            for event_id in removed_ids {
                self.mark_removed(event_id);
            }
            self.rebuild_indexes();
            self.version += 1;
        }
        removed
    }

    fn sort_round_window_events_by_timeline(&mut self) {
        self.events.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| {
                    timeline_source_order(&left.source).cmp(&timeline_source_order(&right.source))
                })
                .then_with(|| left.id.cmp(&right.id))
        });
        self.rebuild_indexes();
    }

    pub fn merge_round_window_events(&mut self, incoming: Vec<SessionEvent>) {
        let loaded_turn_ids = loaded_turn_ids_from_events(&incoming);
        self.remove_turn_placeholders_for_turns(&loaded_turn_ids);
        self.merge_events_with_hydration(incoming, false);
        self.sort_round_window_events_by_timeline();
    }

    fn merge_events_with_hydration(&mut self, incoming: Vec<SessionEvent>, mark_live: bool) {
        if incoming.is_empty() {
            return;
        }
        if mark_live {
            self.mark_live_partial_if_windowed();
        }
        let mut changed = false;
        for mut event in incoming {
            self.stamp_repo(&mut event);
            if event.action_type == "tool_result" {
                if let Some(ref call_id) = event.call_id {
                    if let Some(&call_idx) = self.call_id_index.get(call_id) {
                        let target = &mut self.events[call_idx];
                        if target.action_type == "tool_call" {
                            // Merge result from tool_result event.
                            //
                            // Interactive tools (`ask_user_questions`, etc.)
                            // emit an early structured result (e.g.
                            // `{status, answers, content}`) via
                            // `agent:interaction_finalized`. A later generic
                            // `agent:tool_result` from `on_tool_result` only
                            // carries `{content, observation}`. A full replace
                            // would wipe the structured fields and leave the
                            // UI stuck on "waiting for your answer", so we
                            // merge keys when both sides are objects.
                            target.result =
                                match (std::mem::take(&mut target.result), event.result.clone()) {
                                    (
                                        serde_json::Value::Object(mut existing),
                                        serde_json::Value::Object(incoming),
                                    ) => {
                                        for (k, v) in incoming {
                                            existing.insert(k, v);
                                        }
                                        serde_json::Value::Object(existing)
                                    }
                                    (_, incoming) => incoming,
                                };
                            target.activity_status = ActivityStatus::Processed;
                            target.display_status = EventDisplayStatus::Completed;

                            // Preserve args from tool_call, but merge in any additional
                            // fields from tool_result's args (rare, but may contain metadata).
                            // Also remove streamOutput which is only for running state.
                            if let (
                                serde_json::Value::Object(ref mut target_args),
                                serde_json::Value::Object(ref result_args),
                            ) = (&mut target.args, &event.args)
                            {
                                // Add any new keys from result args (but target's existing keys win)
                                for (key, value) in result_args {
                                    if !target_args.contains_key(key) {
                                        target_args.insert(key.clone(), value.clone());
                                    }
                                }
                                target_args.remove("streamOutput");
                            }

                            // Propagate file_path and command from tool_result if missing on target
                            if target.file_path.is_none() && event.file_path.is_some() {
                                target.file_path = event.file_path;
                            }
                            if target.command.is_none() && event.command.is_some() {
                                target.command = event.command;
                            }

                            // Refresh extracted so derived fields (resultContent,
                            // success, subagentSessionId, etc.) reflect the merged
                            // result immediately in the next snapshot.
                            target.recompute_extracted();
                            let target_id = target.id.clone();
                            self.mark_changed(target_id);

                            changed = true;
                            continue;
                        }
                    }
                }
            }

            if let Some(&idx) = self.id_index.get(&event.id) {
                if Self::would_downgrade_terminal_tool_call(&self.events[idx], &event) {
                    continue;
                }
                if let Some(ref old_cid) = self.events[idx].call_id {
                    self.call_id_index.remove(old_cid);
                }
                if let Some(ref new_cid) = event.call_id {
                    self.call_id_index.insert(new_cid.clone(), idx);
                }
                let event_id = event.id.clone();
                self.events[idx] = event;
                self.mark_changed(event_id);
                changed = true;
            } else {
                if is_authoritative_transcript_message(&event) {
                    self.remove_matching_synthetic_transcript_placeholders(&event);
                }
                let event_id = event.id.clone();
                let idx = self.events.len();
                self.insert_index_entries(&event, idx);
                self.events.push(event);
                self.mark_changed(event_id);
                changed = true;
            }
        }
        if changed {
            self.cap_events();
            self.version += 1;
        }
    }

    /// Complete the last event with `display_status == Running`.
    ///
    /// Scans from the end for O(1) typical case. Returns the ID of the
    /// completed event, if any.
    ///
    /// **`AwaitingUser` events are intentionally skipped.** They represent
    /// interactive tool calls (`ask_user_questions`, etc.) blocking the
    /// agent turn for arbitrary user-input duration; only the explicit
    /// `agent:interaction_finalized` path (via `merge_events`) is allowed
    /// to transition them to `Completed`. Treating them as generic
    /// "running" events here was the cause of the AskQuestionCard
    /// disappearing the moment `agent:complete` arrived for the surrounding
    /// turn.
    pub fn complete_last_running(&mut self) -> Option<String> {
        for idx in (0..self.events.len()).rev() {
            if self.events[idx].display_status == EventDisplayStatus::Running {
                self.events[idx].display_status = EventDisplayStatus::Completed;
                let event_id = self.events[idx].id.clone();
                self.mark_changed(event_id.clone());
                self.version += 1;
                return Some(event_id);
            }
        }
        None
    }

    /// Mark all in-flight streaming placeholders as finalized.
    ///
    /// TS-side delta accumulation creates placeholder events with
    /// `is_delta = Some(true)`. When the agent transitions from text
    /// streaming to tool execution, those placeholders must be flipped
    /// to `is_delta = Some(false)` **before** the tool_call event is
    /// pushed, so the `es:changed` snapshot already carries the correct
    /// state and the frontend never renders a stale `StreamingCursor`.
    pub fn finalize_streaming_events(&mut self) -> bool {
        let mut changed_ids = Vec::new();
        for event in &mut self.events {
            if event.is_delta == Some(true) {
                event.is_delta = Some(false);
                if event.display_status == EventDisplayStatus::Running {
                    event.display_status = EventDisplayStatus::Completed;
                }
                changed_ids.push(event.id.clone());
            }
        }
        if changed_ids.is_empty() {
            return false;
        }
        for event_id in changed_ids {
            self.mark_changed(event_id);
        }
        self.version += 1;
        true
    }

    /// Cancel all orphan interactive tool calls that are still `AwaitingUser`.
    ///
    /// Called by `es_load_from_cache` after loading events from SQLite.  When
    /// the Rust process restarts the `QuestionManager` loses its in-memory state,
    /// so any `AwaitingUser` event whose session is no longer live is a zombie:
    /// the user can see the card but clicking it will fail because the backend
    /// has no corresponding pending entry to answer.
    ///
    /// This method transitions those events directly to `Completed` and stamps
    /// a minimal `result` so `extractQuestionBatch` (FE) sees `displayStatus ==
    /// "completed"` and never renders a card for them.
    ///
    /// Returns the IDs of the cancelled events so callers can log / assert.
    pub fn cancel_orphan_interactive_events(&mut self) -> Vec<String> {
        let mut cancelled = Vec::new();
        for event in self.events.iter_mut() {
            if event.display_status == EventDisplayStatus::AwaitingUser {
                event.display_status = EventDisplayStatus::Completed;
                // Stamp a minimal result so extractQuestionBatch treats it as
                // answered (it checks result.success and result.error; a plain
                // cancelled status string is sufficient to skip rendering).
                event.result = serde_json::json!({
                    "status": "cancelled",
                    "content": "Session restarted — question was cancelled.",
                    "observation": "Session restarted — question was cancelled.",
                });
                cancelled.push(event.id.clone());
            }
        }
        if !cancelled.is_empty() {
            for event_id in &cancelled {
                self.mark_changed(event_id.clone());
            }
            self.version += 1;
        }
        cancelled
    }

    /// Batch-update multiple events by their IDs with the same patch.
    /// Returns the number of events updated.
    pub fn patch_by_ids(&mut self, ids: &[String], patch: &SessionEventPatch) -> usize {
        let mut count = 0;
        for id in ids {
            if let Some(&idx) = self.id_index.get(id) {
                patch.apply_to(&mut self.events[idx]);
                count += 1;
            }
        }
        if count > 0 {
            for id in ids {
                self.mark_changed(id.clone());
            }
            self.version += 1;
        }
        count
    }

    /// Keep only events that appear strictly before the event with the given ID.
    ///
    /// Finds the position of `event_id` in the ordered event list, then truncates
    /// everything from that position onward. If the ID is not found, the store is
    /// left unchanged and `false` is returned.
    ///
    /// Used by the "edit user message" flow to atomically splice the local event
    /// list without a round-trip get-then-set, eliminating the race where agent
    /// events could arrive between the TS-side read and write.
    pub fn truncate_before_id(&mut self, event_id: &str) -> bool {
        match self.id_index.get(event_id) {
            Some(&idx) => {
                let removed_ids: Vec<String> = self.events[idx..]
                    .iter()
                    .map(|event| event.id.clone())
                    .collect();
                self.events.truncate(idx);
                for removed_id in removed_ids {
                    self.mark_removed(removed_id);
                }
                self.rebuild_indexes();
                self.version += 1;
                true
            }
            None => false,
        }
    }

    pub fn unload_turn_body(&mut self, turn_id: &str, placeholder: SessionEvent) -> usize {
        let next_turn_id = placeholder_next_turn_id(&placeholder).map(str::to_string);
        let placeholder_id = placeholder.id.clone();
        let start_idx = self.events.iter().position(|event| event.id == turn_id);
        let Some(start_idx) = start_idx else {
            return 0;
        };

        let end_idx = next_turn_id
            .as_deref()
            .and_then(|next_id| {
                self.events
                    .iter()
                    .enumerate()
                    .skip(start_idx + 1)
                    .find_map(|(index, event)| (event.id == next_id).then_some(index))
            })
            .unwrap_or(self.events.len());

        let mut removed = 0usize;
        let mut removed_ids = Vec::new();
        let mut inserted_placeholder = false;
        let mut next_events = Vec::with_capacity(self.events.len());

        for (index, event) in self.events.drain(..).enumerate() {
            let in_turn_body_range = index > start_idx && index < end_idx;
            if in_turn_body_range && event.id != placeholder_id && !is_turn_placeholder(&event) {
                removed += 1;
                removed_ids.push(event.id);
                continue;
            }
            if is_turn_placeholder(&event) && placeholder_turn_id(&event) == Some(turn_id) {
                if !inserted_placeholder {
                    next_events.push(placeholder.clone());
                    inserted_placeholder = true;
                }
                continue;
            }
            next_events.push(event);
            if index == start_idx && !inserted_placeholder {
                next_events.push(placeholder.clone());
                inserted_placeholder = true;
            }
        }

        self.events = next_events;
        if removed > 0 || inserted_placeholder {
            self.mark_round_window();
            for event_id in removed_ids {
                self.mark_removed(event_id);
            }
            self.mark_changed(placeholder.id.clone());
            self.rebuild_indexes();
            self.version += 1;
        }
        removed
    }

    /// Remove events whose IDs match a given prefix.
    /// Returns the number of events removed.
    pub fn remove_by_id_prefix(&mut self, prefix: &str) -> usize {
        let removed_ids: Vec<String> = self
            .events
            .iter()
            .filter(|event| event.id.starts_with(prefix))
            .map(|event| event.id.clone())
            .collect();
        let removed = removed_ids.len();
        if removed > 0 {
            self.events.retain(|e| !e.id.starts_with(prefix));
            for event_id in removed_ids {
                self.mark_removed(event_id);
            }
            self.rebuild_indexes();
            self.version += 1;
        }
        removed
    }

    /// Remove frontend-injected transcript placeholders after authoritative
    /// backend transcript events arrive.
    ///
    /// IDs and function names are not stable across providers. The stable
    /// distinction is provenance: synthetic placeholders carry a frontend-only
    /// marker, while backend parser/runtime events do not. Matching is scoped to
    /// transcript source and normalized message text so legitimate repeated
    /// authoritative messages are preserved.
    fn remove_matching_synthetic_transcript_placeholders(
        &mut self,
        authoritative: &SessionEvent,
    ) -> usize {
        let Some(authoritative_key) = transcript_message_key(authoritative) else {
            return 0;
        };

        let removed_ids = self.matching_synthetic_transcript_placeholder_ids(&authoritative_key);
        self.remove_events_by_ids(removed_ids)
    }

    fn matching_synthetic_transcript_placeholder_ids(
        &self,
        authoritative_key: &(EventSource, String),
    ) -> Vec<String> {
        self.events
            .iter()
            .filter(|event| {
                is_synthetic_transcript_placeholder(event)
                    && transcript_message_key(event).as_ref() == Some(authoritative_key)
            })
            .map(|event| event.id.clone())
            .collect()
    }

    fn remove_events_by_ids(&mut self, removed_ids: Vec<String>) -> usize {
        let removed = removed_ids.len();
        if removed == 0 {
            return 0;
        }

        let removed_id_set: HashSet<String> = removed_ids.iter().cloned().collect();
        self.events
            .retain(|event| !removed_id_set.contains(&event.id));
        for event_id in removed_ids {
            self.mark_removed(event_id);
        }
        self.rebuild_indexes();
        self.version += 1;
        removed
    }

    pub fn remove_synthetic_user_inputs(&mut self) -> usize {
        let removed_ids: Vec<String> = self
            .events
            .iter()
            .filter(|event| {
                event.source == EventSource::User && is_synthetic_transcript_placeholder(event)
            })
            .map(|event| event.id.clone())
            .collect();
        let removed = removed_ids.len();
        if removed > 0 {
            self.events.retain(|event| {
                !(event.source == EventSource::User && is_synthetic_transcript_placeholder(event))
            });
            for event_id in removed_ids {
                self.mark_removed(event_id);
            }
            self.rebuild_indexes();
            self.version += 1;
        }
        removed
    }

    fn replace_duplicate_stream_transcript_in_current_turn(
        &mut self,
        new_event: &mut SessionEvent,
    ) -> bool {
        if !is_completed_authoritative_stream_transcript(new_event) {
            return false;
        }
        let new_text = normalized_event_text(new_event);
        let current_turn_start = self
            .events
            .iter()
            .rposition(|event| event.source == EventSource::User)
            .map(|index| index + 1)
            .unwrap_or(0);
        let Some(existing_idx) = self.events[current_turn_start..]
            .iter()
            .position(|event| {
                is_completed_authoritative_stream_transcript(event)
                    && event.display_variant == new_event.display_variant
                    && normalized_event_text(event) == new_text
            })
            .map(|offset| current_turn_start + offset)
        else {
            return false;
        };

        let existing_created_at = self.events[existing_idx].created_at.clone();
        new_event.created_at = existing_created_at;
        if let Some(ref old_cid) = self.events[existing_idx].call_id {
            self.call_id_index.remove(old_cid);
        }
        if let Some(ref new_cid) = new_event.call_id {
            self.call_id_index.insert(new_cid.clone(), existing_idx);
        }
        let old_id = self.events[existing_idx].id.clone();
        let new_id = new_event.id.clone();
        self.events[existing_idx] = new_event.clone();
        if old_id != new_id {
            self.mark_removed(old_id);
        }
        self.mark_changed(new_id);
        self.rebuild_indexes();
        true
    }

    fn replace_matching_stream_placeholder(&mut self, new_event: &mut SessionEvent) -> bool {
        let placeholder_prefix = match stream_placeholder_prefix_for_authoritative(&new_event.id) {
            Some(prefix) => prefix,
            None => return false,
        };
        let display_text = new_event.display_text.trim();
        if display_text.is_empty() {
            return false;
        }

        let placeholder_idx = self.events.iter().position(|event| {
            event.id.starts_with(placeholder_prefix)
                && event.display_text.trim() == display_text
                && event.action_type == new_event.action_type
        });
        let Some(idx) = placeholder_idx else {
            return false;
        };

        let placeholder_created_at = self.events[idx].created_at.clone();
        new_event.created_at = placeholder_created_at;

        if let Some(existing_new_idx) = self.id_index.get(&new_event.id).copied() {
            if existing_new_idx != idx {
                let removed_id = self.events[idx].id.clone();
                self.events.remove(idx);
                let target_idx = if existing_new_idx > idx {
                    existing_new_idx - 1
                } else {
                    existing_new_idx
                };
                let new_id = new_event.id.clone();
                self.events[target_idx] = new_event.clone();
                self.mark_removed(removed_id);
                self.mark_changed(new_id);
                self.rebuild_indexes();
                return true;
            }
        }

        if let Some(ref old_cid) = self.events[idx].call_id {
            self.call_id_index.remove(old_cid);
        }
        let new_id = new_event.id.clone();
        let old_id = self.events[idx].id.clone();
        self.events[idx] = new_event.clone();
        if old_id != new_id {
            self.mark_removed(old_id);
        }
        self.mark_changed(new_id);
        self.rebuild_indexes();
        true
    }

    /// Replace a single event by ID, and remove another by ID atomically.
    /// Used for stream finalization: remove the streaming placeholder, insert final event.
    pub fn replace_and_remove(
        &mut self,
        remove_id: Option<&str>,
        mut new_event: SessionEvent,
    ) -> bool {
        self.stamp_repo(&mut new_event);
        if let Some(rid) = remove_id {
            if let Some(&remove_idx) = self.id_index.get(rid) {
                let placeholder_created_at = self.events[remove_idx].created_at.clone();

                if let Some(existing_new_idx) = self.id_index.get(&new_event.id).copied() {
                    if existing_new_idx != remove_idx {
                        new_event.created_at = placeholder_created_at;
                        let removed_id = self.events[remove_idx].id.clone();
                        self.events.remove(remove_idx);
                        let target_idx = if existing_new_idx > remove_idx {
                            existing_new_idx - 1
                        } else {
                            existing_new_idx
                        };
                        let new_id = new_event.id.clone();
                        self.events[target_idx] = new_event;
                        self.mark_removed(removed_id);
                        self.mark_changed(new_id);
                        self.rebuild_indexes();
                        self.version += 1;
                        return true;
                    }
                }

                if let Some(ref old_cid) = self.events[remove_idx].call_id {
                    self.call_id_index.remove(old_cid);
                }
                new_event.created_at = placeholder_created_at;
                let new_id = new_event.id.clone();
                let removed_id = self.events[remove_idx].id.clone();
                self.events[remove_idx] = new_event;
                if removed_id != new_id {
                    self.mark_removed(removed_id);
                }
                self.mark_changed(new_id);
                self.rebuild_indexes();
                self.version += 1;
                return true;
            }
        }
        self.upsert(new_event);
        true
    }

    /// Update args on the last event matching a predicate (scanning from end).
    /// `merge_args` are shallow-merged into the event's existing `args` object.
    /// Returns the ID of the updated event, if found.
    pub fn update_last_matching_args<F>(
        &mut self,
        predicate: F,
        merge_args: serde_json::Value,
    ) -> Option<String>
    where
        F: Fn(&SessionEvent) -> bool,
    {
        for idx in (0..self.events.len()).rev() {
            if predicate(&self.events[idx]) {
                if let (
                    serde_json::Value::Object(ref mut existing),
                    serde_json::Value::Object(new),
                ) = (&mut self.events[idx].args, merge_args)
                {
                    for (key, value) in new {
                        existing.insert(key, value);
                    }
                }
                let event_id = self.events[idx].id.clone();
                self.mark_changed(event_id.clone());
                self.version += 1;
                return Some(event_id);
            }
        }
        None
    }

    /// Find the index of the last tool_call matching any of the given function names.
    /// Stops at a completed tool_result with the same name (no active call above it).
    /// Only returns a still-running spawning tool_call (display_status == Running).
    /// Used by subagent event handlers.
    pub fn find_last_spawning_tool(&self, function_names: &[&str]) -> Option<usize> {
        for idx in (0..self.events.len()).rev() {
            let event = &self.events[idx];
            if event.action_type == "tool_call"
                && function_names.contains(&event.function_name.as_str())
            {
                if event.display_status == EventDisplayStatus::Running {
                    return Some(idx);
                } else {
                    return None;
                }
            }
            if event.action_type == "tool_result"
                && function_names.contains(&event.function_name.as_str())
            {
                return None;
            }
        }
        None
    }

    /// Check if there is an active spawning tool_call in the store.
    pub fn has_active_spawning_tool(&self, function_names: &[&str]) -> bool {
        self.find_last_spawning_tool(function_names).is_some()
    }

    /// Update args on the last active spawning tool_call matching any of the given function names.
    /// Merges the provided args into the event's existing args.
    ///
    /// Also propagates the merge into every other tool_call event in the store
    /// that shares the same `call_id` (e.g. the frontend JS placeholder that was
    /// appended before the Rust-side `tool-call-{callId}` event arrived). This
    /// ensures fields like `subagentSessionId` are present on whichever copy the
    /// frontend ends up rendering after `es_load_from_cache`.
    ///
    /// Returns the event ID of the primary updated event if found.
    pub fn update_spawning_tool_args(
        &mut self,
        function_names: &[&str],
        merge_args: serde_json::Value,
    ) -> Option<String> {
        let idx = self.find_last_spawning_tool(function_names)?;

        if let (serde_json::Value::Object(ref mut existing), serde_json::Value::Object(ref new)) =
            (&mut self.events[idx].args, &merge_args)
        {
            for (key, value) in new {
                existing.insert(key.clone(), value.clone());
            }
        }
        self.events[idx].recompute_extracted();

        // Propagate to all same-callId siblings (e.g. JS placeholder events).
        let call_id = self.events[idx].call_id.clone();
        let primary_id = self.events[idx].id.clone();
        let mut changed_ids = vec![primary_id.clone()];
        if let (Some(call_id), serde_json::Value::Object(ref merge_obj)) = (call_id, &merge_args) {
            for event in self.events.iter_mut() {
                if event.id == primary_id {
                    continue;
                }
                if event.action_type != "tool_call" {
                    continue;
                }
                let matches = event
                    .call_id
                    .as_deref()
                    .map(|cid| cid == call_id)
                    .unwrap_or(false);
                if !matches {
                    continue;
                }
                if let serde_json::Value::Object(ref mut existing) = event.args {
                    for (key, value) in merge_obj {
                        existing.insert(key.clone(), value.clone());
                    }
                }
                event.recompute_extracted();
                changed_ids.push(event.id.clone());
            }
        }

        for event_id in changed_ids {
            self.mark_changed(event_id);
        }
        self.version += 1;
        Some(primary_id)
    }

    /// Update args on a specific tool_call identified by its LLM-assigned `call_id`.
    ///
    /// Unlike `update_spawning_tool_args` (which finds the "last running" spawning
    /// tool), this targets the exact event. This is critical for parallel subagent
    /// launches (`background: true`) where multiple spawning tool_calls may be in
    /// `Running` state simultaneously.
    ///
    /// Also propagates the merge to same-`call_id` siblings (JS placeholders).
    /// Returns the event ID of the primary updated event if found.
    pub fn update_tool_args_by_call_id(
        &mut self,
        call_id: &str,
        merge_args: serde_json::Value,
    ) -> Option<String> {
        let idx = self.events.iter().position(|event| {
            event.action_type == "tool_call"
                && event
                    .call_id
                    .as_deref()
                    .map(|cid| cid == call_id)
                    .unwrap_or(false)
        })?;

        if let (serde_json::Value::Object(ref mut existing), serde_json::Value::Object(ref new)) =
            (&mut self.events[idx].args, &merge_args)
        {
            for (key, value) in new {
                existing.insert(key.clone(), value.clone());
            }
        }
        self.events[idx].recompute_extracted();

        let primary_id = self.events[idx].id.clone();

        let mut changed_ids = vec![primary_id.clone()];
        // Propagate to all same-callId siblings (e.g. JS placeholder events).
        if let serde_json::Value::Object(ref merge_obj) = merge_args {
            for event in self.events.iter_mut() {
                if event.id == primary_id {
                    continue;
                }
                if event.action_type != "tool_call" {
                    continue;
                }
                let matches = event
                    .call_id
                    .as_deref()
                    .map(|cid| cid == call_id)
                    .unwrap_or(false);
                if !matches {
                    continue;
                }
                if let serde_json::Value::Object(ref mut existing) = event.args {
                    for (key, value) in merge_obj {
                        existing.insert(key.clone(), value.clone());
                    }
                }
                event.recompute_extracted();
                changed_ids.push(event.id.clone());
            }
        }

        for event_id in changed_ids {
            self.mark_changed(event_id);
        }
        self.version += 1;
        Some(primary_id)
    }

    /// Find the last shell tool_call event (scanning from end, stopping at processed shell).
    /// Update its args with the given streamOutput content.
    pub fn update_last_shell_output(
        &mut self,
        stream_output: String,
        shell_tools: &[&str],
    ) -> Option<String> {
        for idx in (0..self.events.len()).rev() {
            if self.events[idx].activity_status == ActivityStatus::Processed
                && shell_tools.contains(&self.events[idx].function_name.as_str())
            {
                break;
            }
            if self.events[idx].action_type == "tool_call"
                && shell_tools.contains(&self.events[idx].function_name.as_str())
            {
                if let serde_json::Value::Object(ref mut args_map) = self.events[idx].args {
                    args_map.insert(
                        "streamOutput".to_string(),
                        serde_json::Value::String(stream_output),
                    );
                }
                let event_id = self.events[idx].id.clone();
                self.mark_changed(event_id.clone());
                self.version += 1;
                return Some(event_id);
            }
        }
        None
    }

    /// Find the last shell tool_call event and update its process info (pid, status, exit code, log path).
    /// Used by ShellProcessStarted/Backgrounded/Exited events to populate TerminalBlock UI.
    ///
    /// Matching logic:
    /// - For "running" status (process started): find the last unprocessed shell tool_call
    ///   that has not yet been stamped with a `shellPid`.
    /// - For "background"/"exited"/"killed" status: match by PID (the event may already
    ///   carry `shellPid` from an earlier `running` event, and may be Processed for exits).
    pub fn update_last_shell_process(
        &mut self,
        pid: u32,
        status: &str,
        exit_code: Option<i32>,
        log_path: Option<&str>,
        shell_tools: &[&str],
    ) -> Option<String> {
        let match_by_pid = matches!(status, "background" | "exited" | "killed");

        for idx in (0..self.events.len()).rev() {
            if self.events[idx].action_type != "tool_call"
                || !shell_tools.contains(&self.events[idx].function_name.as_str())
            {
                continue;
            }

            // For PID-bound updates (background, exit), match by PID — the event
            // already carries `shellPid` from the prior `running` update and may
            // already be Processed for exits.
            // For "running" updates, find the first unprocessed shell tool_call.
            if match_by_pid {
                let event_pid = self.events[idx]
                    .args
                    .get("shellPid")
                    .and_then(|v| v.as_u64())
                    .map(|p| p as u32);
                if event_pid != Some(pid) {
                    continue;
                }
            } else if self.events[idx].activity_status == ActivityStatus::Processed {
                break;
            }

            // Found the target event, update it
            if let serde_json::Value::Object(ref mut args_map) = self.events[idx].args {
                args_map.insert(
                    "shellPid".to_string(),
                    serde_json::Value::Number(pid.into()),
                );
                args_map.insert(
                    "shellProcessStatus".to_string(),
                    serde_json::Value::String(status.to_string()),
                );
                if let Some(code) = exit_code {
                    args_map.insert(
                        "shellExitCode".to_string(),
                        serde_json::Value::Number(code.into()),
                    );
                }
                if let Some(path) = log_path {
                    args_map.insert(
                        "shellLogPath".to_string(),
                        serde_json::Value::String(path.to_string()),
                    );
                }
            }
            let event_id = self.events[idx].id.clone();
            self.mark_changed(event_id.clone());
            self.version += 1;
            return Some(event_id);
        }
        None
    }

    /// Clear all events (e.g., session switch to empty).
    pub fn clear(&mut self) {
        let removed_ids: Vec<String> = self.events.iter().map(|event| event.id.clone()).collect();
        self.events.clear();
        self.id_index.clear();
        self.call_id_index.clear();
        for event_id in removed_ids {
            self.mark_removed(event_id);
        }
        self.version += 1;
    }

    // =========================================================================
    /// Repair subagent linkage after a cache load.
    ///
    /// When a session is restored from SQLite it may contain two copies of the
    /// same `agent` tool_call: one with a JS-assigned id (no `subagentSessionId`)
    /// and one with a Rust-assigned `tool-call-{callId}` id (has the field).
    /// The stamp only went to the Rust copy; the JS copy still lacks it.
    ///
    /// This method finds every `agent` tool_call event that has a
    /// `subagentSessionId` in its args and propagates it to all other tool_call
    /// events sharing the same `call_id` that are missing it.  Call once after
    /// `set()` or `merge_events()` on cache-loaded data.
    pub fn repair_subagent_links(&mut self) -> bool {
        use std::collections::HashMap;

        let mut link_by_call_id: HashMap<String, serde_json::Value> = HashMap::new();

        for event in &self.events {
            if event.action_type != "tool_call" {
                continue;
            }
            let Some(ref call_id) = event.call_id else {
                continue;
            };
            let Some(sid) = event
                .args
                .as_object()
                .and_then(|m| m.get("subagentSessionId"))
                .cloned()
            else {
                continue;
            };
            link_by_call_id.insert(call_id.clone(), sid);
        }

        if link_by_call_id.is_empty() {
            return false;
        }

        let mut changed_ids = Vec::new();
        for event in self.events.iter_mut() {
            if event.action_type != "tool_call" {
                continue;
            }
            let Some(ref call_id) = event.call_id else {
                continue;
            };
            let Some(sid) = link_by_call_id.get(call_id) else {
                continue;
            };
            let already_set = event
                .args
                .as_object()
                .and_then(|m| m.get("subagentSessionId"))
                .is_some();
            if already_set {
                continue;
            }
            if let serde_json::Value::Object(ref mut args_map) = event.args {
                args_map.insert("subagentSessionId".to_string(), sid.clone());
                event.recompute_extracted();
                changed_ids.push(event.id.clone());
            }
        }

        if changed_ids.is_empty() {
            return false;
        }
        for event_id in changed_ids {
            self.mark_changed(event_id);
        }
        self.version += 1;
        true
    }

    // Internal
    // =========================================================================

    fn stamp_repo(&self, event: &mut SessionEvent) {
        if event.repo_id.is_none() {
            event.repo_id = self.repo_id.clone();
        }
        if event.repo_path.is_none() {
            event.repo_path = self.repo_path.clone();
        }
    }

    fn would_downgrade_terminal_tool_call(
        existing: &SessionEvent,
        incoming: &SessionEvent,
    ) -> bool {
        existing.action_type == "tool_call"
            && incoming.action_type == "tool_call"
            && matches!(
                existing.display_status,
                EventDisplayStatus::Completed | EventDisplayStatus::Failed
            )
            && matches!(
                incoming.display_status,
                EventDisplayStatus::Running
                    | EventDisplayStatus::Pending
                    | EventDisplayStatus::AwaitingUser
            )
    }

    fn insert_index_entries(&mut self, event: &SessionEvent, idx: usize) {
        self.id_index.insert(event.id.clone(), idx);
        if let Some(ref call_id) = event.call_id {
            if event.action_type == "tool_call" {
                self.call_id_index.insert(call_id.clone(), idx);
            }
        }
    }

    fn rebuild_indexes(&mut self) {
        self.id_index.clear();
        self.call_id_index.clear();
        for (idx, event) in self.events.iter().enumerate() {
            self.id_index.insert(event.id.clone(), idx);
            if let Some(ref call_id) = event.call_id {
                if event.action_type == "tool_call" {
                    self.call_id_index.insert(call_id.clone(), idx);
                }
            }
        }
    }

    fn cap_events(&mut self) {
        if self.events.len() > MAX_EVENTS {
            let drain_count = self.events.len() - MAX_EVENTS;
            let removed_ids: Vec<String> = self.events[..drain_count]
                .iter()
                .map(|event| event.id.clone())
                .collect();
            self.events.drain(..drain_count);
            for event_id in removed_ids {
                self.mark_removed(event_id);
            }
            self.rebuild_indexes();
        }
    }
}

fn stream_placeholder_prefix_for_authoritative(event_id: &str) -> Option<&'static str> {
    if event_id.starts_with("stream-think-") && !event_id.starts_with("stream-think-ts-") {
        return Some("stream-think-ts-");
    }
    if event_id.starts_with("stream-msg-") && !event_id.starts_with("stream-msg-ts-") {
        return Some("stream-msg-ts-");
    }
    None
}

#[cfg(test)]
#[path = "tests/store_tests.rs"]
mod tests;
