//! Derived computations for session events
//!
//! Rust port of the JS visibility filters (`isVisibleInChat`, `isVisibleInSimulator`,
//! `isVisibleInMessages`) and the full `compute_derived()` single-pass function
//! that produces a `DerivedSnapshot` without any intermediate allocations.

use std::{cmp::Ordering, collections::HashMap};

use crate::agent_sessions::event_pipeline::payload_compaction::compact_event_for_snapshot;
use crate::agent_sessions::event_pipeline::types::{
    DerivedSnapshot, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
    SimulatorEventPreview,
};
use agent_core::tools::names;

/// Tool function names that spawn subagents.
/// Running-state events for these tools are shown in Trajectory/Simulator so
/// users can see subagent progress before the spawning call completes.
const SPAWNING_TOOL_NAMES: &[&str] = &["agent", "task", "Task", "spawn_sub_agent", "subagent"];

/// Shell tool names whose running-state events should stay visible in the
/// Simulator so the COMMANDS panel shows live streamOutput while a command
/// executes.  Must mirror SHELL_TOOL_NAMES in TS visibilityFilters.ts.
const SHELL_TOOL_NAMES: &[&str] = &[
    "bash",
    "shell",
    "execute_command",
    "run_terminal_command",
    "terminal",
    "terminal_command",
    "run_shell",
];

const PLAN_EVENT_NAMES: &[&str] = &[names::CREATE_PLAN, names::PLAN_APPROVAL];

fn is_spawning_tool_call(event: &SessionEvent) -> bool {
    event.action_type == "tool_call" && SPAWNING_TOOL_NAMES.contains(&event.function_name.as_str())
}

fn is_shell_tool_call(event: &SessionEvent) -> bool {
    event.action_type == "tool_call" && SHELL_TOOL_NAMES.contains(&event.function_name.as_str())
}

fn is_plan_display_event(event: &SessionEvent) -> bool {
    PLAN_EVENT_NAMES.contains(&event.function_name.as_str())
}

/// Check if an event should be shown in the chat panel.
///
/// Mirrors JS `isVisibleInChat` from `normalizers.ts`.
pub fn is_visible_in_chat(event: &SessionEvent) -> bool {
    // NOTE: thinking deltas (is_delta=true, variant=Thinking) are now allowed
    // through so the chat panel can show a live streaming cursor while the
    // model reasons. The ThinkingEvent component already supports isStreaming.
    // Empty thinking deltas are still caught by the has_thinking_content
    // guard below.

    // Hide session start/end from chat
    if event.display_variant == EventDisplayVariant::Session {
        return false;
    }

    // Hide task lifecycle and stage errors from chat (no UI components)
    if matches!(
        event.action_type.as_str(),
        "task_start" | "task_completed" | "task_failed" | "stage_error"
    ) {
        return false;
    }

    // Hide standalone tool_result events
    if event.action_type == "tool_result" {
        return false;
    }

    // Hide user messages from failed turns. When an `agent:error` arrives the
    // frontend marks the preceding user message as `Failed`; the original text
    // stays in the store for audit / replay but should not appear in chat so
    // retries don't produce a wall of duplicate inputs.
    if event.source == EventSource::User && event.display_status == EventDisplayStatus::Failed {
        return false;
    }

    // Hide empty thinking events
    if event.display_variant == EventDisplayVariant::Thinking
        && !has_thinking_content(&event.result)
    {
        return false;
    }

    // Hide whitespace-only assistant messages
    if event.display_variant == EventDisplayVariant::Message
        && event.action_type == "assistant"
        && !has_visible_message_content(event)
    {
        return false;
    }

    true
}

/// Check if an event should be shown in the simulator.
///
/// Mirrors JS `isVisibleInSimulator` from `normalizers.ts`.
///
/// Spawning tool calls (agent, task, …) and shell tool calls are shown even
/// while Running so subagent progress and live command output are visible.
pub fn is_visible_in_simulator(event: &SessionEvent) -> bool {
    if event.is_delta == Some(true) {
        return false;
    }
    // AwaitingUser tool calls (interactive tools) must stay visible while
    // blocking the turn — they own the user-facing input surface. Same for
    // spawning tool calls (subagent progress) and shell tool calls (live
    // streamOutput while the command executes).
    if event.display_status == EventDisplayStatus::Running
        && !is_spawning_tool_call(event)
        && !is_shell_tool_call(event)
        && !is_plan_display_event(event)
    {
        return false;
    }
    matches!(
        event.display_variant,
        EventDisplayVariant::ToolCall
            | EventDisplayVariant::Thinking
            | EventDisplayVariant::Message
    )
}

/// Check if an event should be shown in the Messages app.
///
/// Same rules as [`is_visible_in_simulator`].
pub fn is_visible_in_messages(event: &SessionEvent) -> bool {
    if event.is_delta == Some(true) {
        return false;
    }
    if event.display_status == EventDisplayStatus::Running
        && !is_spawning_tool_call(event)
        && !is_shell_tool_call(event)
        && !is_plan_display_event(event)
    {
        return false;
    }
    matches!(
        event.display_variant,
        EventDisplayVariant::ToolCall
            | EventDisplayVariant::Thinking
            | EventDisplayVariant::Message
    )
}

pub struct SimulatorPreviewIndexes {
    pub sorted_simulator_event_ids: Vec<String>,
    pub event_preview_by_id: HashMap<String, SimulatorEventPreview>,
    pub created_at_by_id: HashMap<String, String>,
    pub thread_id_by_id: HashMap<String, String>,
    pub function_name_by_id: HashMap<String, String>,
    pub display_status_by_id: HashMap<String, String>,
    pub display_variant_by_id: HashMap<String, String>,
}

fn display_status_wire(status: &EventDisplayStatus) -> &'static str {
    match status {
        EventDisplayStatus::Running => "running",
        EventDisplayStatus::Completed => "completed",
        EventDisplayStatus::Failed => "failed",
        EventDisplayStatus::Pending => "pending",
        EventDisplayStatus::AwaitingUser => "awaiting_user",
    }
}

fn display_variant_wire(variant: &EventDisplayVariant) -> &'static str {
    match variant {
        EventDisplayVariant::ToolCall => "tool_call",
        EventDisplayVariant::Message => "message",
        EventDisplayVariant::Thinking => "thinking",
        EventDisplayVariant::Plan => "plan",
        EventDisplayVariant::Approval => "approval",
        EventDisplayVariant::Session => "session",
        EventDisplayVariant::Summary => "summary",
        EventDisplayVariant::Error => "error",
    }
}

pub fn build_simulator_preview_indexes(
    sorted_simulator_events: &[SessionEvent],
) -> SimulatorPreviewIndexes {
    build_simulator_preview_indexes_from_iter(
        sorted_simulator_events.iter(),
        sorted_simulator_events.len(),
    )
}

fn build_simulator_preview_indexes_from_iter<'a>(
    sorted_simulator_events: impl Iterator<Item = &'a SessionEvent>,
    event_count: usize,
) -> SimulatorPreviewIndexes {
    let mut sorted_simulator_event_ids = Vec::with_capacity(event_count);
    let mut event_preview_by_id = HashMap::with_capacity(event_count);
    let mut created_at_by_id = HashMap::with_capacity(event_count);
    let mut thread_id_by_id = HashMap::new();
    let mut function_name_by_id = HashMap::with_capacity(event_count);
    let mut display_status_by_id = HashMap::with_capacity(event_count);
    let mut display_variant_by_id = HashMap::with_capacity(event_count);

    for event in sorted_simulator_events {
        sorted_simulator_event_ids.push(event.id.clone());
        event_preview_by_id.insert(event.id.clone(), SimulatorEventPreview::from(event));
        created_at_by_id.insert(event.id.clone(), event.created_at.clone());
        if let Some(thread_id) = &event.thread_id {
            thread_id_by_id.insert(event.id.clone(), thread_id.clone());
        }
        function_name_by_id.insert(event.id.clone(), event.function_name.clone());
        display_status_by_id.insert(
            event.id.clone(),
            display_status_wire(&event.display_status).to_string(),
        );
        display_variant_by_id.insert(
            event.id.clone(),
            display_variant_wire(&event.display_variant).to_string(),
        );
    }

    SimulatorPreviewIndexes {
        sorted_simulator_event_ids,
        event_preview_by_id,
        created_at_by_id,
        thread_id_by_id,
        function_name_by_id,
        display_status_by_id,
        display_variant_by_id,
    }
}

/// Compute all derived data in a single pass over the events.
///
/// Produces `DerivedSnapshot` containing:
/// - `chat_events` (filtered + sorted by createdAt)
/// - `simulator_events` (filtered)
/// - `messages_events` (filtered)
/// - `sorted_events` (simulator events sorted by createdAt then id)
/// - `last_event`
/// - `event_index` (id → index in events vec)
pub fn compute_derived(events: &[SessionEvent], version: u64) -> DerivedSnapshot {
    let event_count = events.len();
    let mut compacted_events = Vec::with_capacity(event_count);
    let mut chat_event_indexes = Vec::with_capacity(event_count / 2);
    let mut simulator_event_indexes = Vec::with_capacity(event_count / 2);
    let mut messages_event_indexes = Vec::with_capacity(event_count / 2);
    let mut event_index = HashMap::with_capacity(event_count);
    let mut has_running_event = false;

    for (idx, event) in events.iter().enumerate() {
        event_index.insert(event.id.clone(), idx);

        if event.display_status == EventDisplayStatus::Running {
            has_running_event = true;
        }

        if is_visible_in_chat(event) {
            chat_event_indexes.push(idx);
        }
        if is_visible_in_simulator(event) {
            simulator_event_indexes.push(idx);
        }
        if is_visible_in_messages(event) {
            messages_event_indexes.push(idx);
        }

        compacted_events.push(compact_event_for_snapshot(event));
    }

    let mut chat_events = chat_event_indexes
        .iter()
        .map(|idx| compacted_events[*idx].clone())
        .collect::<Vec<_>>();
    sort_if_unsorted(&mut chat_events);

    let mut sorted_simulator_events = simulator_event_indexes
        .iter()
        .map(|idx| compacted_events[*idx].clone())
        .collect::<Vec<_>>();
    sort_simulator_events(&mut sorted_simulator_events);

    let messages_events = messages_event_indexes
        .iter()
        .map(|idx| compacted_events[*idx].clone())
        .collect::<Vec<_>>();

    let chat_event_count = chat_events.len();
    let last_event = compacted_events.last().cloned();
    let preview_indexes = build_simulator_preview_indexes(&sorted_simulator_events);

    DerivedSnapshot {
        version,
        event_count,
        events: compacted_events,
        chat_events,
        messages_events,
        sorted_simulator_events,
        sorted_simulator_event_ids: preview_indexes.sorted_simulator_event_ids,
        event_preview_by_id: preview_indexes.event_preview_by_id,
        created_at_by_id: preview_indexes.created_at_by_id,
        thread_id_by_id: preview_indexes.thread_id_by_id,
        function_name_by_id: preview_indexes.function_name_by_id,
        display_status_by_id: preview_indexes.display_status_by_id,
        display_variant_by_id: preview_indexes.display_variant_by_id,
        last_event,
        event_index,
        chat_event_count,
        has_running_event,
    }
}

// =========================================================================
// Helpers
// =========================================================================

fn has_thinking_content(result: &serde_json::Value) -> bool {
    let obj = match result.as_object() {
        Some(obj) => obj,
        None => return false,
    };

    for key in &["thought", "content", "observation"] {
        if let Some(serde_json::Value::String(text)) = obj.get(*key) {
            if !text.trim().is_empty() {
                return true;
            }
        }
    }
    false
}

fn has_visible_message_content(event: &SessionEvent) -> bool {
    if let Some(obj) = event.result.as_object() {
        for key in &["content", "observation"] {
            if let Some(serde_json::Value::String(text)) = obj.get(*key) {
                if !text.trim().is_empty() {
                    return true;
                }
            }
        }
    }
    !event.display_text.trim().is_empty()
}

fn is_turn_summary_event(event: &SessionEvent) -> bool {
    event.display_variant == EventDisplayVariant::Summary
        || event.function_name == "turn_summary"
        || event.ui_canonical == "turn_summary"
}

fn chat_sort_rank(event: &SessionEvent) -> u8 {
    if is_turn_summary_event(event) {
        return 1;
    }
    0
}

fn chat_sort_cmp(a: &SessionEvent, b: &SessionEvent) -> Ordering {
    a.created_at
        .cmp(&b.created_at)
        .then_with(|| chat_sort_rank(a).cmp(&chat_sort_rank(b)))
        .then_with(|| a.id.cmp(&b.id))
}

/// Sort events by chat timeline order only if the array is not already sorted.
pub(crate) fn sort_if_unsorted(events: &mut [SessionEvent]) {
    if events.len() <= 1 {
        return;
    }
    let needs_sort = events
        .windows(2)
        .any(|pair| chat_sort_cmp(&pair[0], &pair[1]) == Ordering::Greater);
    if needs_sort {
        events.sort_by(chat_sort_cmp);
    }
}

/// Sort simulator events by createdAt then id, skipping if already sorted.
pub(crate) fn sort_simulator_events(events: &mut [SessionEvent]) {
    if events.len() <= 1 {
        return;
    }
    let needs_sort = events.windows(2).any(|pair| {
        let ord = pair[0].created_at.cmp(&pair[1].created_at);
        ord == std::cmp::Ordering::Greater
            || (ord == std::cmp::Ordering::Equal && pair[0].id > pair[1].id)
    });
    if needs_sort {
        events.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
    }
}

#[cfg(test)]
#[path = "tests/derived_tests.rs"]
mod tests;
