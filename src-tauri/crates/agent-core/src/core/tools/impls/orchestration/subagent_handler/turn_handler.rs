//! `TurnEventHandler` implementation for `UnifiedSubagentHandler`.

use super::UnifiedSubagentHandler;
use crate::turn_executor::TurnEventHandler;
use async_trait::async_trait;
use serde_json::Value;
use std::sync::atomic::Ordering;
use tracing::warn;

#[async_trait]
impl TurnEventHandler for UnifiedSubagentHandler {
    fn on_message_delta(&self, _session_id: &str, content: &str) {
        let sid = &self.config.subagent_session_id;
        self.streaming_buffer.append_message_delta(sid, content);
        let accumulated = self
            .streaming_buffer
            .get_content(crate::foundation::streaming::StreamType::Message, sid)
            .unwrap_or_default();
        let placeholder = self.build_streaming_placeholder_event(false, &accumulated);
        self.push_to_store(placeholder);
    }

    fn on_thinking_delta(&self, _session_id: &str, thinking: &str) {
        let sid = &self.config.subagent_session_id;
        self.streaming_buffer.append_thinking_delta(sid, thinking);
        let accumulated = self
            .streaming_buffer
            .get_content(crate::foundation::streaming::StreamType::Thinking, sid)
            .unwrap_or_default();
        let placeholder = self.build_streaming_placeholder_event(true, &accumulated);
        self.push_to_store(placeholder);
    }

    fn on_tool_call(
        &self,
        _session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        args: &Value,
    ) {
        self.tool_call_count.fetch_add(1, Ordering::Relaxed);

        // Flush any buffered streaming text/thinking before the tool call so
        // each say-then-do segment lands as its own authoritative event.
        self.flush_streaming();

        // 1. Persist to database (with subagentSessionId injected for
        //    parent-event linkage on replay).
        let args_with_sid = if let Value::Object(mut map) = args.clone() {
            map.insert(
                "subagentSessionId".to_string(),
                Value::String(self.config.subagent_session_id.clone()),
            );
            Value::Object(map)
        } else {
            args.clone()
        };
        let args_str = args_with_sid.to_string();
        self.persist_tool_call(tool_call_id, tool_name, &args_str);

        // 2. Push live SessionEvent into child session's EventStore.
        let event = self.build_tool_call_event(tool_call_id, tool_name, display_name, args);
        self.push_to_store(event);
    }

    fn on_tool_result(
        &self,
        _session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
    ) {
        // 1. Persist to database.
        self.persist_tool_result(tool_call_id, tool_name, result);

        // 2. Push tool_result event — EventStore's merge_events will fold it
        //    into the matching tool_call via call_id.
        let event = self.build_tool_result_event(tool_call_id, tool_name, display_name, result);
        self.push_to_store(event);
    }

    fn on_assistant_iteration_complete(
        &self,
        _session_id: &str,
        content: Option<&str>,
        _has_tool_calls: bool,
        model: &str,
    ) {
        // Flush any still-buffered streaming text into the child EventStore
        // so the authoritative `stream-msg-{sid}-N` segment replaces the
        // TS placeholder before the iteration ends.
        self.flush_streaming();

        let Some(text) = content else { return };
        if text.is_empty() {
            return;
        }
        if let Err(err) = crate::session::persistence::save_assistant_msg(
            &self.config.subagent_session_id,
            text,
            model,
        ) {
            warn!(
                "[subagent:{}] Failed to persist assistant iteration: {}",
                self.config.subagent_type, err
            );
        }
    }
}
