//! Stamp parent-event metadata (subagent session id, elapsed time) so
//! `SubagentBlock` in the frontend can bind to its child session.

use super::UnifiedSubagentHandler;
use crate::bus::event_pipeline_bridge;

impl UnifiedSubagentHandler {
    /// Attach a Tauri `AppHandle` so the handler can push live events into
    /// the child session's `EventStore` and pin/unpin the session for LRU.
    /// Without this, events are only persisted to SQLite — historical
    /// replay still works, but the frontend won't get
    /// live `es:changed` notifications for the child session.
    ///
    /// Also flips the child store's `streaming` flag to `true` so subsequent
    /// per-delta `schedule_notify` calls get batched at `STREAMING_BATCH_MS`
    /// instead of firing a full `compute_derived` + IPC emit per token. This
    /// is what keeps the nested chat-in-chat smooth at 10 fps instead of
    /// drowning the webview in 30–50 snapshots/sec while the LLM streams.
    pub fn with_app_handle(mut self, handle: tauri::AppHandle) -> Self {
        self.app_handle = Some(handle.clone());
        self.stamp_subagent_session_id_on_parent(&handle);
        self.pin_child_session(&handle);
        self.set_child_streaming(&handle, true);
        self
    }

    /// Stamp `subagentSessionId` + `action: "delegate"` onto the parent
    /// session's still-running `agent` tool_call event so SubagentBlock can
    /// bind to the child session the instant it is spawned.
    ///
    /// Uses the write-through helper so the patched args are also persisted
    /// to SQLite — without this, reloading the parent session from cache
    /// would lose the child link.
    pub(super) fn stamp_subagent_session_id_on_parent(&self, handle: &tauri::AppHandle) {
        use crate::tools::names as tool_names;

        let merge_args = serde_json::json!({
            "subagentSessionId": self.config.subagent_session_id,
            "action": "delegate",
            "subagent_type": self.config.subagent_type,
            "description": self.config.description,
        });

        if let Some(ref call_id) = self.config.parent_call_id {
            let stamped = event_pipeline_bridge::update_tool_args_by_call_id(
                handle,
                &self.config.parent_session_id,
                call_id,
                merge_args.clone(),
            );
            if stamped.is_none() {
                tracing::warn!(
                    "[subagent] stamp by call_id '{}' missed for parent='{}', falling back to spawning-tool heuristic",
                    call_id,
                    self.config.parent_session_id
                );
                let fallback = event_pipeline_bridge::update_spawning_tool_args(
                    handle,
                    &self.config.parent_session_id,
                    &[tool_names::AGENT],
                    merge_args,
                );
                if fallback.is_none() {
                    tracing::warn!(
                        "[subagent] stamp fallback also missed for parent='{}', subagentSessionId='{}' will be missing in frontend",
                        self.config.parent_session_id,
                        self.config.subagent_session_id
                    );
                }
            }
        } else {
            let stamped = event_pipeline_bridge::update_spawning_tool_args(
                handle,
                &self.config.parent_session_id,
                &[tool_names::AGENT],
                merge_args,
            );
            if stamped.is_none() {
                tracing::warn!(
                    "[subagent] stamp (no call_id) missed for parent='{}', subagentSessionId='{}' will be missing in frontend",
                    self.config.parent_session_id,
                    self.config.subagent_session_id
                );
            }
        }
    }

    /// Stamp `elapsedMs` onto the parent session's spawning `agent` tool_call
    /// event so `SubagentAdapter` can read it from `args.elapsedMs`. This
    /// replaces the old WS `agent:subagent_complete` payload that carried the
    /// same field.
    ///
    /// Uses the write-through helper so the stamped elapsed time survives a
    /// reload from SQLite — otherwise the terminal snapshot of this tool_call
    /// event on disk would be missing the timing field that the UI renders
    /// under the subagent title.
    pub(super) fn stamp_elapsed_on_parent(&self) {
        let Some(ref handle) = self.app_handle else {
            return;
        };
        let merge_args = serde_json::json!({
            "elapsedMs": self.elapsed_ms(),
        });

        if let Some(ref call_id) = self.config.parent_call_id {
            event_pipeline_bridge::update_tool_args_by_call_id(
                handle,
                &self.config.parent_session_id,
                call_id,
                merge_args,
            );
        } else {
            use crate::tools::names as tool_names;
            event_pipeline_bridge::update_spawning_tool_args(
                handle,
                &self.config.parent_session_id,
                &[tool_names::AGENT],
                merge_args,
            );
        }
    }

    /// Flip the parent session's spawning `agent` tool_call from `running` to
    /// a terminal `display_status` when a **background** subagent finishes.
    ///
    /// A foreground subagent's parent tool_call is closed naturally by the
    /// turn executor merging its inline `tool_result`. But a background spawn
    /// returns its launch message synchronously at spawn time, so the parent
    /// `agent` tool_call never receives a `tool_result` — its `display_status`
    /// would stay `running` forever, leaving the SubagentBlock spinner turning
    /// and the Stop button live on a finished card (and re-arming on history
    /// re-render). This is the missing terminal write that pairs with
    /// `stamp_elapsed_on_parent`.
    ///
    /// Requires `parent_call_id`: without it we cannot target the exact event
    /// among possibly-many parallel background launches, and flipping "the last
    /// running agent tool_call" would race sibling spawns.
    pub(super) fn complete_parent_tool_call(&self, success: bool) {
        let Some(ref handle) = self.app_handle else {
            return;
        };
        let Some(ref call_id) = self.config.parent_call_id else {
            return;
        };
        event_pipeline_bridge::complete_tool_call_by_call_id(
            handle,
            &self.config.parent_session_id,
            call_id,
            success,
        );
    }
}
