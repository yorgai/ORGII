//! Live `EventStore` integration for the child session: pushing events,
//! pin/unpin LRU lifecycle, and toggling the streaming-batch flag.

use super::UnifiedSubagentHandler;
use crate::bus::event_pipeline_bridge;
use core_types::session_event::SessionEvent;

impl UnifiedSubagentHandler {
    /// Push a `SessionEvent` into the child session's in-memory EventStore
    /// so `es:changed` fires for subscribers watching this session.
    pub(super) fn push_to_store(&self, event: SessionEvent) {
        let Some(ref handle) = self.app_handle else {
            return;
        };
        event_pipeline_bridge::push_events(handle, &self.config.subagent_session_id, vec![event]);
    }

    pub(super) fn pin_child_session(&self, handle: &tauri::AppHandle) {
        event_pipeline_bridge::pin_session(handle, &self.config.subagent_session_id);
    }

    /// Toggle the child store's streaming flag. While `true`, each
    /// `push_to_store` / `replace_and_remove` followed by `schedule_notify`
    /// is batched at `STREAMING_BATCH_MS`; flipping back to `false` on
    /// completion forces a final flush so the last segment lands immediately.
    pub(super) fn set_child_streaming(&self, handle: &tauri::AppHandle, streaming: bool) {
        event_pipeline_bridge::set_session_streaming(
            handle,
            &self.config.subagent_session_id,
            streaming,
        );
    }

    pub(super) fn unpin_child_session(&self) {
        let Some(ref handle) = self.app_handle else {
            return;
        };
        event_pipeline_bridge::unpin_session(handle, &self.config.subagent_session_id);
    }
}
