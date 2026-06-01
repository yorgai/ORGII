//! Ingestion Pipeline Commands
//!
//! Raw chunk ingestion: consolidate → normalize → merge tool calls → store.

use tauri::{AppHandle, State};

use crate::agent_sessions::event_pipeline::ingestion;
use crate::agent_sessions::event_pipeline::ingestion::types::{IngestionResult, RawActivityChunk};
use crate::agent_sessions::event_pipeline::types::SessionEvent;

use super::{schedule_notify, EventStoreState};

/// Ingest raw activity chunks through the full pipeline:
/// consolidate → normalize → merge tool calls → store.
#[tauri::command]
pub async fn es_ingest_chunks(
    app: AppHandle,
    state: State<'_, EventStoreState>,
    session_id: String,
    chunks: Vec<RawActivityChunk>,
) -> Result<IngestionResult, String> {
    let result = ingestion::ingest_raw_chunks(&chunks, &session_id);
    state.with_store_mut(&session_id, |store| store.append(result.events.clone()));
    schedule_notify(&app, &state, &session_id);
    Ok(result)
}

/// Process raw activity chunks through the full pipeline (consolidate → normalize →
/// merge tool calls) WITHOUT storing in the EventStore.
#[tauri::command]
pub async fn es_process_chunks(
    session_id: String,
    chunks: Vec<RawActivityChunk>,
) -> Result<IngestionResult, String> {
    Ok(ingestion::ingest_raw_chunks(&chunks, &session_id))
}

/// Normalize a single raw chunk without consolidation (for streaming path).
#[tauri::command]
pub async fn es_normalize_chunk(
    session_id: String,
    chunk: RawActivityChunk,
) -> Result<SessionEvent, String> {
    Ok(ingestion::normalize_single(&chunk, &session_id))
}
