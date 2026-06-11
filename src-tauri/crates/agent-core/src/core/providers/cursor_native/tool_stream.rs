//! Interaction-level tool-call streaming state.
//!
//! Tracks in-progress tool calls arriving on the interaction side-channel and
//! manages the mapping between Cursor's internal call IDs and ORGII's IDs.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::super::proto::agent_v1 as pb;
use super::super::tools::resolve_cursor_mcp_tool_name;
use crate::providers::traits::ToolCallRequest;
use crate::tools::names as tool_names;

#[derive(Clone)]
pub(super) struct InteractionToolStreamEntry {
    pub(super) orgii_call_id: String,
    pub(super) tool_name: Option<String>,
    pub(super) index: usize,
}

#[derive(Default)]
pub(super) struct InteractionToolStreamState {
    pub(super) entries_by_cursor_call_id: HashMap<String, InteractionToolStreamEntry>,
    pub(super) partial_orgii_call_ids: HashSet<String>,
    pub(super) next_index: usize,
}

/// Split a complete `ToolCallRequest` into argument delta chunks suitable for
/// streaming to the front-end.
///
/// For `create_plan` the title and content fields are flushed as two separate
/// deltas so the UI can progressively render both. All other tool calls produce
/// a single delta containing the full JSON-serialised arguments.
pub(super) fn complete_tool_call_argument_deltas(tool_call: &ToolCallRequest) -> Vec<String> {
    if tool_call.name == tool_names::CREATE_PLAN {
        let title = tool_call.arguments.get("title").and_then(Value::as_str);
        let content = tool_call.arguments.get("content").and_then(Value::as_str);
        if let (Some(title), Some(content)) = (title, content) {
            let encoded_title = serde_json::to_string(title)
                .expect("serializing create_plan title string cannot fail");
            let encoded_content = serde_json::to_string(content)
                .expect("serializing create_plan content string cannot fail");
            return vec![
                format!("{{\"title\":{encoded_title}"),
                format!(",\"content\":{encoded_content}}}"),
            ];
        }
    }

    vec![tool_call.arguments.to_string()]
}

impl InteractionToolStreamState {
    pub(super) fn register(&mut self, cursor_call_id: &str, tool_call: Option<&pb::ToolCall>) {
        let orgii_call_id = tool_call
            .and_then(super::interaction::extract_mcp_args)
            .map(|args| {
                if args.tool_call_id.is_empty() {
                    cursor_call_id.to_string()
                } else {
                    args.tool_call_id.clone()
                }
            })
            .unwrap_or_else(|| super::exec_bridge::cursor_tool_call_id(cursor_call_id));
        let tool_name = tool_call
            .and_then(super::interaction::extract_mcp_args)
            .map(|args| resolve_cursor_mcp_tool_name(&args.name, &args.tool_name));
        let index = self
            .entries_by_cursor_call_id
            .get(cursor_call_id)
            .map(|entry| entry.index)
            .unwrap_or_else(|| {
                let index = self.next_index;
                self.next_index += 1;
                index
            });
        self.entries_by_cursor_call_id.insert(
            cursor_call_id.to_string(),
            InteractionToolStreamEntry {
                orgii_call_id,
                tool_name,
                index,
            },
        );
    }

    pub(super) fn entry_for_cursor_call_id(
        &mut self,
        cursor_call_id: &str,
    ) -> InteractionToolStreamEntry {
        if !self.entries_by_cursor_call_id.contains_key(cursor_call_id) {
            self.register(cursor_call_id, None);
        }
        self.entries_by_cursor_call_id
            .get(cursor_call_id)
            .cloned()
            .expect("interaction tool stream entry registered")
    }

    pub(super) fn index_for_orgii_call_id(&mut self, orgii_call_id: &str) -> usize {
        if let Some(entry) = self
            .entries_by_cursor_call_id
            .values()
            .find(|entry| entry.orgii_call_id == orgii_call_id)
        {
            entry.index
        } else {
            let index = self.next_index;
            self.next_index += 1;
            index
        }
    }

    pub(super) fn mark_partial(&mut self, orgii_call_id: &str) {
        self.partial_orgii_call_ids
            .insert(orgii_call_id.to_string());
    }

    pub(super) fn has_emitted_partial(&self, orgii_call_id: &str) -> bool {
        self.partial_orgii_call_ids.contains(orgii_call_id)
    }
}
