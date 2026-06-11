//! EventStore — high-performance per-session event storage
//!
//! Stores events in a `Vec<SessionEvent>` with O(1) lookup via `HashMap<String, usize>`.
//! Each instance manages one session; the command layer in `commands/mod.rs` holds
//! a `HashMap<sessionId, EventStore>` for multi-session support and handles
//! batch-throttled `es:changed` notifications to the frontend.
//!
//! # Submodules
//!
//! - `helpers`   — Pure free functions (transcript dedup, placeholder detection, etc.)
//! - `hydration` — Bulk load / merge operations (`set`, `append`, `merge_events`, etc.)
//! - `event_ops` — Single-event CRUD, streaming finalization, shell stamping, clear
//! - `tool_ops`  — Tool-call specific operations (spawning tool find + arg propagation)
//! - `repair`    — Post-load repair (`repair_subagent_links`, `cancel_orphan_interactive_events`)
//! - `turn_ops`  — Turn window management (`unload_turn_body`)

use std::collections::{HashMap, HashSet};

use crate::agent_sessions::event_pipeline::types::SessionEvent;

mod event_ops;
mod helpers;
mod hydration;
mod repair;
mod tool_ops;
mod turn_ops;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HydrationMode {
    Full,
    RoundWindow,
    LivePartial,
}

/// Core event store for a single session.
pub struct EventStore {
    pub(super) events: Vec<SessionEvent>,
    pub(super) id_index: HashMap<String, usize>,
    pub(super) call_id_index: HashMap<String, usize>,
    pub(super) version: u64,
    pub(super) streaming: bool,
    pub(super) repo_id: Option<String>,
    pub(super) repo_path: Option<String>,
    pub(super) hydration_mode: HydrationMode,
    pub(super) changed_ids: HashSet<String>,
    pub(super) removed_ids: HashSet<String>,
    pub(super) last_full_snapshot_version: u64,
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

    // -------------------------------------------------------------------------
    // Repo context
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Version / snapshot tracking
    // -------------------------------------------------------------------------

    pub fn version(&self) -> u64 {
        self.version
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

    // -------------------------------------------------------------------------
    // Streaming / hydration mode
    // -------------------------------------------------------------------------

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

    pub(super) fn mark_live_partial_if_windowed(&mut self) {
        if self.hydration_mode == HydrationMode::RoundWindow {
            self.hydration_mode = HydrationMode::LivePartial;
        }
    }

    // -------------------------------------------------------------------------
    // Event accessors
    // -------------------------------------------------------------------------

    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    pub fn events(&self) -> &[SessionEvent] {
        &self.events
    }

    pub fn last_event(&self) -> Option<&SessionEvent> {
        self.events.last()
    }

    // -------------------------------------------------------------------------
    // Delta / change tracking (private)
    // -------------------------------------------------------------------------

    pub(super) fn mark_changed(&mut self, id: impl Into<String>) {
        self.changed_ids.insert(id.into());
    }

    pub(super) fn mark_removed(&mut self, id: impl Into<String>) {
        let id = id.into();
        self.changed_ids.remove(&id);
        self.removed_ids.insert(id);
    }

    // -------------------------------------------------------------------------
    // Index management (private)
    // -------------------------------------------------------------------------

    pub(super) fn insert_index_entries(&mut self, event: &SessionEvent, idx: usize) {
        self.id_index.insert(event.id.clone(), idx);
        if let Some(ref call_id) = event.call_id {
            if event.action_type == "tool_call" {
                self.call_id_index.insert(call_id.clone(), idx);
            }
        }
    }

    pub(super) fn rebuild_indexes(&mut self) {
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

    pub(super) fn cap_events(&mut self) {
        use helpers::MAX_EVENTS;
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

    pub(super) fn stamp_repo(&self, event: &mut SessionEvent) {
        if event.repo_id.is_none() {
            event.repo_id = self.repo_id.clone();
        }
        if event.repo_path.is_none() {
            event.repo_path = self.repo_path.clone();
        }
    }
}

#[cfg(test)]
#[path = "../tests/store_tests.rs"]
mod tests;
