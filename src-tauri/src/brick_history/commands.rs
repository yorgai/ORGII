use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use brick_core::{
    discover_sources, format_source_session_chunks, refresh_source_profile_to_metadata,
    source_session_full_refresh, source_session_turn_window, DiscoveredPathKind, DiscoveredSource,
    DiscoveredSourceKind, MetadataDb, SourcePlanListQuery, SourcePlanRecord,
    SourcePlanSessionEdgeRecord, SourceProfile, SourceRefreshOptions, SourceSessionChunksUpsert,
    SourceSessionListQuery, SourceSessionRecord, SourceUsageSummaryQuery, FUNCTION_ASSISTANT,
    FUNCTION_USER_MESSAGE,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_LIST_LIMIT: usize = 200;
const DEFAULT_REFRESH_LIMIT: usize = 500;
const MAX_LIST_LIMIT: usize = 1_000;
const BRICK_HOME_DIR: &str = "brick";

const SESSION_STATUS_COMPLETED: &str = "completed";
const SESSION_CATEGORY_EXTERNAL_HISTORY: &str = "external_history";
const LIVENESS_ACTIVE: &str = "active";
const METADATA_KEY_LIVENESS: &str = "liveness";
const METADATA_KEY_CURSOR_MODE: &str = "cursorMode";
const METADATA_KEY_CURSOR_IS_AGENTIC: &str = "cursorIsAgentic";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistorySessionRow {
    pub session_id: String,
    pub name: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub category: String,
    pub read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub total_tokens: i64,
    pub background: bool,
    pub is_active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub files_changed: i64,
    pub lines_added: i64,
    pub lines_removed: i64,
    pub touched_files: Vec<String>,
    pub source_id: String,
    pub external_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parser_version: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub last_seen_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub liveness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scan_liveness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_is_agentic: Option<bool>,
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistorySessionPage {
    pub sessions: Vec<BrickHistorySessionRow>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistorySourceRow {
    pub source_id: String,
    pub display_name: String,
    pub session_id_prefix: String,
    pub category: String,
    pub capabilities: Vec<String>,
    pub available: bool,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryRefreshStats {
    pub source_id: String,
    pub limit: usize,
    pub source_available: bool,
    pub profiles: usize,
    pub sessions_scanned: usize,
    pub sessions_reindexed: usize,
    pub sessions_unchanged: usize,
    pub plans_upserted: usize,
    pub events_appended: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryRecentPathRow {
    pub repo_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_name: Option<String>,
    pub session_count: usize,
    pub last_seen_at: String,
    pub source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryPlanRow {
    pub source_id: String,
    pub external_plan_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parser_version: Option<String>,
    pub discovered_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryPlanPage {
    pub plans: Vec<BrickHistoryPlanRow>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryPlanEdgeRow {
    pub source_id: String,
    pub external_plan_id: String,
    pub external_session_id: String,
    pub session_id: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todo_ids: Option<Value>,
    pub discovered_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryChunksRequest {
    pub source_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistorySessionQueryRequest {
    pub source_id: Option<String>,
    pub created_after: Option<String>,
    pub created_before: Option<String>,
    pub repo_path: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub refresh_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryUsageModelSummaryRow {
    pub model: String,
    pub session_count: usize,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryUsageSummaryRow {
    pub session_count: usize,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub total_duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_duration_ms: Option<u64>,
    pub model_breakdown: Vec<BrickHistoryUsageModelSummaryRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryCursorFullRefresh {
    pub chunks: Vec<Value>,
    pub turns: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickHistoryCursorTurnWindow {
    pub chunks: Vec<Value>,
    pub user_bubble_id: String,
    pub next_user_bubble_id: Option<String>,
    pub loaded_bubble_count: usize,
}

#[tauri::command]
pub async fn brick_history_sources() -> Result<Vec<BrickHistorySourceRow>, String> {
    tokio::task::spawn_blocking(|| {
        Ok(discovered_profiles()
            .into_iter()
            .map(|(source, profile)| BrickHistorySourceRow {
                source_id: profile.name,
                display_name: source.source.label().to_string(),
                session_id_prefix: source.source.session_id_prefix().to_string(),
                category: source.source.category().to_string(),
                capabilities: source
                    .source
                    .capabilities()
                    .iter()
                    .map(|capability| (*capability).to_string())
                    .collect(),
                available: true,
                paths: source
                    .paths
                    .into_iter()
                    .map(|path| path.path.display().to_string())
                    .collect(),
            })
            .collect())
    })
    .await
    .map_err(|err| format!("Brick source discovery task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_sessions(
    source_id: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<BrickHistorySessionPage, String> {
    tokio::task::spawn_blocking(move || list_sessions_for_source(&source_id, limit, offset))
        .await
        .map_err(|err| format!("Brick history session task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_query_sessions(
    request: BrickHistorySessionQueryRequest,
) -> Result<BrickHistorySessionPage, String> {
    tokio::task::spawn_blocking(move || query_sessions(request))
        .await
        .map_err(|err| format!("Brick history filtered session task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_usage_summary(
    request: BrickHistorySessionQueryRequest,
) -> Result<BrickHistoryUsageSummaryRow, String> {
    tokio::task::spawn_blocking(move || usage_summary(request))
        .await
        .map_err(|err| format!("Brick history usage summary task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_chunks(
    request: BrickHistoryChunksRequest,
) -> Result<Vec<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let external_session_id =
            external_session_id_from_frontend_id(&request.source_id, &request.session_id);
        let mut db = open_metadata_db()?;
        let source_path = db
            .get_source_session(&request.source_id, &external_session_id)
            .map_err(to_string_error)?
            .and_then(|record| record.source_path);
        let chunks = format_source_session_chunks(
            &request.source_id,
            &external_session_id,
            source_path.as_deref(),
        )
        .map_err(to_string_error)?;
        if !chunks.is_empty() {
            db.upsert_source_session_chunks(&SourceSessionChunksUpsert {
                source_id: request.source_id,
                external_session_id,
                chunks: chunks.clone(),
            })
            .map_err(to_string_error)?;
        }
        chunks
            .into_iter()
            .map(serde_json::to_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("Failed to encode Brick chunks: {err}"))
    })
    .await
    .map_err(|err| format!("Brick history chunks task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_cursor_full_refresh(
    session_id: String,
) -> Result<BrickHistoryCursorFullRefresh, String> {
    tokio::task::spawn_blocking(move || cursor_full_refresh(session_id))
        .await
        .map_err(|err| format!("Brick Cursor full refresh task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_cursor_turn_window(
    session_id: String,
    user_bubble_id: String,
) -> Result<BrickHistoryCursorTurnWindow, String> {
    tokio::task::spawn_blocking(move || cursor_turn_window(session_id, user_bubble_id))
        .await
        .map_err(|err| format!("Brick Cursor turn window task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_refresh_source(
    source_id: String,
    limit: Option<usize>,
) -> Result<BrickHistoryRefreshStats, String> {
    tokio::task::spawn_blocking(move || refresh_source(&source_id, Some(normalize_limit(limit))))
        .await
        .map_err(|err| format!("Brick history refresh task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<BrickHistoryRecentPathRow>, String> {
    tokio::task::spawn_blocking(move || list_recent_paths(limit))
        .await
        .map_err(|err| format!("Brick recent paths task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_plans(
    source_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<BrickHistoryPlanPage, String> {
    tokio::task::spawn_blocking(move || list_plans(source_id, limit, offset))
        .await
        .map_err(|err| format!("Brick plans task failed: {err}"))?
}

#[tauri::command]
pub async fn brick_history_plan_edges(
    source_id: Option<String>,
    external_plan_ids: Option<Vec<String>>,
) -> Result<Vec<BrickHistoryPlanEdgeRow>, String> {
    tokio::task::spawn_blocking(move || list_plan_edges(source_id, external_plan_ids))
        .await
        .map_err(|err| format!("Brick plan edges task failed: {err}"))?
}

fn list_sessions_for_source(
    source_id: &str,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<BrickHistorySessionPage, String> {
    let limit = normalize_limit(limit);
    let offset = offset.unwrap_or(0);
    refresh_source(source_id, Some(limit.max(DEFAULT_REFRESH_LIMIT)))?;
    let db = open_metadata_db()?;
    let records = db
        .list_source_sessions(&SourceSessionListQuery {
            source_id: Some(source_id.to_string()),
            limit: limit + 1,
            offset,
            ..SourceSessionListQuery::default()
        })
        .map_err(to_string_error)?;
    let has_more = records.len() > limit;
    let sessions = records
        .into_iter()
        .take(limit)
        .map(|record| record_to_row(&db, record))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(BrickHistorySessionPage { sessions, has_more })
}

fn query_sessions(
    request: BrickHistorySessionQueryRequest,
) -> Result<BrickHistorySessionPage, String> {
    let limit = normalize_limit(request.limit);
    let offset = request.offset.unwrap_or(0);
    if let Some(source_id) = request.source_id.as_deref() {
        refresh_source(
            source_id,
            Some(request.refresh_limit.unwrap_or(DEFAULT_REFRESH_LIMIT)),
        )?;
    }
    let db = open_metadata_db()?;
    let query = source_session_query_from_request(&request, limit + 1, offset)?;
    let records = db.list_source_sessions(&query).map_err(to_string_error)?;
    let has_more = records.len() > limit;
    let sessions = records
        .into_iter()
        .take(limit)
        .map(|record| record_to_row(&db, record))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(BrickHistorySessionPage { sessions, has_more })
}

fn usage_summary(
    request: BrickHistorySessionQueryRequest,
) -> Result<BrickHistoryUsageSummaryRow, String> {
    if let Some(source_id) = request.source_id.as_deref() {
        refresh_source(
            source_id,
            Some(request.refresh_limit.unwrap_or(DEFAULT_REFRESH_LIMIT)),
        )?;
    }
    let db = open_metadata_db()?;
    let query = source_usage_query_from_request(&request)?;
    let summary = db.source_usage_summary(&query).map_err(to_string_error)?;
    Ok(BrickHistoryUsageSummaryRow {
        session_count: summary.session_count,
        input_tokens: summary.input_tokens,
        output_tokens: summary.output_tokens,
        total_tokens: summary.total_tokens,
        total_duration_ms: summary.total_duration_ms,
        average_duration_ms: summary.average_duration_ms,
        model_breakdown: summary
            .model_breakdown
            .into_iter()
            .map(|model| BrickHistoryUsageModelSummaryRow {
                model: model.model,
                session_count: model.session_count,
                input_tokens: model.input_tokens,
                output_tokens: model.output_tokens,
                total_tokens: model.total_tokens,
            })
            .collect(),
    })
}

fn source_session_query_from_request(
    request: &BrickHistorySessionQueryRequest,
    limit: usize,
    offset: usize,
) -> Result<SourceSessionListQuery, String> {
    Ok(SourceSessionListQuery {
        source_id: request.source_id.clone(),
        created_after: parse_optional_rfc3339(request.created_after.as_deref())?,
        created_before: parse_optional_rfc3339(request.created_before.as_deref())?,
        repo_path: request.repo_path.as_ref().map(PathBuf::from),
        model: request.model.clone(),
        status: request.status.clone(),
        limit,
        offset,
    })
}

fn source_usage_query_from_request(
    request: &BrickHistorySessionQueryRequest,
) -> Result<SourceUsageSummaryQuery, String> {
    Ok(SourceUsageSummaryQuery {
        source_id: request.source_id.clone(),
        created_after: parse_optional_rfc3339(request.created_after.as_deref())?,
        created_before: parse_optional_rfc3339(request.created_before.as_deref())?,
        repo_path: request.repo_path.as_ref().map(PathBuf::from),
        model: request.model.clone(),
        status: request.status.clone(),
    })
}

fn parse_optional_rfc3339(value: Option<&str>) -> Result<Option<DateTime<Utc>>, String> {
    value
        .map(|raw| {
            DateTime::parse_from_rfc3339(raw)
                .map(|parsed| parsed.with_timezone(&Utc))
                .map_err(|err| format!("Invalid RFC3339 timestamp {raw}: {err}"))
        })
        .transpose()
}

fn cursor_full_refresh(session_id: String) -> Result<BrickHistoryCursorFullRefresh, String> {
    let (external_session_id, source_path) = cursor_source_context(&session_id)?;
    let refresh =
        source_session_full_refresh("cursor_ide", &external_session_id, source_path.as_deref())
            .map_err(to_string_error)?;
    persist_cursor_chunks(&external_session_id, refresh.chunks.clone())?;
    Ok(BrickHistoryCursorFullRefresh {
        chunks: chunks_to_values(refresh.chunks)?,
        turns: Vec::new(),
    })
}

fn cursor_turn_window(
    session_id: String,
    user_bubble_id: String,
) -> Result<BrickHistoryCursorTurnWindow, String> {
    let (external_session_id, source_path) = cursor_source_context(&session_id)?;
    let window = source_session_turn_window(
        "cursor_ide",
        &external_session_id,
        source_path.as_deref(),
        &user_bubble_id,
    )
    .map_err(to_string_error)?;
    Ok(BrickHistoryCursorTurnWindow {
        loaded_bubble_count: window.loaded_part_count,
        chunks: chunks_to_values(window.chunks)?,
        user_bubble_id: window.user_part_id,
        next_user_bubble_id: window.next_user_part_id,
    })
}

fn cursor_source_context(session_id: &str) -> Result<(String, Option<PathBuf>), String> {
    let external_session_id = external_session_id_from_frontend_id("cursor_ide", session_id);
    refresh_source("cursor_ide", Some(DEFAULT_REFRESH_LIMIT))?;
    let db = open_metadata_db()?;
    let source_path = db
        .get_source_session("cursor_ide", &external_session_id)
        .map_err(to_string_error)?
        .and_then(|record| record.source_path);
    Ok((external_session_id, source_path))
}

fn persist_cursor_chunks(
    external_session_id: &str,
    chunks: Vec<brick_core::ActivityChunk>,
) -> Result<(), String> {
    if chunks.is_empty() {
        return Ok(());
    }
    let mut db = open_metadata_db()?;
    db.upsert_source_session_chunks(&SourceSessionChunksUpsert {
        source_id: "cursor_ide".to_string(),
        external_session_id: external_session_id.to_string(),
        chunks,
    })
    .map_err(to_string_error)
}

fn chunks_to_values(chunks: Vec<brick_core::ActivityChunk>) -> Result<Vec<Value>, String> {
    chunks
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to encode Brick Cursor chunks: {err}"))
}

fn refresh_source(
    source_id: &str,
    limit: Option<usize>,
) -> Result<BrickHistoryRefreshStats, String> {
    let limit = normalize_limit(limit);
    let mut stats = BrickHistoryRefreshStats {
        source_id: source_id.to_string(),
        limit,
        ..BrickHistoryRefreshStats::default()
    };
    let Some(profile) = profile_for_source(source_id) else {
        return Ok(stats);
    };

    let mut metadata_db = open_metadata_db()?;
    let summary = refresh_source_profile_to_metadata(
        &mut metadata_db,
        &profile,
        &SourceRefreshOptions {
            limit: Some(limit),
            ..SourceRefreshOptions::default()
        },
    )
    .map_err(to_string_error)?;

    stats.source_available = true;
    stats.profiles = summary.profiles;
    stats.sessions_scanned = summary.scanned;
    stats.sessions_reindexed = summary.reindexed;
    stats.sessions_unchanged = summary.skipped;
    stats.plans_upserted = summary.plans_upserted;
    stats.events_appended = summary.events_appended;
    Ok(stats)
}

fn list_recent_paths(limit: Option<usize>) -> Result<Vec<BrickHistoryRecentPathRow>, String> {
    let limit = normalize_limit(limit);
    let db = open_metadata_db()?;
    let records = db
        .list_source_sessions(&SourceSessionListQuery {
            source_id: None,
            limit: MAX_LIST_LIMIT,
            offset: 0,
            ..SourceSessionListQuery::default()
        })
        .map_err(to_string_error)?;
    let mut groups: BTreeMap<String, BrickHistoryRecentPathAccumulator> = BTreeMap::new();
    for record in records {
        let Some(repo_path) = record.repo_path.as_ref().map(path_to_string) else {
            continue;
        };
        if repo_path.is_empty() {
            continue;
        }
        let entry =
            groups
                .entry(repo_path.clone())
                .or_insert_with(|| BrickHistoryRecentPathAccumulator {
                    repo_path: repo_path.clone(),
                    repo_name: repo_name_from_path(Path::new(&repo_path)),
                    session_count: 0,
                    last_seen_at: record.last_seen_at,
                    source_ids: Vec::new(),
                });
        entry.session_count += 1;
        if record.last_seen_at > entry.last_seen_at {
            entry.last_seen_at = record.last_seen_at;
        }
        if !entry.source_ids.contains(&record.source_id) {
            entry.source_ids.push(record.source_id);
        }
    }
    let mut rows = groups
        .into_values()
        .map(|entry| BrickHistoryRecentPathRow {
            repo_path: entry.repo_path,
            repo_name: entry.repo_name,
            session_count: entry.session_count,
            last_seen_at: entry.last_seen_at.to_rfc3339(),
            source_ids: entry.source_ids,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| right.last_seen_at.cmp(&left.last_seen_at));
    rows.truncate(limit);
    Ok(rows)
}

fn list_plans(
    source_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<BrickHistoryPlanPage, String> {
    let limit = normalize_limit(limit);
    let offset = offset.unwrap_or(0);
    if let Some(source_id) = source_id.as_deref() {
        refresh_source(source_id, Some(DEFAULT_REFRESH_LIMIT))?;
    }
    let db = open_metadata_db()?;
    let records = db
        .list_source_plans(&SourcePlanListQuery {
            source_id,
            limit: limit + 1,
            offset,
        })
        .map_err(to_string_error)?;
    let has_more = records.len() > limit;
    let plans = records.into_iter().take(limit).map(plan_to_row).collect();
    Ok(BrickHistoryPlanPage { plans, has_more })
}

fn list_plan_edges(
    source_id: Option<String>,
    external_plan_ids: Option<Vec<String>>,
) -> Result<Vec<BrickHistoryPlanEdgeRow>, String> {
    if let Some(source_id) = source_id.as_deref() {
        refresh_source(source_id, Some(DEFAULT_REFRESH_LIMIT))?;
    }
    let external_plan_ids = external_plan_ids.unwrap_or_default();
    let db = open_metadata_db()?;
    db.list_source_plan_session_edges(source_id.as_deref(), &external_plan_ids)
        .map_err(to_string_error)?
        .into_iter()
        .map(plan_edge_to_row)
        .collect()
}

#[derive(Debug, Clone)]
struct BrickHistoryRecentPathAccumulator {
    repo_path: String,
    repo_name: Option<String>,
    session_count: usize,
    last_seen_at: DateTime<Utc>,
    source_ids: Vec<String>,
}

fn discovered_profiles() -> Vec<(DiscoveredSource, SourceProfile)> {
    discover_sources()
        .into_iter()
        .map(|source| {
            let profile = profile_from_discovered_source(&source);
            (source, profile)
        })
        .collect()
}

fn profile_for_source(source_id: &str) -> Option<SourceProfile> {
    discovered_profiles()
        .into_iter()
        .find_map(|(_, profile)| (profile.name == source_id).then_some(profile))
}

fn profile_from_discovered_source(source: &DiscoveredSource) -> SourceProfile {
    let evidence_root = source
        .paths
        .iter()
        .find(|path| {
            matches!(
                path.kind,
                DiscoveredPathKind::EvidenceRoot | DiscoveredPathKind::SessionLogRoot
            )
        })
        .map(|path| path.path.clone());
    let cursor_state_db_path = source
        .paths
        .iter()
        .find(|path| path.kind == DiscoveredPathKind::CursorStateDatabase)
        .map(|path| path.path.clone());
    let session_log_path = source
        .paths
        .iter()
        .find(|path| path.kind == DiscoveredPathKind::SessionLogRoot)
        .map(|path| path.path.clone());
    let session_db_path = source
        .paths
        .iter()
        .find(|path| {
            matches!(
                path.kind,
                DiscoveredPathKind::SessionDatabase | DiscoveredPathKind::HistoryDatabase
            )
        })
        .map(|path| path.path.clone());

    SourceProfile {
        name: source.source.profile_name().to_string(),
        app_id: Some(source.source.app_id().to_string()),
        actor_id: None,
        actor_type: None,
        store_root: None,
        session_db_path,
        session_log_path,
        evidence_root,
        cursor_state_db_path,
        default_full_evidence_upload: None,
        notes: Some("Discovered by ORGII Brick adapter".to_string()),
    }
}

fn record_to_row(
    db: &MetadataDb,
    record: SourceSessionRecord,
) -> Result<BrickHistorySessionRow, String> {
    let source_id = record.source_id.clone();
    let external_session_id = record.external_session_id.clone();
    let session_id = frontend_session_id(&source_id, &external_session_id);
    let touched_files = touched_files(record.touched_files_json.as_ref());
    let updated_at = record
        .session_updated_at
        .or(record.source_mtime)
        .unwrap_or(record.last_seen_at)
        .to_rfc3339();
    let created_at = record
        .session_created_at
        .unwrap_or(record.discovered_at)
        .to_rfc3339();
    let repo_path = record.repo_path.as_ref().map(path_to_string);
    let repo_name = record
        .repo_path
        .as_ref()
        .and_then(|path| repo_name_from_path(path));
    let input_tokens = optional_u64_to_i64(record.input_tokens, "input tokens")?;
    let output_tokens = optional_u64_to_i64(record.output_tokens, "output tokens")?;
    let total_tokens = input_tokens.saturating_add(output_tokens);
    let liveness = metadata_liveness(record.metadata_json.as_ref()).map(ToOwned::to_owned);
    let cursor_mode = metadata_string(record.metadata_json.as_ref(), METADATA_KEY_CURSOR_MODE);
    let cursor_is_agentic = metadata_bool(
        record.metadata_json.as_ref(),
        METADATA_KEY_CURSOR_IS_AGENTIC,
    );
    let message_count = session_message_count(db, &source_id, &external_session_id)?;
    Ok(BrickHistorySessionRow {
        session_id,
        name: record
            .title
            .or(record.name)
            .unwrap_or_else(|| external_session_id.clone()),
        status: SESSION_STATUS_COMPLETED.to_string(),
        created_at,
        updated_at,
        category: session_category(&source_id),
        read_only: true,
        model: record.model,
        total_tokens,
        background: false,
        is_active: liveness.as_deref() == Some(LIVENESS_ACTIVE),
        repo_path,
        repo_name,
        branch: record.branch,
        files_changed: optional_u64_to_i64(record.files_changed, "files changed")?,
        lines_added: optional_u64_to_i64(record.lines_added, "lines added")?,
        lines_removed: optional_u64_to_i64(record.lines_removed, "lines removed")?,
        touched_files,
        source_id,
        external_session_id,
        source_path: record.source_path.as_ref().map(path_to_string),
        source_uri: record.source_uri,
        parser_version: record.parser_version,
        input_tokens,
        output_tokens,
        last_seen_at: record.last_seen_at.to_rfc3339(),
        liveness: liveness.clone(),
        last_scan_liveness: liveness,
        cursor_mode,
        cursor_is_agentic,
        message_count,
    })
}

fn plan_to_row(record: SourcePlanRecord) -> BrickHistoryPlanRow {
    BrickHistoryPlanRow {
        source_id: record.source_id,
        external_plan_id: record.external_plan_id,
        title: record.title,
        source_path: record.source_path.as_ref().map(path_to_string),
        source_uri: record.source_uri,
        parser_version: record.parser_version,
        discovered_at: record.discovered_at.to_rfc3339(),
        last_seen_at: record.last_seen_at.to_rfc3339(),
        created_at: record.created_at.to_rfc3339(),
        updated_at: record.updated_at.to_rfc3339(),
        metadata: record.metadata_json,
    }
}

fn plan_edge_to_row(
    record: SourcePlanSessionEdgeRecord,
) -> Result<BrickHistoryPlanEdgeRow, String> {
    let session_id = frontend_session_id(&record.source_id, &record.external_session_id);
    Ok(BrickHistoryPlanEdgeRow {
        source_id: record.source_id,
        external_plan_id: record.external_plan_id,
        external_session_id: record.external_session_id,
        session_id,
        role: record.role.to_string(),
        todo_ids: record.todo_ids_json,
        discovered_at: record.discovered_at.to_rfc3339(),
        last_seen_at: record.last_seen_at.to_rfc3339(),
        created_at: record.created_at.to_rfc3339(),
        updated_at: record.updated_at.to_rfc3339(),
        metadata: record.metadata_json,
    })
}

fn session_category(source_id: &str) -> String {
    source_kind(source_id)
        .map(|kind| kind.category().to_string())
        .unwrap_or_else(|| SESSION_CATEGORY_EXTERNAL_HISTORY.to_string())
}

fn frontend_session_id(source_id: &str, external_session_id: &str) -> String {
    format!("{}{}", source_prefix(source_id), external_session_id)
}

fn external_session_id_from_frontend_id(source_id: &str, session_id: &str) -> String {
    let prefix = source_prefix(source_id);
    session_id
        .strip_prefix(prefix.as_str())
        .unwrap_or(session_id)
        .to_string()
}

fn source_prefix(source_id: &str) -> String {
    source_kind(source_id)
        .map(|kind| kind.session_id_prefix().to_string())
        .unwrap_or_else(|| "brickapp-".to_string())
}

fn source_kind(source_id: &str) -> Option<DiscoveredSourceKind> {
    DiscoveredSourceKind::from_profile_name(source_id)
}

fn touched_files(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn metadata_liveness(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(METADATA_KEY_LIVENESS))
        .and_then(Value::as_str)
}

fn metadata_string(value: Option<&Value>, key: &str) -> Option<String> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn metadata_bool(value: Option<&Value>, key: &str) -> Option<bool> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(Value::as_bool)
}

fn session_message_count(
    db: &MetadataDb,
    source_id: &str,
    external_session_id: &str,
) -> Result<i64, String> {
    let count = db
        .list_source_session_chunks(source_id, external_session_id)
        .map_err(to_string_error)?
        .into_iter()
        .filter(|chunk| {
            chunk.function == FUNCTION_USER_MESSAGE || chunk.function == FUNCTION_ASSISTANT
        })
        .count();
    i64::try_from(count).map_err(|_| format!("Brick message count exceeds i64: {count}"))
}

fn repo_name_from_path(path: &Path) -> Option<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
}

fn path_to_string(path: &PathBuf) -> String {
    path.display().to_string()
}

fn normalize_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT)
}

fn open_metadata_db() -> Result<MetadataDb, String> {
    MetadataDb::open_in_home(brick_home()).map_err(to_string_error)
}

fn brick_home() -> PathBuf {
    app_paths::orgii_root().join(BRICK_HOME_DIR)
}

fn optional_u64_to_i64(value: Option<u64>, label: &str) -> Result<i64, String> {
    match value {
        Some(value) => u64_to_i64(value, label),
        None => Ok(0),
    }
}

fn u64_to_i64(value: u64, label: &str) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| format!("Brick {label} exceeds i64: {value}"))
}

fn to_string_error(error: anyhow::Error) -> String {
    error.to_string()
}
