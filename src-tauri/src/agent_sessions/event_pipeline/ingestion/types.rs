//! Raw activity chunk types received from the frontend.
//!
//! These mirror the TypeScript `ActivityChunk` interface and are the input
//! to the Rust ingestion pipeline which normalizes them into `SessionEvent`.

use serde::{Deserialize, Serialize};

/// Raw activity chunk from the frontend/WebSocket/adapter.
///
/// This is the *unnormalized* shape that arrives from various sources
/// (Cursor CLI, SDE Agent, OS Agent, cloud sessions). The ingestion
/// pipeline converts these into `SessionEvent` with consistent field names.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RawActivityChunk {
    pub chunk_id: Option<String>,
    pub session_id: Option<String>,
    pub action_type: Option<String>,
    pub function: Option<String>,
    pub args: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub created_at: Option<String>,
    pub thread_id: Option<String>,
    pub process_id: Option<String>,
    /// Some backends attach call_id at the top level
    pub call_id: Option<String>,
}

/// Result of the full ingestion pipeline: normalized + consolidated + merged.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestionResult {
    /// Normalized, consolidated, tool-call-merged events ready for the EventStore.
    pub events: Vec<crate::agent_sessions::event_pipeline::types::SessionEvent>,
    /// Number of raw chunks received
    pub raw_count: usize,
    /// Number of events after processing (may be fewer due to consolidation)
    pub processed_count: usize,
    /// Number of chunks filtered as empty/invalid
    pub filtered_count: usize,
}
