use core_types::activity::ActivityChunk;
use database::db::get_connection;
use orgtrack_core::sources::cursor_ide::history::CURSORIDE_SESSION_PREFIX;
use orgtrack_core::sources::opencode::history as opencode_history;

use crate::agent_sessions::event_pipeline::ingestion::prompt_backfill;
use crate::agent_sessions::event_pipeline::types::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};

trait SessionProvider: Send + Sync {
    fn matches_session(&self, session_id: &str) -> bool;

    fn skips_event_cache_save(&self, _session_id: &str) -> bool {
        false
    }

    fn load_history_events(&self, _session_id: &str) -> Result<Vec<SessionEvent>, String> {
        Ok(Vec::new())
    }

    fn subagent_prompt(&self, _child_session_id: &str) -> Option<String> {
        None
    }

    fn imported_parent_session_id(
        &self,
        _parent_session_id: &str,
    ) -> Result<Option<String>, String> {
        Ok(None)
    }
}

struct CursorIdeProvider;

impl SessionProvider for CursorIdeProvider {
    fn matches_session(&self, session_id: &str) -> bool {
        session_id.starts_with(CURSORIDE_SESSION_PREFIX)
    }

    fn skips_event_cache_save(&self, _session_id: &str) -> bool {
        true
    }
}

struct OpenCodeProvider;

impl SessionProvider for OpenCodeProvider {
    fn matches_session(&self, session_id: &str) -> bool {
        session_id.starts_with("opencodeapp-")
    }

    fn load_history_events(&self, session_id: &str) -> Result<Vec<SessionEvent>, String> {
        let chunks = opencode_history::load_opencode_history_for_session(session_id)?;
        Ok(chunks.iter().map(activity_chunk_to_session_event).collect())
    }

    fn subagent_prompt(&self, child_session_id: &str) -> Option<String> {
        if !self.matches_session(child_session_id) {
            return None;
        }
        if let Ok(chunks) = opencode_history::load_opencode_history_for_session(child_session_id) {
            if let Some(prompt) = prompt_backfill::prompt_from_history_chunks(&chunks) {
                return Some(prompt);
            }
        }
        let conn = get_connection().ok()?;
        if let Ok(prompt) = conn.query_row(
            "SELECT user_input FROM code_sessions WHERE session_id = ?1 AND cli_agent_type = 'opencode'",
            [child_session_id],
            |row| row.get::<_, String>(0),
        ) {
            if let Some(prompt) = prompt_backfill::non_generic_subagent_prompt(prompt) {
                return Some(prompt);
            }
        }
        if let Ok(name) = conn.query_row(
            "SELECT name FROM imported_history_session_cache WHERE session_id = ?1 AND source = 'opencode'",
            [child_session_id],
            |row| row.get::<_, String>(0),
        ) {
            if let Some(name) = prompt_backfill::non_generic_subagent_prompt(name) {
                return Some(name);
            }
        }
        None
    }

    fn imported_parent_session_id(
        &self,
        parent_session_id: &str,
    ) -> Result<Option<String>, String> {
        if self.matches_session(parent_session_id) {
            return Ok(None);
        }
        let conn =
            get_connection().map_err(|err| format!("Failed to open CLI session DB: {err}"))?;
        match conn.query_row(
            "SELECT cli_session_id FROM code_sessions WHERE session_id = ?1 AND cli_agent_type = 'opencode'",
            [parent_session_id],
            |row| row.get::<_, Option<String>>(0),
        ) {
            Ok(Some(cli_session_id)) if !cli_session_id.trim().is_empty() => {
                Ok(Some(format!("opencodeapp-{}", cli_session_id.trim())))
            }
            Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(format!(
                "Failed to query OpenCode CLI session id for {parent_session_id}: {err}"
            )),
        }
    }
}

static PROVIDERS: &[&(dyn SessionProvider + Sync)] = &[&OpenCodeProvider, &CursorIdeProvider];

pub(crate) fn skips_event_cache_save(session_id: &str) -> bool {
    PROVIDERS.iter().any(|provider| {
        provider.matches_session(session_id) && provider.skips_event_cache_save(session_id)
    })
}

pub(crate) fn load_history_events(session_id: &str) -> Result<Vec<SessionEvent>, String> {
    let Some(provider) = PROVIDERS
        .iter()
        .find(|provider| provider.matches_session(session_id))
    else {
        return Ok(Vec::new());
    };
    provider.load_history_events(session_id)
}

pub(crate) fn subagent_prompt(child_session_id: &str) -> Option<String> {
    PROVIDERS
        .iter()
        .find(|provider| provider.matches_session(child_session_id))
        .and_then(|provider| provider.subagent_prompt(child_session_id))
}

pub(crate) fn imported_parent_session_ids(parent_session_id: &str) -> Result<Vec<String>, String> {
    let mut session_ids = Vec::new();
    for provider in PROVIDERS {
        if let Some(session_id) = provider.imported_parent_session_id(parent_session_id)? {
            session_ids.push(session_id);
        }
    }
    Ok(session_ids)
}

fn activity_chunk_to_session_event(chunk: &ActivityChunk) -> SessionEvent {
    let function_name = if chunk.function.is_empty() {
        chunk.action_type.clone()
    } else {
        chunk.function.clone()
    };
    SessionEvent {
        id: if chunk.chunk_id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            chunk.chunk_id.clone()
        },
        chunk_id: if chunk.chunk_id.is_empty() {
            None
        } else {
            Some(chunk.chunk_id.clone())
        },
        session_id: chunk.session_id.clone(),
        created_at: chunk.created_at.clone(),
        function_name: function_name.clone(),
        ui_canonical: function_name,
        action_type: chunk.action_type.clone(),
        args: chunk.args.clone(),
        result: chunk.result.clone(),
        source: EventSource::Assistant,
        display_text: format!("{}: {}", chunk.action_type, chunk.function),
        display_status: EventDisplayStatus::Completed,
        display_variant: EventDisplayVariant::ToolCall,
        activity_status: ActivityStatus::Processed,
        thread_id: chunk.thread_id.clone(),
        process_id: chunk.process_id.clone(),
        call_id: None,
        file_path: None,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    }
}
