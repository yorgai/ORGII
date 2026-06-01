//! Snapshot Commands
//!
//! Get full derived snapshot or raw events from a per-session store.

use core_types::session_event::EventSource;
use tauri::State;

use crate::agent_sessions::event_pipeline::derived::compute_derived;
use crate::agent_sessions::event_pipeline::types::{DerivedSnapshot, SessionEvent};

use super::EventStoreState;

/// Get the full derived snapshot for a session.
#[tauri::command]
pub async fn es_get_snapshot(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<DerivedSnapshot, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| {
            compute_derived(store.events(), store.version())
        })
        .unwrap_or_else(|| compute_derived(&[], 0)))
}

/// Get raw events for a session.
#[tauri::command]
pub async fn es_get_events(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<Vec<SessionEvent>, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| store.events().to_vec())
        .unwrap_or_default())
}

/// Serialize session conversation history as Markdown.
///
/// Only user messages and assistant (agent) messages are included.
/// Tool-call events are skipped — callers see a clean turn-by-turn
/// transcript that mirrors what the user read in the chat panel.
#[tauri::command]
pub async fn es_export_markdown(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<String, String> {
    let sid = state.resolve_session_id(session_id)?;
    let events = state
        .with_store_opt(&sid, |store| store.events().to_vec())
        .unwrap_or_default();

    let mut out = String::new();

    for event in &events {
        let text = event.display_text.trim();
        if text.is_empty() {
            continue;
        }
        match event.source {
            EventSource::User => {
                out.push_str("**User**\n\n");
                out.push_str(text);
                out.push_str("\n\n---\n\n");
            }
            EventSource::Assistant => {
                // Only emit genuine message events, not tool-call activities.
                if event.ui_canonical == "agent_message" {
                    out.push_str("**Assistant**\n\n");
                    out.push_str(text);
                    out.push_str("\n\n---\n\n");
                }
            }
            EventSource::System => {}
        }
    }

    Ok(out)
}
