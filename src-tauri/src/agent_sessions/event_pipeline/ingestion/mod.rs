//! Event Ingestion Pipeline
//!
//! Converts raw `RawActivityChunk` data from frontends/adapters into
//! normalized `SessionEvent` objects ready for the EventStore.
//!
//! ## Pipeline Stages
//!
//! 1. **Consolidation** (`consolidator`) — merge streaming thinking/message
//!    deltas into single chunks; filter empty/invalid; deduplicate.
//! 2. **Normalization** (`normalizer`) — convert each chunk to `SessionEvent`
//!    with canonical function names, display hints, and metadata extraction.
//! 3. **Tool Call Merging** (`tool_call_merger`) — pair tool_call start/end
//!    events sharing the same `call_id` into unified events.
//!
//! ## Usage
//!
//! ```ignore
//! use crate::agent_sessions::event_pipeline::ingestion::{ingest_raw_chunks, types::RawActivityChunk};
//!
//! let events = ingest_raw_chunks(&raw_chunks, "session-123");
//! // events is Vec<SessionEvent> ready for EventStore.append / buffer
//! ```

pub mod consolidator;
pub mod function_map;
pub mod normalizer;
pub mod prompt_backfill;
pub mod tool_call_merger;
pub mod types;

use crate::agent_sessions::event_pipeline::types::SessionEvent;
use types::{IngestionResult, RawActivityChunk};

/// Run the full ingestion pipeline: consolidate → normalize → merge tool calls.
pub fn ingest_raw_chunks(chunks: &[RawActivityChunk], session_id: &str) -> IngestionResult {
    ingest_raw_chunks_with_prompt_resolver(
        chunks,
        session_id,
        prompt_backfill::opencode_subagent_prompt,
    )
}

pub fn ingest_raw_chunks_with_prompt_resolver(
    chunks: &[RawActivityChunk],
    session_id: &str,
    prompt_for_child: impl FnMut(&str) -> Option<String>,
) -> IngestionResult {
    let raw_count = chunks.len();

    // Stage 1: Consolidate (merge deltas, filter empty, dedup)
    let consolidated = consolidator::consolidate_activity_chunks(chunks);
    let filtered_count = raw_count.saturating_sub(consolidated.len());

    // Stage 2: Normalize to SessionEvent
    let events = normalizer::normalize_chunks(&consolidated, session_id);

    // Stage 3: Merge tool call start/end pairs
    let mut merged = tool_call_merger::merge_tool_call_pairs(events);
    prompt_backfill::backfill_opencode_subagent_prompts_with_resolver(
        &mut merged,
        prompt_for_child,
    );

    IngestionResult {
        processed_count: merged.len(),
        events: merged,
        raw_count,
        filtered_count,
    }
}

/// Normalize a single chunk without consolidation (for streaming path).
pub fn normalize_single(chunk: &RawActivityChunk, session_id: &str) -> SessionEvent {
    normalizer::normalize_chunk(chunk, session_id)
}
