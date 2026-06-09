//! Cursor IDE chat history reader
//!
//! Reads `bubbleId:{composerId}:{bubbleId}` blobs from Cursor's `state.vscdb`
//! and converts each bubble into our canonical [`ActivityChunk`] shape, so the
//! existing event pipeline (`processChunksRust` → `eventStoreProxy` →
//! `ChatHistory`) can render Cursor IDE chat history with no UI-layer changes.
//!
//! ## Read-only contract
//!
//! Cursor IDE owns its database. We open it with
//! [`OpenFlags::SQLITE_OPEN_READ_ONLY`] only, never start a transaction, and
//! drop the connection between calls so we never block Cursor from writing.
//!
//! ## Schema notes
//!
//! See `fixtures/SCHEMA.md` for the full reverse-engineered schema. Two
//! load-bearing facts:
//!
//! 1. `composerData.fullConversationHeadersOnly` is the canonical bubble
//!    order. We never sort by `createdAt` — multiple bubbles in one turn can
//!    share a timestamp.
//! 2. `bubble.toolFormerData.params` and `result` are **JSON strings**, not
//!    parsed objects. We re-parse them lazily.

use std::path::PathBuf;

use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use core_types::activity::ActivityChunk;
use database::db::get_connection;

use crate::cursor_db;

// ============================================================================
// Public types
// ============================================================================

/// A composer bubble in Cursor's DB ordering.
///
/// Held briefly during a single read; not persisted in this shape.
#[derive(Debug, Clone)]
struct OrderedBubble {
    bubble_id: String,
    /// Cursor's bubble type discriminator: 1 = user, 2 = assistant.
    bubble_type: i64,
    raw: RawBubble,
}

// ============================================================================
// Cursor's raw schema (lenient — every field defaulted)
// ============================================================================

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawBubble {
    #[serde(rename = "type")]
    bubble_type: i64,
    bubble_id: String,
    created_at: String,
    text: String,
    /// Present only on assistant tool turns.
    tool_former_data: Option<RawToolFormerData>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawToolFormerData {
    /// Cursor's stable tool string id (e.g. `"edit_file_v2"`). Preferred over
    /// the numeric `tool` id, which shifts between Cursor versions.
    name: String,
    tool_call_id: String,
    status: String,
    /// JSON-encoded as a string. Parse with [`parse_inner_json`].
    params: String,
    /// JSON-encoded as a string. Parse with [`parse_inner_json`].
    result: String,
    /// Cursor stores pruned search summaries here when `result` is empty.
    additional_data: Value,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawComposerHeader {
    bubble_id: String,
    #[serde(rename = "type")]
    bubble_type: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawComposerForOrder {
    created_at: i64,
    last_updated_at: i64,
    full_conversation_headers_only: Vec<RawComposerHeader>,
    subagent_info: Option<RawCursorSubagentInfo>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawCursorSubagentInfo {
    subagent_type_name: String,
    parent_composer_id: String,
    tool_call_id: String,
}

#[derive(Debug, Clone, Default)]
struct CursorComposerContext {
    subagent_info: Option<RawCursorSubagentInfo>,
}

impl CursorComposerContext {
    fn from_composer(composer: &RawComposerForOrder) -> Self {
        Self {
            subagent_info: composer.subagent_info.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawComposerWorkspaceMetadata {
    tracked_git_repos: Vec<RawTrackedGitRepo>,
    workspace_identifier: Option<RawWorkspaceIdentifier>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawTrackedGitRepo {
    repo_path: String,
    branches: Vec<RawTrackedGitBranch>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawTrackedGitBranch {
    branch_name: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawWorkspaceIdentifier {
    uri: Option<RawWorkspaceUri>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawWorkspaceUri {
    fs_path: String,
    path: String,
}

#[derive(Debug, Clone, Default)]
struct CursorWorkspaceMetadata {
    repo_path: Option<String>,
    branch: Option<String>,
}

/// One Cursor IDE composer surfaced as a frontend-ready session row.
///
/// Field naming mirrors `SessionAggregateRecord` so the frontend can merge
/// these rows directly into `sessionsAtom`. The `category` is always
/// `"cursor_ide"`; the `session_id` is always prefixed (`cursoride-{uuid}`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeSessionRow {
    pub session_id: String,
    pub name: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub category: &'static str,
    /// Always `true` for Cursor IDE sessions — the frontend uses this to gate
    /// destructive UI (input, send, worktree controls).
    pub read_only: bool,
    pub model: Option<String>,
    pub total_tokens: i64,
    pub background: bool,
    pub is_active: bool,
    pub repo_path: Option<String>,
    pub repo_name: Option<String>,
    pub branch: Option<String>,
}

/// Paginated response for the sidebar's Cursor IDE history loader.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeSessionPage {
    pub sessions: Vec<CursorIdeSessionRow>,
    /// `true` iff a follow-up call with `offset + sessions.len()` would
    /// return additional rows. Allows the sidebar to render the "Load more"
    /// row only when more is actually available.
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeTurnSummary {
    pub turn_id: String,
    pub next_turn_id: Option<String>,
    pub turn_index: usize,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub user_preview: String,
    pub event_count: usize,
    pub body_event_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeInitialWindow {
    pub chunks: Vec<ActivityChunk>,
    pub turns: Vec<CursorIdeTurnSummary>,
    pub total_bubble_count: usize,
    pub user_bubble_count: usize,
    pub recent_bubble_count: usize,
    pub recent_start_cursor: Option<String>,
    pub recent_end_cursor: Option<String>,
    pub has_unloaded_middle: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeFullRefresh {
    pub chunks: Vec<ActivityChunk>,
    pub turns: Vec<CursorIdeTurnSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorIdeTurnWindow {
    pub chunks: Vec<ActivityChunk>,
    pub user_bubble_id: String,
    pub next_user_bubble_id: Option<String>,
    pub loaded_bubble_count: usize,
}

const CURSOR_IDE_CATEGORY: &str = "cursor_ide";
const DEFAULT_INITIAL_RECENT_BUBBLE_LIMIT: usize = 100;
const SQLITE_IN_QUERY_CHUNK_SIZE: usize = 500;

// ============================================================================
// Public API
// ============================================================================

/// Paginated Cursor IDE history list, mapped from the cached metadata
/// produced by `cursor_db::list_for_sidebar`.
///
/// The cache is the source of truth here — `list_for_sidebar` does the
/// delta-sync + subagent filter + ordering for us. We just translate cache
/// rows into the frontend-ready `CursorIdeSessionRow` shape.
pub fn list_cursor_ide_sessions_paginated(
    limit: usize,
    offset: usize,
) -> Result<CursorIdeSessionPage, String> {
    let cursor_conn = open_cursor_db();
    let (rows, has_more) = cursor_db::list_for_sidebar_filtered(limit, offset, |row| {
        is_listable_cursor_session(row, cursor_conn.as_ref())
    })?;
    let sessions = rows
        .into_iter()
        .map(|row| cache_row_to_session_row(row, cursor_conn.as_ref()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CursorIdeSessionPage { sessions, has_more })
}

fn is_listable_cursor_session(
    row: &cursor_db::CursorSession,
    cursor_conn: Option<&Connection>,
) -> Result<bool, String> {
    let Some(conn) = cursor_conn else {
        return Ok(false);
    };
    if row.name.trim().is_empty() {
        return Ok(false);
    }
    let order = load_bubble_order(conn, &row.id)?;
    if order.is_empty() {
        return Ok(false);
    }
    let bubbles = load_bubbles_by_id(conn, &row.id, &order)?;
    Ok(!bubbles_to_chunks(
        conn,
        &format!("{}{}", CURSORIDE_SESSION_PREFIX, row.id),
        &bubbles,
        &CursorComposerContext::default(),
    )
    .is_empty())
}

fn cache_row_to_session_row(
    row: cursor_db::CursorSession,
    cursor_conn: Option<&Connection>,
) -> Result<CursorIdeSessionRow, String> {
    let session_id = format!("{}{}", CURSORIDE_SESSION_PREFIX, row.id);
    let created_iso = epoch_ms_to_iso(row.created_at);
    let updated_iso = if row.last_active_at > 0 {
        epoch_ms_to_iso(row.last_active_at)
    } else {
        created_iso.clone()
    };
    let model = if row.model.is_empty() {
        None
    } else {
        Some(row.model)
    };
    let metadata = match cursor_conn {
        Some(conn) => load_workspace_metadata(conn, &row.id)?,
        None => CursorWorkspaceMetadata::default(),
    };
    let repo_name = metadata.repo_path.as_deref().and_then(repo_name_from_path);
    Ok(CursorIdeSessionRow {
        session_id,
        name: if row.name.is_empty() {
            "Untitled Cursor session".to_string()
        } else {
            row.name
        },
        status: if row.status.is_empty() {
            "completed".to_string()
        } else {
            row.status
        },
        created_at: created_iso,
        updated_at: updated_iso,
        category: CURSOR_IDE_CATEGORY,
        read_only: true,
        model,
        total_tokens: row.tokens_used,
        background: false,
        is_active: false,
        repo_path: metadata.repo_path,
        repo_name,
        branch: metadata.branch,
    })
}

fn load_workspace_metadata(
    conn: &Connection,
    composer_id: &str,
) -> Result<CursorWorkspaceMetadata, String> {
    let key = format!("composerData:{}", composer_id);
    let json_str: Option<String> = conn
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key = ?1",
            [&key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to read Cursor composer metadata: {}", err))?;
    let Some(json_str) = json_str else {
        return Ok(CursorWorkspaceMetadata::default());
    };
    let raw: RawComposerWorkspaceMetadata = serde_json::from_str(&json_str)
        .map_err(|err| format!("Failed to parse Cursor composer metadata: {}", err))?;

    let tracked_repo = raw.tracked_git_repos.first();
    let repo_path = tracked_repo
        .map(|repo| repo.repo_path.trim())
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .or_else(|| {
            raw.workspace_identifier
                .as_ref()
                .and_then(|workspace| workspace.uri.as_ref())
                .and_then(|uri| {
                    let fs_path = uri.fs_path.trim();
                    if !fs_path.is_empty() {
                        Some(fs_path.to_string())
                    } else {
                        let path = uri.path.trim();
                        (!path.is_empty()).then(|| path.to_string())
                    }
                })
        });
    let branch = tracked_repo
        .and_then(|repo| repo.branches.first())
        .map(|branch| branch.branch_name.trim())
        .filter(|branch| !branch.is_empty())
        .map(str::to_string);

    Ok(CursorWorkspaceMetadata { repo_path, branch })
}

fn repo_name_from_path(path: &str) -> Option<String> {
    PathBuf::from(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn epoch_ms_to_iso(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

/// Read all bubbles for a composer, in canonical order, normalized into
/// [`ActivityChunk`]s ready for the standard event pipeline.
///
/// `session_id` is the **prefixed** id we expose to the frontend
/// (`cursoride-{uuid}`); the prefix is stripped here before reading from
/// Cursor's DB.
///
/// Returns `Ok(vec![])` if Cursor's DB is missing or the composer is unknown
/// — read-only history is best-effort by definition; we don't synthesize
/// errors for missing data. Returns `Err` only on IO/SQL failures we cannot
/// recover from.
pub fn load_history_for_session(session_id: &str) -> Result<Vec<ActivityChunk>, String> {
    let composer_id = strip_session_prefix(session_id);

    let cursor_conn = match open_cursor_db() {
        Some(conn) => conn,
        None => return Ok(vec![]),
    };

    let composer = load_composer_for_order(&cursor_conn, composer_id)?;
    let composer_context = CursorComposerContext::from_composer(&composer);
    let order = composer.full_conversation_headers_only;
    if order.is_empty() {
        return Ok(vec![]);
    }

    let bubbles = load_bubbles_by_id(&cursor_conn, composer_id, &order)?;

    Ok(bubbles_to_chunks(
        &cursor_conn,
        session_id,
        &bubbles,
        &composer_context,
    ))
}

pub fn load_full_refresh_for_session(session_id: &str) -> Result<CursorIdeFullRefresh, String> {
    let composer_id = strip_session_prefix(session_id);

    let cursor_conn = match open_cursor_db() {
        Some(conn) => conn,
        None => {
            return Ok(CursorIdeFullRefresh {
                chunks: vec![],
                turns: vec![],
            })
        }
    };

    let composer = load_composer_for_order(&cursor_conn, composer_id)?;
    let composer_context = CursorComposerContext::from_composer(&composer);
    let source_updated_at = composer_source_updated_at(
        &cursor_conn,
        composer_id,
        &composer,
        &composer.full_conversation_headers_only,
    )?;
    let order = composer.full_conversation_headers_only;
    if order.is_empty() {
        return Ok(CursorIdeFullRefresh {
            chunks: vec![],
            turns: vec![],
        });
    }

    let total_bubble_count = order.len();
    let bubbles = load_bubbles_by_id(&cursor_conn, composer_id, &order)?;
    let source_fingerprint = cursor_ide_summary_source_fingerprint(
        composer.created_at,
        composer.last_updated_at,
        source_updated_at,
        &order,
    );
    let turns = match load_cached_cursor_ide_turn_summaries(
        session_id,
        source_updated_at,
        total_bubble_count,
        &source_fingerprint,
    )? {
        Some(cached_summaries) => cached_summaries,
        None => {
            let fresh_summaries = build_cursor_ide_turn_summaries(&order, &bubbles);
            upsert_cursor_ide_turn_summaries(
                session_id,
                composer_id,
                source_updated_at,
                total_bubble_count,
                &source_fingerprint,
                &fresh_summaries,
            )?;
            fresh_summaries
        }
    };

    let chunks = bubbles_to_chunks(&cursor_conn, session_id, &bubbles, &composer_context);
    Ok(CursorIdeFullRefresh { chunks, turns })
}

pub fn load_initial_window_for_session(
    session_id: &str,
    recent_limit: Option<usize>,
) -> Result<CursorIdeInitialWindow, String> {
    let composer_id = strip_session_prefix(session_id);

    let cursor_conn = match open_cursor_db() {
        Some(conn) => conn,
        None => {
            return Ok(CursorIdeInitialWindow {
                chunks: vec![],
                turns: vec![],
                total_bubble_count: 0,
                user_bubble_count: 0,
                recent_bubble_count: 0,
                recent_start_cursor: None,
                recent_end_cursor: None,
                has_unloaded_middle: false,
            })
        }
    };

    let composer = load_composer_for_order(&cursor_conn, composer_id)?;
    let composer_context = CursorComposerContext::from_composer(&composer);
    let source_updated_at = composer_source_updated_at(
        &cursor_conn,
        composer_id,
        &composer,
        &composer.full_conversation_headers_only,
    )?;
    let order = composer.full_conversation_headers_only;
    if order.is_empty() {
        return Ok(CursorIdeInitialWindow {
            chunks: vec![],
            turns: vec![],
            total_bubble_count: 0,
            user_bubble_count: 0,
            recent_bubble_count: 0,
            recent_start_cursor: None,
            recent_end_cursor: None,
            has_unloaded_middle: false,
        });
    }

    let composer_created_at = composer.created_at;
    let composer_last_updated_at = composer.last_updated_at;
    let total_bubble_count = order.len();
    let source_fingerprint = cursor_ide_summary_source_fingerprint(
        composer_created_at,
        composer_last_updated_at,
        source_updated_at,
        &order,
    );
    let mut full_bubbles_by_id: Option<HashMap<String, OrderedBubble>> = None;
    let summaries = match load_cached_cursor_ide_turn_summaries(
        session_id,
        source_updated_at,
        total_bubble_count,
        &source_fingerprint,
    )? {
        Some(cached_summaries) => cached_summaries,
        None => {
            let all_bubbles = load_bubbles_by_id(&cursor_conn, composer_id, &order)?;
            let fresh_summaries = build_cursor_ide_turn_summaries(&order, &all_bubbles);
            full_bubbles_by_id = Some(
                all_bubbles
                    .into_iter()
                    .map(|bubble| (bubble.bubble_id.clone(), bubble))
                    .collect(),
            );
            upsert_cursor_ide_turn_summaries(
                session_id,
                composer_id,
                source_updated_at,
                total_bubble_count,
                &source_fingerprint,
                &fresh_summaries,
            )?;
            fresh_summaries
        }
    };
    let summaries_by_turn_id: HashMap<String, CursorIdeTurnSummary> = summaries
        .iter()
        .map(|summary| (summary.turn_id.clone(), summary.clone()))
        .collect();

    let limit = recent_limit
        .unwrap_or(DEFAULT_INITIAL_RECENT_BUBBLE_LIMIT)
        .max(1);
    let recent_start_index = total_bubble_count.saturating_sub(limit);
    let recent_headers = &order[recent_start_index..];
    let recent_ids: HashSet<&str> = recent_headers
        .iter()
        .map(|header| header.bubble_id.as_str())
        .collect();

    let selected_headers: Vec<RawComposerHeader> = order
        .iter()
        .enumerate()
        .filter(|(index, header)| {
            let is_turn_end = index + 1 == order.len()
                || order
                    .get(index + 1)
                    .is_some_and(|next| next.bubble_type == CURSOR_BUBBLE_TYPE_USER);
            header.bubble_type == CURSOR_BUBBLE_TYPE_USER
                || recent_ids.contains(header.bubble_id.as_str())
                || is_turn_end
        })
        .map(|(_, header)| header.clone())
        .collect();

    let bubbles_by_id: HashMap<String, OrderedBubble> =
        if let Some(full_bubbles) = full_bubbles_by_id {
            selected_headers
                .iter()
                .filter_map(|header| {
                    full_bubbles
                        .get(&header.bubble_id)
                        .cloned()
                        .map(|bubble| (bubble.bubble_id.clone(), bubble))
                })
                .collect()
        } else {
            load_bubbles_by_id(&cursor_conn, composer_id, &selected_headers)?
                .into_iter()
                .map(|bubble| (bubble.bubble_id.clone(), bubble))
                .collect()
        };
    let mut chunks = Vec::new();
    for (index, header) in order.iter().enumerate() {
        if header.bubble_type == CURSOR_BUBBLE_TYPE_USER
            || recent_ids.contains(header.bubble_id.as_str())
        {
            if let Some(bubble) = bubbles_by_id.get(&header.bubble_id) {
                chunks.extend(bubbles_to_chunks(
                    &cursor_conn,
                    session_id,
                    std::slice::from_ref(bubble),
                    &composer_context,
                ));
            } else if header.bubble_type == CURSOR_BUBBLE_TYPE_USER {
                chunks.push(build_fallback_user_chunk(
                    session_id,
                    &header.bubble_id,
                    fallback_turn_created_at(&order, &bubbles_by_id, index),
                ));
            }
        }
        if let Some(placeholder) = build_unloaded_turn_placeholder_chunk(
            session_id,
            &order,
            &recent_ids,
            &bubbles_by_id,
            &summaries_by_turn_id,
            index,
        ) {
            chunks.push(placeholder);
        }
    }
    let user_bubble_count = order
        .iter()
        .filter(|header| header.bubble_type == CURSOR_BUBBLE_TYPE_USER)
        .count();
    let recent_bubble_count = recent_headers.len();
    let recent_start_cursor = recent_headers
        .first()
        .map(|header| header.bubble_id.clone())
        .filter(|id| !id.is_empty());
    let recent_end_cursor = recent_headers
        .last()
        .map(|header| header.bubble_id.clone())
        .filter(|id| !id.is_empty());
    let has_unloaded_middle = selected_headers.len() < total_bubble_count;

    Ok(CursorIdeInitialWindow {
        chunks,
        turns: summaries,
        total_bubble_count,
        user_bubble_count,
        recent_bubble_count,
        recent_start_cursor,
        recent_end_cursor,
        has_unloaded_middle,
    })
}

pub fn load_turn_window_for_session(
    session_id: &str,
    user_bubble_id: &str,
) -> Result<CursorIdeTurnWindow, String> {
    let composer_id = strip_session_prefix(session_id);

    let cursor_conn = match open_cursor_db() {
        Some(conn) => conn,
        None => {
            return Ok(CursorIdeTurnWindow {
                chunks: vec![],
                user_bubble_id: user_bubble_id.to_string(),
                next_user_bubble_id: None,
                loaded_bubble_count: 0,
            })
        }
    };

    let composer = load_composer_for_order(&cursor_conn, composer_id)?;
    let composer_context = CursorComposerContext::from_composer(&composer);
    let order = composer.full_conversation_headers_only;
    let Some(start_index) = order
        .iter()
        .position(|header| header.bubble_id == user_bubble_id)
    else {
        return Ok(CursorIdeTurnWindow {
            chunks: vec![],
            user_bubble_id: user_bubble_id.to_string(),
            next_user_bubble_id: None,
            loaded_bubble_count: 0,
        });
    };

    let next_user_index = order
        .iter()
        .enumerate()
        .skip(start_index + 1)
        .find(|(_, header)| header.bubble_type == CURSOR_BUBBLE_TYPE_USER)
        .map(|(index, _)| index);
    let end_index = next_user_index.unwrap_or(order.len());
    let turn_headers = &order[start_index..end_index];
    let bubbles = load_bubbles_by_id(&cursor_conn, composer_id, turn_headers)?;
    let chunks = bubbles_to_chunks(&cursor_conn, session_id, &bubbles, &composer_context);
    let next_user_bubble_id = next_user_index
        .and_then(|index| order.get(index))
        .map(|header| header.bubble_id.clone())
        .filter(|id| !id.is_empty());

    Ok(CursorIdeTurnWindow {
        chunks,
        user_bubble_id: user_bubble_id.to_string(),
        next_user_bubble_id,
        loaded_bubble_count: turn_headers.len(),
    })
}

fn build_cursor_ide_turn_summaries(
    order: &[RawComposerHeader],
    bubbles: &[OrderedBubble],
) -> Vec<CursorIdeTurnSummary> {
    let bubbles_by_id: HashMap<String, OrderedBubble> = bubbles
        .iter()
        .map(|bubble| (bubble.bubble_id.clone(), bubble.clone()))
        .collect();
    let mut summaries = Vec::new();

    for (index, header) in order.iter().enumerate() {
        if header.bubble_type != CURSOR_BUBBLE_TYPE_USER || header.bubble_id.is_empty() {
            continue;
        }

        let next_user_index = order
            .iter()
            .enumerate()
            .skip(index + 1)
            .find(|(_, candidate)| candidate.bubble_type == CURSOR_BUBBLE_TYPE_USER)
            .map(|(candidate_index, _)| candidate_index)
            .unwrap_or(order.len());
        let turn_headers = &order[index..next_user_index];
        let next_turn_id = order
            .get(next_user_index)
            .map(|candidate| candidate.bubble_id.clone())
            .filter(|id| !id.is_empty());
        let started_at = turn_headers
            .iter()
            .find_map(|candidate| bubbles_by_id.get(&candidate.bubble_id))
            .map(|bubble| normalize_created_at(&bubble.raw.created_at))
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let ended_at = turn_headers
            .iter()
            .rev()
            .find_map(|candidate| bubbles_by_id.get(&candidate.bubble_id))
            .map(|bubble| normalize_created_at(&bubble.raw.created_at));
        let duration_ms = ended_at
            .as_deref()
            .and_then(|end| duration_between_iso_ms(&started_at, end));
        let user_preview = bubbles_by_id
            .get(&header.bubble_id)
            .map(|bubble| preview_text(&bubble.raw.text))
            .unwrap_or_default();
        let body_event_count = turn_headers.len().saturating_sub(1);

        summaries.push(CursorIdeTurnSummary {
            turn_id: header.bubble_id.clone(),
            next_turn_id,
            turn_index: summaries.len(),
            started_at,
            ended_at,
            duration_ms,
            user_preview,
            event_count: turn_headers.len(),
            body_event_count,
        });
    }

    summaries
}

fn cursor_ide_summary_source_fingerprint(
    composer_created_at: i64,
    composer_last_updated_at: i64,
    source_updated_at: i64,
    order: &[RawComposerHeader],
) -> String {
    let mut hasher = StableFingerprint::new();
    hasher.write_str("cursor-ide-turn-summary-v2");
    hasher.write_i64(composer_created_at);
    hasher.write_i64(composer_last_updated_at);
    hasher.write_i64(source_updated_at);
    hasher.write_usize(order.len());
    if let Some(first) = order.first() {
        hasher.write_str(&first.bubble_id);
        hasher.write_i64(first.bubble_type);
    }
    if let Some(last) = order.last() {
        hasher.write_str(&last.bubble_id);
        hasher.write_i64(last.bubble_type);
    }

    for header in order {
        hasher.write_str(&header.bubble_id);
        hasher.write_i64(header.bubble_type);
    }

    hasher.finish_hex()
}

struct StableFingerprint {
    value: u64,
}

impl StableFingerprint {
    fn new() -> Self {
        Self {
            value: 0xcbf29ce484222325,
        }
    }

    fn write_str(&mut self, value: &str) {
        self.write_bytes(value.len().to_string().as_bytes());
        self.write_bytes(b":");
        self.write_bytes(value.as_bytes());
        self.write_bytes(b";");
    }

    fn write_i64(&mut self, value: i64) {
        self.write_str(&value.to_string());
    }

    fn write_usize(&mut self, value: usize) {
        self.write_str(&value.to_string());
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.value ^= u64::from(*byte);
            self.value = self.value.wrapping_mul(0x100000001b3);
        }
    }

    fn finish_hex(self) -> String {
        format!("{:016x}", self.value)
    }
}

fn load_cached_cursor_ide_turn_summaries(
    session_id: &str,
    source_updated_at: i64,
    source_bubble_count: usize,
    source_fingerprint: &str,
) -> Result<Option<Vec<CursorIdeTurnSummary>>, String> {
    let conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;
    let mut stmt = conn
        .prepare(
            "SELECT turn_id, next_turn_id, turn_index, started_at, ended_at, duration_ms,
                    user_preview, event_count, body_event_count
             FROM cursor_ide_turn_summaries
             WHERE session_id = ?1
               AND source_updated_at = ?2
               AND source_bubble_count = ?3
               AND source_fingerprint = ?4
             ORDER BY turn_index ASC",
        )
        .map_err(|err| format!("Failed to prepare Cursor IDE summary cache read: {}", err))?;
    let rows = stmt
        .query_map(
            params![
                session_id,
                source_updated_at,
                source_bubble_count as i64,
                source_fingerprint,
            ],
            |row| {
                let turn_index: i64 = row.get(2)?;
                let event_count: i64 = row.get(7)?;
                let body_event_count: i64 = row.get(8)?;
                Ok(CursorIdeTurnSummary {
                    turn_id: row.get(0)?,
                    next_turn_id: row.get(1)?,
                    turn_index: turn_index.max(0) as usize,
                    started_at: row.get(3)?,
                    ended_at: row.get(4)?,
                    duration_ms: row.get(5)?,
                    user_preview: row.get(6)?,
                    event_count: event_count.max(0) as usize,
                    body_event_count: body_event_count.max(0) as usize,
                })
            },
        )
        .map_err(|err| format!("Failed to read Cursor IDE summary cache: {}", err))?;

    let summaries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to decode Cursor IDE summary cache: {}", err))?;

    if summaries.is_empty() {
        Ok(None)
    } else {
        Ok(Some(summaries))
    }
}

fn upsert_cursor_ide_turn_summaries(
    session_id: &str,
    composer_id: &str,
    source_updated_at: i64,
    source_bubble_count: usize,
    source_fingerprint: &str,
    summaries: &[CursorIdeTurnSummary],
) -> Result<(), String> {
    let mut conn = get_connection().map_err(|err| format!("Failed to open cache DB: {}", err))?;
    let tx = conn.transaction().map_err(|err| {
        format!(
            "Failed to start Cursor IDE summary cache transaction: {}",
            err
        )
    })?;
    tx.execute(
        "DELETE FROM cursor_ide_turn_summaries WHERE session_id = ?1",
        [session_id],
    )
    .map_err(|err| format!("Failed to clear stale Cursor IDE summaries: {}", err))?;

    let updated_at = chrono::Utc::now().to_rfc3339();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO cursor_ide_turn_summaries
                    (session_id, composer_id, turn_id, next_turn_id, turn_index, started_at,
                     ended_at, duration_ms, user_preview, event_count, body_event_count,
                     source_updated_at, source_bubble_count, source_fingerprint, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            )
            .map_err(|err| format!("Failed to prepare Cursor IDE summary cache write: {}", err))?;
        for summary in summaries {
            stmt.execute(params![
                session_id,
                composer_id,
                summary.turn_id.as_str(),
                summary.next_turn_id.as_deref(),
                summary.turn_index as i64,
                summary.started_at.as_str(),
                summary.ended_at.as_deref(),
                summary.duration_ms,
                summary.user_preview.as_str(),
                summary.event_count as i64,
                summary.body_event_count as i64,
                source_updated_at,
                source_bubble_count as i64,
                source_fingerprint,
                updated_at.as_str(),
            ])
            .map_err(|err| format!("Failed to write Cursor IDE summary cache: {}", err))?;
        }
    }

    tx.commit()
        .map_err(|err| format!("Failed to commit Cursor IDE summary cache: {}", err))?;
    Ok(())
}

fn composer_source_updated_at(
    conn: &Connection,
    composer_id: &str,
    composer: &RawComposerForOrder,
    order: &[RawComposerHeader],
) -> Result<i64, String> {
    let mut source_updated_at = composer.created_at.max(composer.last_updated_at);
    if let Some(last_header) = order.last().filter(|header| !header.bubble_id.is_empty()) {
        let key = format!("bubbleId:{}:{}", composer_id, last_header.bubble_id);
        let bubble_json: Option<String> = conn
            .query_row(
                "SELECT value FROM cursorDiskKV WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| format!("Failed to read Cursor latest bubble timestamp: {}", err))?;
        if let Some(value) = bubble_json {
            if let Ok(raw) = serde_json::from_str::<RawBubble>(&value) {
                let bubble_updated_at = parse_iso_to_epoch_ms(&raw.created_at);
                if bubble_updated_at > 0 {
                    source_updated_at = source_updated_at.max(bubble_updated_at);
                }
            }
        }
    }
    Ok(source_updated_at)
}

fn parse_iso_to_epoch_ms(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn duration_between_iso_ms(started_at: &str, ended_at: &str) -> Option<i64> {
    let start = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let end = chrono::DateTime::parse_from_rfc3339(ended_at).ok()?;
    Some((end - start).num_milliseconds().max(0))
}

fn preview_text(text: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 160;
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    normalized.chars().take(MAX_PREVIEW_CHARS).collect()
}

fn fallback_turn_created_at(
    order: &[RawComposerHeader],
    bubbles_by_id: &HashMap<String, OrderedBubble>,
    index: usize,
) -> String {
    let next_user_index = order
        .iter()
        .enumerate()
        .skip(index + 1)
        .find(|(_, candidate)| candidate.bubble_type == CURSOR_BUBBLE_TYPE_USER)
        .map(|(candidate_index, _)| candidate_index)
        .unwrap_or(order.len());
    order[index..next_user_index]
        .iter()
        .find_map(|header| bubbles_by_id.get(&header.bubble_id))
        .map(|bubble| normalize_created_at(&bubble.raw.created_at))
        .unwrap_or_default()
}

fn build_fallback_user_chunk(
    session_id: &str,
    user_bubble_id: &str,
    created_at: String,
) -> ActivityChunk {
    let mut chunk = ActivityChunk::new(session_id, "raw", "user_message");
    chunk.chunk_id = format!("cursoride-user-{}", user_bubble_id);
    chunk.created_at = created_at;
    chunk.result = json!({
        "type": "user",
        "message": { "content": "User message not loaded.", "role": "user" },
    });
    chunk
}

fn build_unloaded_turn_placeholder_chunk(
    session_id: &str,
    order: &[RawComposerHeader],
    recent_ids: &HashSet<&str>,
    bubbles_by_id: &HashMap<String, OrderedBubble>,
    summaries_by_turn_id: &HashMap<String, CursorIdeTurnSummary>,
    index: usize,
) -> Option<ActivityChunk> {
    let header = order.get(index)?;
    if header.bubble_type != CURSOR_BUBBLE_TYPE_USER {
        return None;
    }

    let next_user_index = order
        .iter()
        .enumerate()
        .skip(index + 1)
        .find(|(_, candidate)| candidate.bubble_type == CURSOR_BUBBLE_TYPE_USER)
        .map(|(candidate_index, _)| candidate_index)
        .unwrap_or(order.len());
    let turn_headers = &order[index..next_user_index];
    let has_unloaded_body = turn_headers
        .iter()
        .skip(1)
        .any(|candidate| !recent_ids.contains(candidate.bubble_id.as_str()));

    if !has_unloaded_body {
        return None;
    }

    let next_user_bubble_id = if next_user_index < order.len() {
        order
            .get(next_user_index)
            .map(|candidate| candidate.bubble_id.clone())
    } else {
        None
    };
    let end_header = turn_headers.last()?;
    let end_bubble = bubbles_by_id
        .get(&end_header.bubble_id)
        .or_else(|| bubbles_by_id.get(&header.bubble_id))?;

    let summary = summaries_by_turn_id.get(&header.bubble_id);
    let body_event_count = summary
        .map(|cached_summary| cached_summary.body_event_count)
        .unwrap_or_else(|| turn_headers.len().saturating_sub(1));
    let event_count = summary
        .map(|cached_summary| cached_summary.event_count)
        .unwrap_or(turn_headers.len());
    let started_at = summary
        .map(|cached_summary| cached_summary.started_at.clone())
        .unwrap_or_else(|| normalize_created_at(&end_bubble.raw.created_at));
    let ended_at = summary
        .and_then(|cached_summary| cached_summary.ended_at.clone())
        .unwrap_or_else(|| normalize_created_at(&end_bubble.raw.created_at));
    let duration_ms = summary.and_then(|cached_summary| cached_summary.duration_ms);
    let content = format!("Cursor IDE turn {} is not loaded yet.", header.bubble_id);
    let mut chunk = ActivityChunk::new(session_id, "assistant", "assistant");
    chunk.chunk_id = format!("cursoride-unloaded-turn-{}", header.bubble_id);
    chunk.created_at = ended_at.clone();
    chunk.result = json!({
        "observation": content,
        "content": content,
        "role": "assistant",
        "is_delta": false,
        "is_full_content": true,
        "unloadedTurn": {
            "turnId": header.bubble_id,
            "nextTurnId": summary
                .and_then(|cached_summary| cached_summary.next_turn_id.clone())
                .or(next_user_bubble_id),
            "startedAt": started_at,
            "endedAt": ended_at,
            "durationMs": duration_ms,
            "eventCount": event_count,
            "bodyEventCount": body_event_count,
        },
    });
    Some(chunk)
}

/// Look up a `composer.content.{hash}` blob and return its raw text body,
/// or `None` if the key is missing. Cursor stores edit before/after file
/// content under these keys; the value is the file body as a plain string,
/// not JSON.
fn load_content_blob(conn: &Connection, content_id: &str) -> Option<String> {
    if !content_id.starts_with("composer.content.") {
        return None;
    }
    conn.query_row(
        "SELECT value FROM cursorDiskKV WHERE key = ?1",
        [content_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

// ============================================================================
// DB access
// ============================================================================

fn open_cursor_db() -> Option<Connection> {
    let path = cursor_db_path()?;
    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

fn cursor_db_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;

    #[cfg(target_os = "macos")]
    let path = home
        .join("Library")
        .join("Application Support")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "linux")]
    let path = home
        .join(".config")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    #[cfg(target_os = "windows")]
    let path = home
        .join("AppData")
        .join("Roaming")
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb");

    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn load_bubble_order(
    conn: &Connection,
    composer_id: &str,
) -> Result<Vec<RawComposerHeader>, String> {
    Ok(load_composer_for_order(conn, composer_id)?.full_conversation_headers_only)
}

fn load_composer_for_order(
    conn: &Connection,
    composer_id: &str,
) -> Result<RawComposerForOrder, String> {
    let key = format!("composerData:{}", composer_id);
    let json_str: String = match conn.query_row(
        "SELECT value FROM cursorDiskKV WHERE key = ?1",
        [&key],
        |row| row.get(0),
    ) {
        Ok(val) => val,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(RawComposerForOrder::default()),
        Err(err) => return Err(format!("Failed to read composer {}: {}", composer_id, err)),
    };

    serde_json::from_str(&json_str)
        .map_err(|err| format!("Failed to parse composer {}: {}", composer_id, err))
}

fn load_bubbles_by_id(
    conn: &Connection,
    composer_id: &str,
    order: &[RawComposerHeader],
) -> Result<Vec<OrderedBubble>, String> {
    let keyed_headers: Vec<(&RawComposerHeader, String)> = order
        .iter()
        .filter(|header| !header.bubble_id.is_empty())
        .map(|header| {
            (
                header,
                format!("bubbleId:{}:{}", composer_id, header.bubble_id),
            )
        })
        .collect();
    if keyed_headers.is_empty() {
        return Ok(vec![]);
    }

    let mut values_by_key = HashMap::with_capacity(keyed_headers.len());
    for chunk in keyed_headers.chunks(SQLITE_IN_QUERY_CHUNK_SIZE) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT key, value FROM cursorDiskKV WHERE key IN ({})",
            placeholders
        );
        let keys = chunk
            .iter()
            .map(|(_, key)| key.as_str())
            .collect::<Vec<_>>();
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| format!("Failed to prepare bubble query: {}", err))?;
        let rows = stmt
            .query_map(params_from_iter(keys), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| format!("Failed to read bubbles: {}", err))?;

        for row in rows {
            let (key, value) = row.map_err(|err| format!("Failed to read bubble row: {}", err))?;
            values_by_key.insert(key, value);
        }
    }

    let mut out = Vec::with_capacity(keyed_headers.len());
    for (header, key) in keyed_headers {
        let Some(json_str) = values_by_key.get(&key) else {
            continue;
        };

        match serde_json::from_str::<RawBubble>(json_str) {
            Ok(raw) => out.push(OrderedBubble {
                bubble_id: header.bubble_id.clone(),
                bubble_type: header.bubble_type,
                raw,
            }),
            // Per `_TEMPLATE.md`-style lenient parsing: if Cursor changes a
            // bubble's shape, we skip that single bubble rather than failing
            // the whole session.
            Err(_) => continue,
        }
    }

    Ok(out)
}

// ============================================================================
// Bubble → ActivityChunk normalization
// ============================================================================

const CURSOR_BUBBLE_TYPE_USER: i64 = 1;
const CURSOR_BUBBLE_TYPE_ASSISTANT: i64 = 2;

fn bubbles_to_chunks(
    conn: &Connection,
    session_id: &str,
    bubbles: &[OrderedBubble],
    composer_context: &CursorComposerContext,
) -> Vec<ActivityChunk> {
    let mut chunks = Vec::with_capacity(bubbles.len());

    for ob in bubbles {
        // Prefer the bubble's own `type`, fall back to the header's `type`
        // (the header is what `composerData.fullConversationHeadersOnly`
        // exposes — used as a backstop when the bubble blob is malformed).
        let bubble_type = if ob.raw.bubble_type != 0 {
            ob.raw.bubble_type
        } else {
            ob.bubble_type
        };

        match bubble_type {
            CURSOR_BUBBLE_TYPE_USER => {
                if let Some(subagent_info) = composer_context.subagent_info.as_ref() {
                    if let Some(chunk) =
                        cursor_subagent_prompt_bubble_to_chunk(session_id, ob, subagent_info)
                    {
                        chunks.push(chunk);
                    }
                } else if let Some(chunk) = user_bubble_to_chunk(session_id, ob) {
                    chunks.push(chunk);
                }
            }
            CURSOR_BUBBLE_TYPE_ASSISTANT => {
                if let Some(tool_chunk) = assistant_tool_bubble_to_chunk(conn, session_id, ob) {
                    chunks.push(tool_chunk);
                } else if let Some(text_chunk) = assistant_text_bubble_to_chunk(session_id, ob) {
                    chunks.push(text_chunk);
                }
                // Empty assistant bookkeeping bubbles are silently dropped.
            }
            _ => {
                // Unknown bubble type — skip rather than guess.
            }
        }
    }

    chunks
}

fn cursor_subagent_prompt_bubble_to_chunk(
    session_id: &str,
    ob: &OrderedBubble,
    subagent_info: &RawCursorSubagentInfo,
) -> Option<ActivityChunk> {
    let prompt = ob.raw.text.trim();
    if prompt.is_empty() {
        return None;
    }

    let description = prompt.lines().next().unwrap_or("Cursor subagent").trim();
    let mut chunk = ActivityChunk::new(session_id, "tool_call", "subagent");
    chunk.chunk_id = format!("cursoride-subagent-prompt-{}", ob.bubble_id);
    chunk.created_at = normalize_created_at(&ob.raw.created_at);
    chunk.args = json!({
        "description": description,
        "prompt": prompt,
        "subagent_type": subagent_info.subagent_type_name.as_str(),
        "parentComposerId": subagent_info.parent_composer_id.as_str(),
        "cursorToolCallId": subagent_info.tool_call_id.as_str(),
    });
    chunk.result = json!({
        "success": true,
        "status": "completed",
        "call_id": subagent_info.tool_call_id.as_str(),
    });
    Some(chunk)
}

fn user_bubble_to_chunk(session_id: &str, ob: &OrderedBubble) -> Option<ActivityChunk> {
    let text = ob.raw.text.trim();
    let content = if text.is_empty() {
        "User message not loaded."
    } else {
        text
    };
    let mut chunk = ActivityChunk::new(session_id, "raw", "user_message");
    chunk.chunk_id = format!("cursoride-user-{}", ob.bubble_id);
    chunk.created_at = normalize_created_at(&ob.raw.created_at);
    chunk.result = json!({
        "type": "user",
        "message": { "content": content, "role": "user" },
    });
    Some(chunk)
}

fn assistant_text_bubble_to_chunk(session_id: &str, ob: &OrderedBubble) -> Option<ActivityChunk> {
    let text = ob.raw.text.trim();
    if text.is_empty() {
        return None;
    }
    let mut chunk = ActivityChunk::new(session_id, "assistant", "assistant");
    chunk.chunk_id = format!("cursoride-asst-{}", ob.bubble_id);
    chunk.created_at = normalize_created_at(&ob.raw.created_at);
    chunk.result = json!({
        "observation": text,
        "content": text,
        "role": "assistant",
        "is_delta": false,
        "is_full_content": true,
    });
    Some(chunk)
}

fn assistant_tool_bubble_to_chunk(
    conn: &Connection,
    session_id: &str,
    ob: &OrderedBubble,
) -> Option<ActivityChunk> {
    let tfd = ob.raw.tool_former_data.as_ref()?;
    if tfd.name.is_empty() {
        return None;
    }

    let canonical = cursor_tool_name_to_canonical(&tfd.name);

    let mut args = parse_inner_json(&tfd.params);
    let mut result_payload = parse_inner_json(&tfd.result);
    merge_cursor_additional_data(&mut result_payload, &tfd.additional_data);

    // Translate Cursor's per-tool field names into the canonical names our
    // frontend extractors (`fileExtractors.ts`, `editExtractors.ts`, etc.)
    // expect, so existing chat blocks render Cursor history identically to
    // CLI agent output. See SCHEMA.md for the per-tool field mapping.
    normalize_args_for_canonical(canonical, &tfd.name, &mut args);
    normalize_result_for_canonical(conn, canonical, &tfd.name, &mut result_payload);
    // Cross-field rewrites that need both args and result in scope
    // (e.g. task_v2 lifts `result.agentId` onto `args.subagentSessionId`).
    link_subagent_session(canonical, &mut args, &mut result_payload);
    resolve_ask_question_answers(canonical, &args, &mut result_payload);

    let mut chunk = ActivityChunk::new(session_id, "tool_call", canonical);
    chunk.chunk_id = format!("cursoride-tool-{}", ob.bubble_id);
    chunk.created_at = normalize_created_at(&ob.raw.created_at);
    chunk.args = args;
    chunk.result = enrich_tool_result(result_payload, tfd);

    Some(chunk)
}

// ============================================================================
// Per-canonical field normalization
//
// Cursor IDE keeps each tool's own field names (`targetFile`, `globPattern`,
// `relativeWorkspacePath`, `finalTodos`, …). Our frontend extractors expect
// canonical names (`target_file`, `pattern`, `file_path`, `todos`, …). We
// translate at parse time — once, here — instead of in every extractor.
// ============================================================================

fn normalize_args_for_canonical(canonical: &str, cursor_name: &str, args: &mut Value) {
    let obj = match args.as_object_mut() {
        Some(map) => map,
        None => return,
    };
    match canonical {
        // read_file_v2 → read_file: `targetFile` is the absolute path; copy
        // it onto `target_file` so `extractFileData` finds it.
        "read_file" => {
            move_string_field(obj, "targetFile", "target_file");
            move_string_field(obj, "effectiveUri", "file_path");
        }
        // edit_file_v2 / delete_file: Cursor ships only the path here; the
        // diff lives in the result. Copy the path onto `file_path`.
        "edit_file_by_replace" | "delete_file" => {
            move_string_field(obj, "relativeWorkspacePath", "file_path");
        }
        // glob_file_search: Cursor uses `globPattern`; GlobAdapter reads
        // `pattern` / `glob`.
        "glob_file_search" => {
            move_string_field(obj, "globPattern", "pattern");
            move_string_field(obj, "targetDirectory", "path");
        }
        "run_command_line" => {
            move_string_field(obj, "commandDescription", "description");
        }
        // web_fetch is renamed to web_search but keeps Cursor's `url` field.
        // `WebSearchAdapter` reads `query` only — surface the URL there too
        // so the card shows something meaningful.
        "web_search" => {
            if cursor_name == "web_fetch" {
                if let Some(Value::String(url)) = obj.get("url").cloned() {
                    obj.entry("query".to_string()).or_insert(Value::String(url));
                }
            }
        }
        _ => {}
    }
}

fn normalize_result_for_canonical(
    conn: &Connection,
    canonical: &str,
    _cursor_name: &str,
    result: &mut Value,
) {
    let obj = match result.as_object_mut() {
        Some(map) => map,
        None => return,
    };
    match canonical {
        // Cursor returns the whole file body under `contents`; our file
        // extractor reads `result.content` / `output`.
        "read_file" => {
            move_string_field(obj, "contents", "content");
        }
        // edit_file_v2 result is `{beforeContentId, afterContentId}` where
        // each id is a `composer.content.{hash}` SQLite key holding the raw
        // file body. Resolve both blobs and derive the actual touched lines.
        "edit_file_by_replace" => {
            let old_content = obj
                .get("beforeContentId")
                .and_then(|v| v.as_str())
                .and_then(|before_id| load_content_blob(conn, before_id));
            let new_content = obj
                .get("afterContentId")
                .and_then(|v| v.as_str())
                .and_then(|after_id| load_content_blob(conn, after_id));

            if let Some(text) = old_content.as_ref() {
                obj.insert("old_content".to_string(), Value::String(text.clone()));
            }
            if let Some(text) = new_content.as_ref() {
                obj.insert("new_content".to_string(), Value::String(text.clone()));
            }
            if let (Some(old_text), Some(new_text)) = (old_content.as_ref(), new_content.as_ref()) {
                let diff = build_cursor_edit_diff(old_text, new_text);
                obj.insert("linesAdded".to_string(), json!(diff.lines_added));
                obj.insert("linesRemoved".to_string(), json!(diff.lines_removed));
                if !diff.diff_string.is_empty() {
                    obj.insert("diffString".to_string(), Value::String(diff.diff_string));
                }
            }
        }
        // todo_write result puts the list under `finalTodos`; our extractor
        // reads `result.todos` (or `success.todos`).
        "manage_todo" => {
            if let Some(todos) = obj.remove("finalTodos") {
                obj.insert("todos".to_string(), todos);
            }
        }
        // task_v2 result is `{agentId: "<uuid>"}`. The `agentId` itself is
        // lifted onto `args.subagentSessionId` by `link_subagent_session`
        // (see below) so the Rust subagent extractor and the frontend
        // `SubagentBlock` can replay the child composer's events. We only
        // need to mark success here so the block doesn't fall back to the
        // generic "completed-without-content" state.
        "subagent" => {
            obj.entry("success".to_string())
                .or_insert(Value::Bool(true));
        }
        _ => {}
    }
}

/// Cross-field linkage step that runs after both args and result have been
/// normalized for the canonical tool. The only consumer today is `subagent`:
/// Cursor returns the spawned child composer's id under `result.agentId`,
/// but our subagent extractor (`extract_subagent_data`) reads
/// `args.subagentSessionId`. We move-and-rename the field here, prefixing
/// it with `cursoride-` so the id is usable as a top-level session id by
/// the frontend EventStore lazy loader (`ensureCursorIdeEventsInStore`).
///
/// Empty / non-string values are left alone — the SubagentBlock's fallback
/// path (no nested session) renders the prompt + description without
/// crashing, so this stays defensive.
fn link_subagent_session(canonical: &str, args: &mut Value, result: &mut Value) {
    if canonical != "subagent" {
        return;
    }
    let result_obj = match result.as_object_mut() {
        Some(map) => map,
        None => return,
    };
    let agent_id = match result_obj.remove("agentId") {
        Some(Value::String(value)) if !value.is_empty() => value,
        Some(other) => {
            // Not a string we can prefix — keep the original value on the
            // result so we don't silently drop data we don't understand.
            result_obj.insert("agentId".to_string(), other);
            return;
        }
        None => return,
    };
    let prefixed = format!("{}{}", CURSORIDE_SESSION_PREFIX, agent_id);
    if let Some(args_obj) = args.as_object_mut() {
        args_obj
            .entry("subagentSessionId".to_string())
            .or_insert(Value::String(prefixed));
    }
}

/// Translate Cursor's `ask_question` result payload into the shape our
/// `AskQuestionEvent` / `extractAnsweredData` expects.
///
/// Cursor wire format:
/// ```jsonc
/// params:  { "questions": [{ "id": "q1", "prompt": "...", "options": [{ "id": "opt", "label": "..." }] }] }
/// result:  { "answers":   [{ "questionId": "opt" }] }
/// ```
///
/// ORGII canonical format the FE extractor reads:
/// ```jsonc
/// result:  { "status": "answered", "answers": [["<option label>"], ...] }
/// ```
///
/// Per-question we look up the chosen option in `args.questions[idx].options`
/// by id and substitute its `label`. If the option id cannot be resolved we
/// fall back to surfacing the raw id string so the user still sees something.
/// We also flip the result `status` to `"answered"` so `resolveDisplayStatus`
/// doesn't classify the card as skipped just because Cursor's own status field
/// said `completed`.
fn resolve_ask_question_answers(canonical: &str, args: &Value, result: &mut Value) {
    if canonical != "ask_user_questions" {
        return;
    }
    let questions = args.get("questions").and_then(|v| v.as_array());
    let result_obj = match result.as_object_mut() {
        Some(map) => map,
        None => return,
    };

    let raw_answers = match result_obj.remove("answers") {
        Some(Value::Array(arr)) => arr,
        Some(other) => {
            // Unknown shape — put it back and bail so we don't drop data.
            result_obj.insert("answers".to_string(), other);
            return;
        }
        None => return,
    };

    let mut converted: Vec<Value> = Vec::with_capacity(raw_answers.len());
    for (idx, answer) in raw_answers.into_iter().enumerate() {
        let option_id = match &answer {
            Value::Object(map) => map
                .get("questionId")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            Value::String(s) => Some(s.clone()),
            _ => None,
        };

        let label = option_id.as_ref().and_then(|id| {
            questions
                .and_then(|qs| qs.get(idx))
                .and_then(|q| q.get("options"))
                .and_then(|opts| opts.as_array())
                .and_then(|opts| {
                    opts.iter().find_map(|opt| {
                        let opt_id = opt.get("id").and_then(|v| v.as_str())?;
                        if opt_id == id {
                            opt.get("label")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                        } else {
                            None
                        }
                    })
                })
        });

        let final_text = label.or(option_id).unwrap_or_default();
        converted.push(Value::Array(vec![Value::String(final_text)]));
    }

    result_obj.insert("answers".to_string(), Value::Array(converted));
    result_obj
        .entry("status".to_string())
        .or_insert_with(|| Value::String("answered".to_string()));
}

struct CursorEditDiff {
    diff_string: String,
    lines_added: usize,
    lines_removed: usize,
}

fn build_cursor_edit_diff(old_content: &str, new_content: &str) -> CursorEditDiff {
    let text_diff = similar::TextDiff::from_lines(old_content, new_content);
    let diff_string = text_diff
        .unified_diff()
        .context_radius(3)
        .header("before", "after")
        .to_string();
    let mut lines_added = 0;
    let mut lines_removed = 0;
    for change in text_diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => lines_added += 1,
            similar::ChangeTag::Delete => lines_removed += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    CursorEditDiff {
        diff_string,
        lines_added,
        lines_removed,
    }
}

fn move_string_field(obj: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if obj.contains_key(to) {
        return;
    }
    if let Some(Value::String(value)) = obj.get(from).cloned() {
        if !value.is_empty() {
            obj.insert(to.to_string(), Value::String(value));
        }
    }
}

/// Map a Cursor IDE tool's string id to our canonical tool name so the
/// frontend's `chat_block` / extractor / label registry picks it up.
///
/// Unknown names pass through unchanged — the alias map and registry will
/// fall back to `tool_call` (`Fallback` block) for them.
fn cursor_tool_name_to_canonical(name: &str) -> &str {
    match name {
        "read_file_v2" => "read_file",
        "edit_file_v2" => "edit_file_by_replace",
        "delete_file" => "delete_file",
        "run_terminal_command_v2" => "run_command_line",
        "glob_file_search" => "glob_file_search",
        "read_lints" => "query_lsp",
        "ripgrep_raw_search" => "grep",
        "semantic_search_full" => "codebase_search",
        "todo_write" => "manage_todo",
        "web_fetch" => "web_search",
        "task_v2" => "subagent",
        // Cursor's clarification tool. Shape:
        //   params:  { questions: [{ id, prompt, options: [{ id, label }] }] }
        //   result:  { answers:   [{ questionId: "<option id>" }] }
        // Both shapes are translated into the canonical
        // `ask_user_questions` contract in `normalize_result_for_canonical`
        // so the existing ask-question chat block / simulator widget can
        // render Cursor history identically to live ORGII sessions.
        "ask_question" => "ask_user_questions",
        // Names without a built-in equivalent are kept verbatim and render
        // through the Fallback chat block. See fixtures/SCHEMA.md.
        other => other,
    }
}

/// Cursor stores tool args/result as JSON-encoded strings. Parse them, and
/// fall back to a string-valued payload if parsing fails — never silently
/// drop the data.
fn parse_inner_json(raw: &str) -> Value {
    if raw.is_empty() {
        return Value::Object(Default::default());
    }
    match serde_json::from_str::<Value>(raw) {
        Ok(value) => value,
        Err(_) => json!({ "raw": raw }),
    }
}

fn merge_cursor_additional_data(result: &mut Value, additional_data: &Value) {
    let additional = match additional_data.as_object() {
        Some(map) if !map.is_empty() => map,
        _ => return,
    };
    if !result.is_object() {
        *result = json!({ "value": result.clone() });
    }
    let result_obj = match result.as_object_mut() {
        Some(map) => map,
        None => return,
    };
    for (key, value) in additional {
        result_obj.entry(key.clone()).or_insert(value.clone());
    }
}

/// Attach `call_id` and `status` to the tool result so the existing extractors
/// and chat blocks recognize it the same way they would a `cursor-agent` CLI
/// chunk. Never overwrites fields the inner JSON already provides.
fn enrich_tool_result(mut payload: Value, tfd: &RawToolFormerData) -> Value {
    if !payload.is_object() {
        // Wrap scalar / array payloads so we always have a dict to enrich.
        payload = json!({ "value": payload });
    }
    if let Some(obj) = payload.as_object_mut() {
        if let Some(additional) = tfd.additional_data.as_object() {
            if !additional.is_empty() {
                obj.entry("cursorAdditionalData".to_string())
                    .or_insert_with(|| tfd.additional_data.clone());
            }
        }
        if !tfd.tool_call_id.is_empty() {
            obj.entry("call_id".to_string())
                .or_insert_with(|| Value::String(tfd.tool_call_id.clone()));
        }
        if !tfd.status.is_empty() {
            obj.entry("status".to_string())
                .or_insert_with(|| Value::String(tfd.status.clone()));
        }
    }
    payload
}

/// Cursor stores `createdAt` as ISO-8601. Pass through if it parses; otherwise
/// fall back to "now" so downstream code that orders by timestamp doesn't
/// crash. The canonical order is the composer header order, not timestamps,
/// so this fallback only affects display formatting.
fn normalize_created_at(raw: &str) -> String {
    if !raw.is_empty() && chrono::DateTime::parse_from_rfc3339(raw).is_ok() {
        return raw.to_string();
    }
    chrono::Utc::now().to_rfc3339()
}

// ============================================================================
// Session id prefix
// ============================================================================

/// Frontend-side session id prefix for Cursor IDE history sessions.
/// Kept here (not in a shared `types` module) because every consumer either
/// crosses this module's API surface or works with bare composer UUIDs.
pub const CURSORIDE_SESSION_PREFIX: &str = "cursoride-";

/// Strip the `cursoride-` prefix to recover the bare composer UUID Cursor
/// stores. Returns the input unchanged if no prefix is present (defensive —
/// callers should always pass the prefixed form, but a missing prefix should
/// not silently surface as a "session not found" error in normal operation).
fn strip_session_prefix(session_id: &str) -> &str {
    session_id
        .strip_prefix(CURSORIDE_SESSION_PREFIX)
        .unwrap_or(session_id)
}

#[cfg(test)]
#[path = "cursor_db_history_tests.rs"]
mod tests;
