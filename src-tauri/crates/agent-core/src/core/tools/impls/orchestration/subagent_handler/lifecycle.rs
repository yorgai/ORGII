//! Subagent run completion (`broadcast_complete` / `broadcast_error`).
//!
//! Both flush any in-flight streaming text, stamp `elapsedMs` onto the
//! parent's tool_call event, persist child events to SQLite, and unpin
//! the child session from the EventStore LRU.

use super::UnifiedSubagentHandler;

impl UnifiedSubagentHandler {
    /// Finalize a successful subagent run.
    pub fn broadcast_complete(&self) {
        self.flush_streaming();
        if let Some(ref handle) = self.app_handle {
            self.set_child_streaming(handle, false);
        }
        self.stamp_elapsed_on_parent();
        self.complete_parent_tool_call(true);
        self.update_child_session_status(crate::session::SessionStatus::Completed);
        self.persist_child_session_to_cache();
        self.unpin_child_session();
    }

    /// Finalize a failed subagent run.
    pub fn broadcast_error(&self) {
        self.flush_streaming();
        if let Some(ref handle) = self.app_handle {
            self.set_child_streaming(handle, false);
        }
        self.stamp_elapsed_on_parent();
        self.complete_parent_tool_call(false);
        self.update_child_session_status(crate::session::SessionStatus::Failed);
        self.persist_child_session_to_cache();
        self.unpin_child_session();
    }
}
