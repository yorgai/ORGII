//! Unified subagent event handler — shared by all delegate tools and subagent spawners.
//!
//! Provides a single `UnifiedSubagentHandler` plus a thin `BroadcastingHandler`
//! wrapper that all subagent invocations route through, so:
//!   - frontend gets the same Tauri IPC events for every subagent type
//!   - tool calls/results land in SQLite via one persistence path
//!   - the child session's `EventStore` receives live ingestion (multi-session)
//!   - `AwaitTool` (`wait_for` / `monitor`) can tail background subagent output
//!
//! The implementation is split by concern across sibling modules:
//!
//! | submodule          | concern                                                        |
//! |--------------------|----------------------------------------------------------------|
//! | `parent_stamp`     | stamp `subagentSessionId` / `elapsedMs` on parent tool_call    |
//! | `lifecycle`        | `broadcast_complete` / `broadcast_error` finalization          |
//! | `persistence`      | SQLite tool call/result writes + child status + cache hydrate  |
//! | `store`            | live `EventStore` push, pin/unpin LRU, streaming flag toggle   |
//! | `events`           | `SessionEvent` builders + `flush_streaming` placeholder swap   |
//! | `turn_handler`     | `impl TurnEventHandler for UnifiedSubagentHandler`             |
//! | `broadcasting`     | `BroadcastingHandler` wrapper + its `TurnEventHandler` impl    |

mod broadcasting;
mod events;
mod lifecycle;
mod parent_stamp;
mod persistence;
mod store;
mod turn_handler;

use crate::foundation::streaming::StreamingBuffer;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;

pub use broadcasting::BroadcastingHandler;

/// Configuration for creating a subagent handler.
#[derive(Debug, Clone)]
pub struct SubagentHandlerConfig {
    /// Parent session ID for correlating events in the frontend.
    pub parent_session_id: String,
    /// Unique ID for this subagent session.
    pub subagent_session_id: String,
    /// Short description of the task (3-5 words).
    pub description: String,
    /// Type of subagent: "memory", "project", "agent_def", "task", "sub_agent", etc.
    pub subagent_type: String,
    /// Optional agent name (for named sub-agents from Agent Orgs).
    pub agent_name: Option<String>,
    /// Optional instance number (for multiple instances of the same agent).
    pub instance_number: Option<u32>,
    /// The LLM-assigned tool_call_id on the parent's `agent` tool_call event.
    /// Used to stamp `subagentSessionId` onto the correct parent event when
    /// multiple subagents run in parallel (`background: true`).
    pub parent_call_id: Option<String>,
}

/// Unified subagent event handler.
///
/// Broadcasts events to the frontend (Tauri IPC Channel), persists tool
/// calls/results to the database, and pushes live `SessionEvent`s into the
/// child session's `EventStore` so the frontend can subscribe via
/// `es:changed` for real-time nested block rendering.
pub struct UnifiedSubagentHandler {
    pub(crate) config: SubagentHandlerConfig,
    started_at: Instant,
    tool_call_count: AtomicU32,
    /// When set, the handler pushes live SessionEvents into the child
    /// session's EventStore and manages pin/unpin lifecycle.
    app_handle: Option<tauri::AppHandle>,
    /// Per-child-session streaming buffer for message/thinking deltas. Mirrors
    /// the parent `UnifiedEventHandler` so the child's streaming text reaches
    /// the child EventStore live and gets persisted as one assistant
    /// segment per say-then-do boundary.
    streaming_buffer: StreamingBuffer,
}

impl UnifiedSubagentHandler {
    /// Create a new handler. Call `with_app_handle` to enable live
    /// EventStore ingestion for the child session.
    pub fn new(config: SubagentHandlerConfig) -> Self {
        Self {
            config,
            started_at: Instant::now(),
            tool_call_count: AtomicU32::new(0),
            app_handle: None,
            streaming_buffer: StreamingBuffer::with_default_timeout(),
        }
    }

    /// Convenience constructor for simple subagents (no agent name or instance number).
    pub fn simple(
        parent_session_id: String,
        subagent_session_id: String,
        description: String,
        subagent_type: String,
    ) -> Self {
        Self::new(SubagentHandlerConfig {
            parent_session_id,
            subagent_session_id,
            description,
            subagent_type,
            agent_name: None,
            instance_number: None,
            parent_call_id: None,
        })
    }

    /// Get the number of tool calls made during this subagent turn.
    pub fn tool_call_count(&self) -> u32 {
        self.tool_call_count.load(Ordering::Relaxed)
    }

    /// Get elapsed time since the handler was created.
    pub(super) fn elapsed_ms(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_types::session_event::EventDisplayStatus;

    #[test]
    fn test_handler_config() {
        let config = SubagentHandlerConfig {
            parent_session_id: "parent-123".to_string(),
            subagent_session_id: "sub-456".to_string(),
            description: "test task".to_string(),
            subagent_type: "test".to_string(),
            agent_name: Some("TestAgent".to_string()),
            instance_number: Some(1),
            parent_call_id: Some("tool_abc123".to_string()),
        };

        assert_eq!(config.parent_session_id, "parent-123");
        assert_eq!(config.agent_name, Some("TestAgent".to_string()));
    }

    #[test]
    fn test_simple_constructor() {
        let _handler = UnifiedSubagentHandler::simple(
            "parent".to_string(),
            "sub".to_string(),
            "desc".to_string(),
            "type".to_string(),
        );
    }

    #[test]
    fn test_build_tool_call_event_fields() {
        let handler = UnifiedSubagentHandler::simple(
            "parent-1".to_string(),
            "sub-2".to_string(),
            "test".to_string(),
            "test".to_string(),
        );
        let event = handler.build_tool_call_event(
            "call-42",
            "read_file",
            "Read File",
            &serde_json::json!({"path": "/tmp/foo"}),
        );
        assert_eq!(event.id, "tc-call-42");
        assert_eq!(event.session_id, "sub-2");
        assert_eq!(event.action_type, "tool_call");
        assert_eq!(event.call_id, Some("call-42".to_string()));
        assert_eq!(event.display_status, EventDisplayStatus::Running);
        assert!(event.extracted.is_some());
    }

    #[test]
    fn test_build_tool_result_event_fields() {
        let handler = UnifiedSubagentHandler::simple(
            "parent-1".to_string(),
            "sub-2".to_string(),
            "test".to_string(),
            "test".to_string(),
        );
        let event = handler.build_tool_result_event(
            "call-42",
            "read_file",
            "Read File",
            "file contents here",
        );
        assert_eq!(event.id, "tr-call-42");
        assert_eq!(event.session_id, "sub-2");
        assert_eq!(event.action_type, "tool_result");
        assert_eq!(event.call_id, Some("call-42".to_string()));
        assert_eq!(event.display_status, EventDisplayStatus::Completed);
    }
}
