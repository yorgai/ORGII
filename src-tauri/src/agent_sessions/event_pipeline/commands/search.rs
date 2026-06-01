//! Chat Search Commands
//!
//! In-memory search for chat-visible events in a per-session EventStore.

use tauri::State;

use crate::agent_sessions::event_pipeline::search::{ChatSearchOptions, ChatSearchResult};

use super::EventStoreState;

/// Search chat-visible events in a session's EventStore (in-memory, no SQLite).
#[tauri::command]
pub async fn es_search_chat_events(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
    options: ChatSearchOptions,
) -> Result<Vec<ChatSearchResult>, String> {
    let sid = state.resolve_session_id(session_id)?;
    let chat_events: Vec<_> = state
        .with_store_opt(&sid, |store| {
            store
                .events()
                .iter()
                .filter(|e| crate::agent_sessions::event_pipeline::derived::is_visible_in_chat(e))
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(crate::agent_sessions::event_pipeline::search::search_chat_events(&chat_events, &options))
}
