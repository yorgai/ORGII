//! Turn window management for `EventStore`.
//!
//! Handles unloading turn bodies (replacing a turn's events with a placeholder)
//! and related turn-ID queries used by the round-window pagination path.

use super::helpers::{is_turn_placeholder, placeholder_next_turn_id, placeholder_turn_id};
use super::EventStore;
use crate::agent_sessions::event_pipeline::types::SessionEvent;

impl EventStore {
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
}
