use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use core_types::activity::ActivityChunk;
use core_types::extracted::ExtractedData;
use database::db::get_connection;
use orgtrack_core::canonical::{
    ArtifactQuality, FileChangeRecord, SessionCheckpointRecord, SessionRecord,
    SOURCE_ORGII_CLI_SESSIONS, SOURCE_ORGII_RUST_AGENTS,
};
use orgtrack_core::edit_extraction::{artifacts_from_extracted_edit, final_diff_from_chunks, EditArtifactContext};
use orgtrack_core::policy::{source_tier_policy, TierSupport, SOURCE_CURSOR_IDE};
use orgtrack_core::privacy::ORGTRACK_SCHEMA_VERSION;
use orgtrack_core::repo_sync::paths::{path_hash, record_id};
use orgtrack_core::sources::cursor_ide::history as cursor_ide_history;
use orgtrack_core::store::{sqlite::SqliteRecordStore, RecordStore};

use crate::agent_sessions::event_pipeline::commands::event_conversion::{
    backfill_subagent_links, backfill_tool_inputs_from_messages, cached_event_to_session_event,
    dedup_by_call_id,
};
use crate::agent_sessions::event_pipeline::extractors::extract_event_data;
use crate::agent_sessions::event_pipeline::ingestion;
use crate::agent_sessions::event_pipeline::ingestion::types::RawActivityChunk;
use crate::agent_sessions::unified_stats::conversion::{
    os_session_to_aggregate_record, sde_session_to_aggregate_record, AgentMetadataResolver,
};
use crate::agent_sessions::unified_stats::orgtrack_adapter::upsert_aggregate_sessions;
use crate::orgtrack::extraction_scheduler::{
    evaluate_memory_gate, ExtractionMemoryDecision, ExtractionMemoryGateConfig,
};

static STARTED: AtomicBool = AtomicBool::new(false);
const STARTUP_DELAY: Duration = Duration::from_secs(20);
const IDLE_INTERVAL: Duration = Duration::from_secs(10 * 60);
const MAX_SESSIONS_PER_PASS: usize = 25;
const MAX_EVENTS_PER_SESSION: usize = 500;

#[derive(Debug, Clone, Default)]
struct AnalysisBackfillStats {
    scanned_sessions: usize,
    analyzed_sessions: usize,
    skipped_sessions: usize,
    failed_sessions: usize,
}

pub fn spawn_analysis_backfill_worker() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::Builder::new()
        .name("orgtrack-analysis-backfill".to_string())
        .spawn(|| {
            thread::sleep(STARTUP_DELAY);
            loop {
                let result = catch_unwind(AssertUnwindSafe(run_backfill_pass));
                match result {
                    Ok(Ok(stats)) => tracing::info!(
                        scanned_sessions = stats.scanned_sessions,
                        analyzed_sessions = stats.analyzed_sessions,
                        skipped_sessions = stats.skipped_sessions,
                        failed_sessions = stats.failed_sessions,
                        "[orgtrack_analysis] background analysis backfill pass completed"
                    ),
                    Ok(Err(err)) => tracing::warn!(
                        error = %err,
                        "[orgtrack_analysis] background analysis backfill pass failed"
                    ),
                    Err(_) => tracing::error!(
                        "[orgtrack_analysis] background analysis worker panicked; continuing after delay"
                    ),
                }
                thread::sleep(IDLE_INTERVAL);
            }
        })
        .map(|_| ())
        .unwrap_or_else(|err| {
            STARTED.store(false, Ordering::SeqCst);
            tracing::warn!(error = %err, "[orgtrack_analysis] failed to spawn analysis worker");
        });
}

fn run_backfill_pass() -> Result<AnalysisBackfillStats, String> {
    let mut stats = AnalysisBackfillStats::default();
    let memory_config = ExtractionMemoryGateConfig::default();
    hydrate_rust_agent_session_records()?;

    let conn = get_connection().map_err(|err| err.to_string())?;
    let store = SqliteRecordStore::new(&conn);
    let sessions = store.list_sessions(None)?;
    let existing_file_changes = store.list_file_changes(None)?;
    let sessions_with_file_changes = existing_file_changes
        .iter()
        .map(|change| change.session_id.as_str())
        .collect::<BTreeSet<_>>();
    let sessions_with_edit_artifacts = store
        .list_edit_artifacts(None, None)?
        .into_iter()
        .map(|artifact| artifact.session_id)
        .collect::<BTreeSet<_>>();

    for session in sessions.into_iter().take(MAX_SESSIONS_PER_PASS) {
        stats.scanned_sessions += 1;
        if should_pause(&memory_config) {
            break;
        }
        let needs_tier1 = !sessions_with_file_changes.contains(session.session_id.as_str());
        let needs_tier2 = !sessions_with_edit_artifacts.contains(&session.session_id);
        if !needs_tier1 && !needs_tier2 {
            stats.skipped_sessions += 1;
            continue;
        }
        if source_tier_policy(&session.source).tier2 == TierSupport::Unsupported {
            stats.skipped_sessions += 1;
            continue;
        }
        match catch_unwind(AssertUnwindSafe(|| analyze_session(&store, &session))) {
            Ok(Ok(true)) => stats.analyzed_sessions += 1,
            Ok(Ok(false)) => stats.skipped_sessions += 1,
            Ok(Err(err)) => {
                stats.failed_sessions += 1;
                tracing::warn!(
                    session_id = %session.session_id,
                    source = %session.source,
                    error = %err,
                    "[orgtrack_analysis] failed to analyze session"
                );
            }
            Err(_) => {
                stats.failed_sessions += 1;
                tracing::error!(
                    session_id = %session.session_id,
                    source = %session.source,
                    "[orgtrack_analysis] session analysis panicked; worker remains alive"
                );
            }
        }
    }
    Ok(stats)
}

fn should_pause(config: &ExtractionMemoryGateConfig) -> bool {
    matches!(
        evaluate_memory_gate(config).decision,
        ExtractionMemoryDecision::PauseSoft
            | ExtractionMemoryDecision::PauseHard
            | ExtractionMemoryDecision::PauseSystemMemory
    )
}

fn hydrate_rust_agent_session_records() -> Result<(), String> {
    let mut records = Vec::new();
    let mut resolver = AgentMetadataResolver::new();
    let sde_filter = agent_core::session::SessionListFilter {
        type_name: Some(agent_core::session::persistence::session_type::CODING.to_string()),
        ..Default::default()
    };
    for session in agent_core::session::persistence::list_sessions(&sde_filter)
        .map_err(|err| format!("Failed to list SDE Agent sessions for analysis hydration: {err}"))?
    {
        records.push(sde_session_to_aggregate_record(session, &mut resolver));
    }

    let org_member_filter = agent_core::session::SessionListFilter {
        type_name: Some(agent_core::session::persistence::session_type::ORG_MEMBER.to_string()),
        ..Default::default()
    };
    for session in agent_core::session::persistence::list_sessions(&org_member_filter).map_err(
        |err| format!("Failed to list Agent Org member sessions for analysis hydration: {err}"),
    )? {
        records.push(sde_session_to_aggregate_record(session, &mut resolver));
    }

    let os_filter = agent_core::session::SessionListFilter {
        type_name: Some(agent_core::session::persistence::session_type::DESKTOP.to_string()),
        ..Default::default()
    };
    for session in agent_core::session::persistence::list_sessions(&os_filter)
        .map_err(|err| format!("Failed to list OS Agent sessions for analysis hydration: {err}"))?
    {
        records.push(os_session_to_aggregate_record(session, &mut resolver));
    }

    upsert_aggregate_sessions(&records)
}

fn analyze_session(store: &SqliteRecordStore<'_>, session: &SessionRecord) -> Result<bool, String> {
    let events = load_analysis_events(session)?;
    if events.is_empty() {
        return Ok(false);
    }
    let edit_events = events
        .into_iter()
        .filter_map(|(event_id, extracted)| match extracted {
            ExtractedData::Edit(edit) => Some((event_id, edit)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if edit_events.is_empty() {
        return Ok(false);
    }
    store.delete_session_artifacts(&session.source, &session.session_id)?;

    let mut chunks_by_file: BTreeMap<String, Vec<orgtrack_core::canonical::SessionDiffChunkRecord>> =
        BTreeMap::new();
    let mut wrote_any = false;
    for (sequence_index, (event_id, edit)) in edit_events.into_iter().enumerate() {
        let context = EditArtifactContext {
            source: session.source.clone(),
            source_session_id: Some(session.source_session_id.clone()),
            session_id: session.session_id.clone(),
            source_event_id: Some(event_id.clone()),
            turn_id: None,
            sequence_index: sequence_index as i64,
            timestamp: None,
            workspace_path: session.workspace_path.clone(),
            metadata: session.metadata.clone(),
        };
        let artifacts = artifacts_from_extracted_edit(&context, &edit);
        for artifact in &artifacts.edits {
            store.upsert_edit_artifact(artifact)?;
            store.upsert_file_change(&FileChangeRecord {
                schema_version: ORGTRACK_SCHEMA_VERSION,
                record_id: record_id(&[
                    "analysis_file_change",
                    &artifact.source,
                    &artifact.session_id,
                    &artifact.record_id,
                ]),
                source: artifact.source.clone(),
                session_id: artifact.session_id.clone(),
                file_path: artifact.file_path.clone(),
                path_hash: path_hash(&artifact.file_path),
                function_name: None,
                node_type: None,
                start_line: artifact.start_line,
                end_line: artifact.end_line,
                lines_added: artifact.lines_added,
                lines_removed: artifact.lines_removed,
                timestamp: sequence_index as i64,
                tier: orgtrack_core::privacy::OrgtrackTier::Meta,
                metadata: artifact.metadata.clone(),
            })?;
            wrote_any = true;
        }
        for chunk in artifacts.chunks {
            chunks_by_file
                .entry(chunk.file_path.clone())
                .or_default()
                .push(chunk.clone());
            store.upsert_diff_chunk(&chunk)?;
        }
    }
    for (file_path, chunks) in chunks_by_file {
        if let Some(final_diff) = final_diff_from_chunks(&session.source, &session.session_id, &file_path, &chunks) {
            store.upsert_final_diff(&final_diff)?;
        }
    }
    if wrote_any {
        upsert_analysis_boundary_checkpoints(store, session)?;
    }
    Ok(wrote_any)
}

fn load_analysis_events(session: &SessionRecord) -> Result<Vec<(String, ExtractedData)>, String> {
    if session.source == SOURCE_CURSOR_IDE {
        return load_external_cursor_analysis_events(&session.session_id);
    }
    if session.source == SOURCE_ORGII_CLI_SESSIONS || session.source == SOURCE_ORGII_RUST_AGENTS {
        return load_orgii_replay_analysis_events(&session.session_id);
    }
    Ok(Vec::new())
}

fn load_orgii_replay_analysis_events(session_id: &str) -> Result<Vec<(String, ExtractedData)>, String> {
    let cached = session_persistence::load_events(session_id).map_err(|err| err.to_string())?;
    let mut events = cached
        .into_iter()
        .map(|event| cached_event_to_session_event(&event))
        .collect::<Vec<_>>();
    events = dedup_by_call_id(events);
    backfill_tool_inputs_from_messages(session_id, &mut events);
    backfill_subagent_links(session_id, &mut events);
    Ok(events
        .into_iter()
        .take(MAX_EVENTS_PER_SESSION)
        .filter_map(|event| extract_event_data(&event).map(|data| (event.id, data)))
        .collect())
}

fn load_external_cursor_analysis_events(session_id: &str) -> Result<Vec<(String, ExtractedData)>, String> {
    let chunks = cursor_ide_history::load_history_for_session(session_id)?;
    let raw_chunks = chunks.into_iter().map(activity_chunk_to_raw).collect::<Vec<_>>();
    let result = ingestion::ingest_raw_chunks(&raw_chunks, session_id);
    Ok(result
        .events
        .into_iter()
        .take(MAX_EVENTS_PER_SESSION)
        .filter_map(|event| extract_event_data(&event).map(|data| (event.id, data)))
        .collect())
}

fn activity_chunk_to_raw(chunk: ActivityChunk) -> RawActivityChunk {
    RawActivityChunk {
        chunk_id: Some(chunk.chunk_id),
        session_id: Some(chunk.session_id),
        action_type: Some(chunk.action_type),
        function: Some(chunk.function),
        args: Some(chunk.args),
        result: Some(chunk.result),
        created_at: Some(chunk.created_at),
        thread_id: chunk.thread_id,
        process_id: chunk.process_id,
        call_id: None,
    }
}

fn upsert_analysis_boundary_checkpoints(
    store: &SqliteRecordStore<'_>,
    session: &SessionRecord,
) -> Result<(), String> {
    let checkpoints = [
        ("start", 0_i64),
        ("latest", i64::MAX),
    ];
    for (kind, sequence_index) in checkpoints {
        store.upsert_session_checkpoint(&SessionCheckpointRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            checkpoint_id: record_id(&[
                "analysis_checkpoint",
                &session.source,
                &session.session_id,
                kind,
            ]),
            source: session.source.clone(),
            source_session_id: Some(session.source_session_id.clone()),
            session_id: session.session_id.clone(),
            sequence_index,
            source_event_id: None,
            turn_id: None,
            checkpoint_kind: orgtrack_core::canonical::CheckpointKind::Inferred,
            timestamp: None,
            affected_file_paths: Vec::new(),
            edit_record_ids: Vec::new(),
            quality: ArtifactQuality::Inferred,
            undo_supported: false,
            metadata_json: Some(serde_json::json!({
                "artifactClass": "analysis",
                "sourceCacheRole": "input_only",
            }).to_string()),
        })?;
    }
    Ok(())
}
