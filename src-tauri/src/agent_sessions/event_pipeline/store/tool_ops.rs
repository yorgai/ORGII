//! Tool-call specific operations for `EventStore`.
//!
//! Covers finding active spawning tools and propagating arg updates to
//! same-`call_id` sibling events (e.g. JS placeholder events).

use super::EventStore;
use crate::agent_sessions::event_pipeline::types::{ActivityStatus, EventDisplayStatus};

impl EventStore {
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

    /// Flip a still-running spawning tool_call (matched by `call_id`) to a
    /// terminal `display_status`. Used when a background subagent finishes:
    /// its parent `agent` tool_call never receives a `tool_result` (the launch
    /// message returned synchronously at spawn), so without this its
    /// `display_status` stays `Running` forever — stranding the SubagentBlock
    /// spinner and leaving the Stop button live on a finished card.
    ///
    /// Only transitions events still in `Running` (idempotent / safe against a
    /// later real tool_result merge). `success = false` maps to `Failed`,
    /// otherwise `Completed`. Returns the event IDs of updated tool_calls.
    pub fn complete_tool_call_by_call_id(&mut self, call_id: &str, success: bool) -> Vec<String> {
        let mut changed_ids = Vec::new();
        for event in self.events.iter_mut() {
            let matches = event.action_type == "tool_call"
                && event.display_status == EventDisplayStatus::Running
                && event.call_id.as_deref() == Some(call_id);
            if !matches {
                continue;
            }

            event.display_status = if success {
                EventDisplayStatus::Completed
            } else {
                EventDisplayStatus::Failed
            };
            event.activity_status = ActivityStatus::Processed;
            event.recompute_extracted();
            changed_ids.push(event.id.clone());
        }

        if changed_ids.is_empty() {
            return changed_ids;
        }
        for event_id in &changed_ids {
            self.mark_changed(event_id.clone());
        }
        self.version += 1;
        changed_ids
    }
}
