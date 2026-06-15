//! Rendering Data Extraction Commands
//!
//! Extract pre-computed rendering data and string processing utilities.

use tauri::State;

use crate::agent_sessions::event_pipeline::extractors;
use crate::agent_sessions::event_pipeline::extractors::extractors::strip_line_number_prefixes_pub;
use crate::agent_sessions::event_pipeline::extractors::ExtractedData;
use perf_utils::diff_patch::{convert_patch_to_unified, PatchConversionResult};

use super::EventStoreState;

/// Extract pre-computed rendering data for a single event by ID.
#[tauri::command]
pub async fn es_extract_event_data(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
    event_id: String,
) -> Result<Option<ExtractedData>, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| {
            store
                .get_by_id(&event_id)
                .and_then(extractors::extract_event_data)
        })
        .flatten())
}

/// Extract rendering data for all events in the target session's store.
/// Returns pairs of (event_id, ExtractedData).
#[tauri::command]
pub async fn es_extract_all_event_data(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<Vec<(String, ExtractedData)>, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| extractors::extract_batch(store.events()))
        .unwrap_or_default())
}

/// Extract rendering data for a bounded event window.
#[tauri::command]
pub async fn es_extract_event_data_window(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
    offset: usize,
    limit: usize,
) -> Result<Vec<(String, ExtractedData)>, String> {
    let sid = state.resolve_session_id(session_id)?;
    let bounded_limit = limit.clamp(1, 250);
    Ok(state
        .with_store_opt(&sid, |store| {
            let events = store.events();
            if offset >= events.len() {
                return Vec::new();
            }
            let end = offset.saturating_add(bounded_limit).min(events.len());
            extractors::extract_batch(&events[offset..end])
        })
        .unwrap_or_default())
}

// ============================================================================
// String Processing Commands
// ============================================================================

/// Strip line number prefixes (e.g. "  1→content") from file content.
#[tauri::command]
pub async fn es_strip_line_prefixes(content: String) -> Result<String, String> {
    Ok(strip_line_number_prefixes_pub(&content))
}

/// Convert apply_patch format to unified diff.
#[tauri::command]
pub async fn es_convert_patch_to_diff(patch_text: String) -> Result<PatchConversionResult, String> {
    Ok(convert_patch_to_unified(patch_text))
}
