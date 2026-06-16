pub mod analysis_backfill;
pub mod exporter;
pub mod extraction_scheduler;
pub mod history_commands;
pub mod importer;
pub mod paths;
pub mod types;

use std::path::PathBuf;

use database::db::get_connection;
use orgtrack_core::canonical::{
    CommitLinkRecord, SessionCheckpointFileStateRecord, SessionCheckpointRecord,
    SessionDiffChunkRecord, SessionEditArtifactRecord, SessionFinalDiffRecord,
};
use orgtrack_core::policy::{source_tier_policy, SourceTierPolicy};
use orgtrack_core::privacy::ORGTRACK_SCHEMA_VERSION;
use orgtrack_core::projectors::stats::{session_summaries, CoreSessionSummary};
use orgtrack_core::repo_sync::paths::record_id;
use orgtrack_core::store::{sqlite::SqliteRecordStore, RecordStore};
use types::OrgtrackTier;

#[tauri::command]
pub async fn orgtrack_initialize(
    repo_path: String,
    tier: Option<String>,
    allow_raw_trajectory: Option<bool>,
) -> Result<types::OrgtrackExportResult, String> {
    let tier = validate_tier(tier.as_deref(), allow_raw_trajectory)?;
    tokio::task::spawn_blocking(move || {
        exporter::initialize_orgtrack(&PathBuf::from(repo_path), tier)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_scan_start(
    repo_path: String,
    tier: Option<String>,
    allow_raw_trajectory: Option<bool>,
    resume: Option<bool>,
    rebuild: Option<bool>,
) -> Result<types::OrgtrackScanProgress, String> {
    let tier = validate_tier(tier.as_deref(), allow_raw_trajectory)?;
    exporter::start_orgtrack_scan(types::OrgtrackScanOptions {
        repo_path,
        tier,
        allow_raw_trajectory: allow_raw_trajectory.unwrap_or(false),
        resume: resume.unwrap_or(true),
        rebuild: rebuild.unwrap_or(false),
    })
}

#[tauri::command]
pub async fn orgtrack_scan_status(
    repo_path: String,
) -> Result<Option<types::OrgtrackScanProgress>, String> {
    tokio::task::spawn_blocking(move || exporter::read_scan_progress(&PathBuf::from(repo_path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_scan_cancel(
    repo_path: String,
) -> Result<types::OrgtrackScanProgress, String> {
    tokio::task::spawn_blocking(move || exporter::cancel_orgtrack_scan(&PathBuf::from(repo_path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_export(
    repo_path: String,
    tier: Option<String>,
    allow_raw_trajectory: Option<bool>,
) -> Result<types::OrgtrackExportResult, String> {
    let tier = validate_tier(tier.as_deref(), allow_raw_trajectory)?;
    tokio::task::spawn_blocking(move || exporter::export_orgtrack(&PathBuf::from(repo_path), tier))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_sync_core_repo(repo_path: String) -> Result<types::OrgtrackIndex, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        orgtrack_core::repo_sync::sync_repo_from_store(&store, &PathBuf::from(repo_path))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_index(repo_path: String) -> Result<Option<types::OrgtrackIndex>, String> {
    tokio::task::spawn_blocking(move || importer::read_index(&PathBuf::from(repo_path)))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_file_timeline(
    repo_path: String,
    file_path: String,
) -> Result<Option<types::OrgtrackFileTimeline>, String> {
    tokio::task::spawn_blocking(move || {
        importer::read_file_timeline(&PathBuf::from(repo_path), &file_path)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_session_summaries(
    workspace_path: Option<String>,
) -> Result<Vec<CoreSessionSummary>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        let sessions = store.list_sessions(workspace_path.as_deref())?;
        let final_diffs = store.list_final_diffs(None, None)?;
        let commit_links = store.list_commit_links()?;
        Ok(session_summaries(sessions, final_diffs, commit_links))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_analyze_sessions(
    workspace_path: Option<String>,
    session_id: Option<String>,
    rebuild: Option<bool>,
) -> Result<analysis_backfill::AnalysisBackfillStats, String> {
    tokio::task::spawn_blocking(move || {
        analysis_backfill::analyze_requested(
            workspace_path.as_deref(),
            session_id.as_deref(),
            rebuild.unwrap_or(false),
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_lookup_file_sessions(
    repo_path: String,
    file_path: String,
) -> Result<Option<types::OrgtrackFileSessionLookup>, String> {
    tokio::task::spawn_blocking(move || {
        importer::read_file_session_lookup(&PathBuf::from(repo_path), &file_path)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_source_tier_policy(source: String) -> Result<SourceTierPolicy, String> {
    Ok(source_tier_policy(&source))
}

#[tauri::command]
pub async fn orgtrack_get_extraction_memory_gate(
) -> Result<extraction_scheduler::ExtractionMemoryGateState, String> {
    Ok(extraction_scheduler::evaluate_memory_gate(
        &extraction_scheduler::ExtractionMemoryGateConfig::default(),
    ))
}

#[tauri::command]
pub async fn orgtrack_get_session_edit_artifacts(
    source: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<SessionEditArtifactRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_edit_artifacts(source.as_deref(), session_id.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_session_diff_chunks(
    source: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<SessionDiffChunkRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_diff_chunks(source.as_deref(), session_id.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_session_final_diffs(
    source: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<SessionFinalDiffRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_final_diffs(source.as_deref(), session_id.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_session_commit_links(
    session_id: Option<String>,
) -> Result<Vec<CommitLinkRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        let commit_links = store.list_commit_links()?;
        Ok(match session_id {
            Some(session_id) => commit_links
                .into_iter()
                .filter(|link| {
                    link.session_ids
                        .iter()
                        .any(|linked_id| linked_id == &session_id)
                })
                .collect(),
            None => commit_links,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Debug-only: seed an orgtrack commit link for WDIO Submissions-tab specs.
///
/// Production commit links are written by `analysis_backfill` after the
/// extraction scheduler parses a `git commit` / `git push` shell event. That
/// path is async and depends on a real provider run, so WDIO specs cannot
/// reach it. This wire writes the same `CommitLinkRecord` shape the backfill
/// produces (camelCase JSON, `observed_in_terminal_output` reachability) so
/// `orgtrack_get_session_commit_links` returns it and the Submissions tab
/// renders the commit exactly like a live push. Returns Err in release builds.
#[tauri::command]
pub async fn debug_seed_commit_link(
    session_id: String,
    commit_sha: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("debug_seed_commit_link is only available in debug builds".into());
    }
    if session_id.is_empty() || commit_sha.is_empty() {
        return Err("debug_seed_commit_link: `session_id` and `commit_sha` are required".into());
    }
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        let record_id = record_id(&["debug_seed_commit_link", &session_id, &commit_sha]);
        store.upsert_commit_link(&CommitLinkRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            record_id,
            commit_sha,
            file_paths: Vec::new(),
            session_ids: vec![session_id],
            reachability_state: "observed_in_terminal_output".to_string(),
            linked_at: chrono::Utc::now().to_rfc3339(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Debug-only: seed an orgtrack final-diff record for WDIO Diff-tab-content specs.
///
/// The extraction scheduler produces `SessionFinalDiffRecord` entries from
/// real edit events; because that path requires a live agent run, WDIO specs
/// cannot seed diff-tab content through it. This wire writes a record with
/// the same shape, but only a `diff` unified-diff string (no old_content /
/// new_content), replicating the bug shape where orgtrack consolidation stores
/// only the unified diff. Returns Err in release builds.
#[tauri::command]
pub async fn debug_seed_final_diff(
    session_id: String,
    source: String,
    file_path: String,
    diff: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("debug_seed_final_diff is only available in debug builds".into());
    }
    if session_id.is_empty() || source.is_empty() || file_path.is_empty() || diff.is_empty() {
        return Err("debug_seed_final_diff: all fields are required".into());
    }
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        let record_id = record_id(&["debug_seed_final_diff", &session_id, &file_path]);
        let words: Vec<&str> = diff.lines().collect();
        let lines_added = words.iter().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count() as i32;
        let lines_removed = words.iter().filter(|l| l.starts_with('-') && !l.starts_with("---")).count() as i32;
        store.upsert_final_diff(&SessionFinalDiffRecord {
            schema_version: ORGTRACK_SCHEMA_VERSION,
            record_id,
            source,
            session_id,
            file_path,
            baseline_event_id: None,
            final_event_id: None,
            old_content: None,
            new_content: None,
            diff: Some(diff),
            lines_added,
            lines_removed,
            is_deleted: false,
            quality: orgtrack_core::canonical::ArtifactQuality::PatchReversible,
            differs_from_summed_chunks: false,
            computed_at: chrono::Utc::now().to_rfc3339(),
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_session_checkpoints(
    source: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<SessionCheckpointRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_session_checkpoints(source.as_deref(), session_id.as_deref())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn orgtrack_get_checkpoint_file_states(
    checkpoint_id: String,
) -> Result<Vec<SessionCheckpointFileStateRecord>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let store = SqliteRecordStore::new(&conn);
        store.list_checkpoint_file_states(&checkpoint_id)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn validate_tier(
    tier: Option<&str>,
    allow_raw_trajectory: Option<bool>,
) -> Result<OrgtrackTier, String> {
    let tier = OrgtrackTier::from_optional_str(tier)?;
    if tier.includes_trajectory() && allow_raw_trajectory != Some(true) {
        return Err(
            "Trajectory export can include prompts, tool payloads, file contents, and secrets. Pass allowRawTrajectory=true to opt in."
                .to_string(),
        );
    }
    Ok(tier)
}
