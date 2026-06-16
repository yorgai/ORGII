use core_types::key_source::KeySource;
use database::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use crate::agent_sessions::unified_stats::display::generate_display_label;
use crate::agent_sessions::unified_stats::status::is_active_status;
use crate::agent_sessions::unified_stats::types::{SessionAggregateRecord, SessionCategory};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteShareMode {
    Readonly,
}

impl RemoteShareMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Readonly => "readonly",
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "readonly" => Ok(Self::Readonly),
            other => Err(format!("Unknown remote share mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteMirrorStatus {
    Connecting,
    Live,
    Disconnected,
    Ended,
}

impl RemoteMirrorStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Live => "live",
            Self::Disconnected => "disconnected",
            Self::Ended => "ended",
        }
    }

    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "connecting" => Ok(Self::Connecting),
            "live" => Ok(Self::Live),
            "disconnected" => Ok(Self::Disconnected),
            "ended" => Ok(Self::Ended),
            other => Err(format!("Unknown remote mirror status: {other}")),
        }
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn init_remote_shared_session_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS remote_shared_sessions (
            session_id TEXT PRIMARY KEY,
            source_session_id TEXT NOT NULL,
            share_id TEXT NOT NULL,
            source_category TEXT NOT NULL,
            share_mode TEXT NOT NULL CHECK (share_mode IN ('readonly')),
            name TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('connecting', 'live', 'disconnected', 'ended')),
            repo_name TEXT,
            repo_path TEXT,
            model TEXT,
            cli_agent_type TEXT,
            source_peer_label TEXT,
            metadata_json TEXT,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_connected_at TEXT,
            ended_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_remote_shared_sessions_source_session_id
            ON remote_shared_sessions(source_session_id);
        CREATE INDEX IF NOT EXISTS idx_remote_shared_sessions_updated_at
            ON remote_shared_sessions(updated_at);",
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSharedSessionRecord {
    pub session_id: String,
    pub source_session_id: String,
    pub share_id: String,
    pub source_category: SessionCategory,
    pub share_mode: RemoteShareMode,
    pub name: String,
    pub status: RemoteMirrorStatus,
    pub repo_name: Option<String>,
    pub repo_path: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "cliAgentType")]
    pub cli_agent_type: Option<String>,
    pub source_peer_label: Option<String>,
    pub metadata_json: Option<String>,
    pub total_tokens: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_connected_at: Option<String>,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRemoteSharedSessionRequest {
    pub session_id: String,
    pub source_session_id: String,
    pub share_id: String,
    pub source_category: SessionCategory,
    pub share_mode: RemoteShareMode,
    pub name: String,
    pub status: RemoteMirrorStatus,
    pub repo_name: Option<String>,
    pub repo_path: Option<String>,
    pub model: Option<String>,
    #[serde(rename = "cliAgentType")]
    pub cli_agent_type: Option<String>,
    pub source_peer_label: Option<String>,
    pub metadata_json: Option<String>,
    pub total_tokens: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRemoteSharedSessionRequest {
    pub session_id: String,
    pub name: Option<String>,
    pub status: Option<RemoteMirrorStatus>,
    pub repo_name: Option<Option<String>>,
    pub repo_path: Option<Option<String>>,
    pub model: Option<Option<String>>,
    #[serde(rename = "cliAgentType")]
    pub cli_agent_type: Option<Option<String>>,
    pub source_peer_label: Option<Option<String>>,
    pub metadata_json: Option<Option<String>>,
    pub total_tokens: Option<i64>,
    pub last_connected_at: Option<Option<String>>,
    pub ended_at: Option<Option<String>>,
}

struct RemoteSharedSessionRow {
    session_id: String,
    source_session_id: String,
    share_id: String,
    source_category: String,
    share_mode: String,
    name: String,
    status: String,
    repo_name: Option<String>,
    repo_path: Option<String>,
    model: Option<String>,
    cli_agent_type: Option<String>,
    source_peer_label: Option<String>,
    metadata_json: Option<String>,
    total_tokens: i64,
    created_at: String,
    updated_at: String,
    last_connected_at: Option<String>,
    ended_at: Option<String>,
}

fn row_to_record(row: RemoteSharedSessionRow) -> Result<RemoteSharedSessionRecord, String> {
    Ok(RemoteSharedSessionRecord {
        session_id: row.session_id,
        source_session_id: row.source_session_id,
        share_id: row.share_id,
        source_category: SessionCategory::parse(&row.source_category)?,
        share_mode: RemoteShareMode::parse(&row.share_mode)?,
        name: row.name,
        status: RemoteMirrorStatus::parse(&row.status)?,
        repo_name: row.repo_name,
        repo_path: row.repo_path,
        model: row.model,
        cli_agent_type: row.cli_agent_type,
        source_peer_label: row.source_peer_label,
        metadata_json: row.metadata_json,
        total_tokens: row.total_tokens,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_connected_at: row.last_connected_at,
        ended_at: row.ended_at,
    })
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteSharedSessionRow> {
    Ok(RemoteSharedSessionRow {
        session_id: row.get("session_id")?,
        source_session_id: row.get("source_session_id")?,
        share_id: row.get("share_id")?,
        source_category: row.get("source_category")?,
        share_mode: row.get("share_mode")?,
        name: row.get("name")?,
        status: row.get("status")?,
        repo_name: row.get("repo_name")?,
        repo_path: row.get("repo_path")?,
        model: row.get("model")?,
        cli_agent_type: row.get("cli_agent_type")?,
        source_peer_label: row.get("source_peer_label")?,
        metadata_json: row.get("metadata_json")?,
        total_tokens: row.get("total_tokens")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_connected_at: row.get("last_connected_at")?,
        ended_at: row.get("ended_at")?,
    })
}

fn get_remote_shared_session_with_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<RemoteSharedSessionRecord>, String> {
    let row = conn
        .query_row(
            "SELECT * FROM remote_shared_sessions WHERE session_id = ?1",
            params![session_id],
            read_row,
        )
        .optional()
        .map_err(|err| err.to_string())?;
    row.map(row_to_record).transpose()
}

pub fn list_remote_shared_sessions() -> Result<Vec<RemoteSharedSessionRecord>, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM remote_shared_sessions ORDER BY updated_at DESC")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], read_row)
        .map_err(|err| err.to_string())?;
    rows.map(|row| row.map_err(|err| err.to_string()).and_then(row_to_record))
        .collect()
}

pub fn get_remote_shared_session(
    session_id: &str,
) -> Result<Option<RemoteSharedSessionRecord>, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    get_remote_shared_session_with_conn(&conn, session_id)
}

pub fn create_remote_shared_session(
    request: CreateRemoteSharedSessionRequest,
) -> Result<RemoteSharedSessionRecord, String> {
    if !request.session_id.starts_with("sharedsession-") {
        return Err("Remote shared session IDs must start with sharedsession-".to_string());
    }

    let now = now_rfc3339();
    let total_tokens = request.total_tokens.unwrap_or(0);
    let conn = get_connection().map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO remote_shared_sessions (
            session_id, source_session_id, share_id, source_category, share_mode,
            name, status, repo_name, repo_path, model, cli_agent_type,
            source_peer_label, metadata_json, total_tokens, created_at, updated_at,
            last_connected_at, ended_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(session_id) DO UPDATE SET
            source_session_id = excluded.source_session_id,
            share_id = excluded.share_id,
            source_category = excluded.source_category,
            share_mode = excluded.share_mode,
            name = excluded.name,
            status = excluded.status,
            repo_name = excluded.repo_name,
            repo_path = excluded.repo_path,
            model = excluded.model,
            cli_agent_type = excluded.cli_agent_type,
            source_peer_label = excluded.source_peer_label,
            metadata_json = excluded.metadata_json,
            total_tokens = excluded.total_tokens,
            updated_at = excluded.updated_at,
            last_connected_at = excluded.last_connected_at,
            ended_at = excluded.ended_at",
        params![
            request.session_id,
            request.source_session_id,
            request.share_id,
            request.source_category.as_str(),
            request.share_mode.as_str(),
            request.name,
            request.status.as_str(),
            request.repo_name,
            request.repo_path,
            request.model,
            request.cli_agent_type,
            request.source_peer_label,
            request.metadata_json,
            total_tokens,
            now,
            now,
            Option::<String>::None,
            Option::<String>::None,
        ],
    )
    .map_err(|err| err.to_string())?;

    get_remote_shared_session_with_conn(&conn, &request.session_id)?.ok_or_else(|| {
        format!(
            "Remote shared session not found after create: {}",
            request.session_id
        )
    })
}

pub fn patch_remote_shared_session(
    request: PatchRemoteSharedSessionRequest,
) -> Result<RemoteSharedSessionRecord, String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    let mut record = get_remote_shared_session_with_conn(&conn, &request.session_id)?
        .ok_or_else(|| format!("Remote shared session not found: {}", request.session_id))?;

    if let Some(name) = request.name {
        record.name = name;
    }
    if let Some(status) = request.status {
        record.status = status;
    }
    if let Some(repo_name) = request.repo_name {
        record.repo_name = repo_name;
    }
    if let Some(repo_path) = request.repo_path {
        record.repo_path = repo_path;
    }
    if let Some(model) = request.model {
        record.model = model;
    }
    if let Some(cli_agent_type) = request.cli_agent_type {
        record.cli_agent_type = cli_agent_type;
    }
    if let Some(source_peer_label) = request.source_peer_label {
        record.source_peer_label = source_peer_label;
    }
    if let Some(metadata_json) = request.metadata_json {
        record.metadata_json = metadata_json;
    }
    if let Some(total_tokens) = request.total_tokens {
        record.total_tokens = total_tokens;
    }
    if let Some(last_connected_at) = request.last_connected_at {
        record.last_connected_at = last_connected_at;
    }
    if let Some(ended_at) = request.ended_at {
        record.ended_at = ended_at;
    }

    record.updated_at = now_rfc3339();
    conn.execute(
        "UPDATE remote_shared_sessions SET
            name = ?2,
            status = ?3,
            repo_name = ?4,
            repo_path = ?5,
            model = ?6,
            cli_agent_type = ?7,
            source_peer_label = ?8,
            metadata_json = ?9,
            total_tokens = ?10,
            updated_at = ?11,
            last_connected_at = ?12,
            ended_at = ?13
        WHERE session_id = ?1",
        params![
            record.session_id,
            record.name,
            record.status.as_str(),
            record.repo_name,
            record.repo_path,
            record.model,
            record.cli_agent_type,
            record.source_peer_label,
            record.metadata_json,
            record.total_tokens,
            record.updated_at,
            record.last_connected_at,
            record.ended_at,
        ],
    )
    .map_err(|err| err.to_string())?;

    Ok(record)
}

pub fn delete_remote_shared_session(session_id: &str) -> Result<(), String> {
    let conn = get_connection().map_err(|err| err.to_string())?;
    conn.execute(
        "DELETE FROM remote_shared_sessions WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn remote_shared_session_to_aggregate_record(
    session: RemoteSharedSessionRecord,
) -> SessionAggregateRecord {
    let status = session.status.as_str().to_string();
    let display_label = generate_display_label(&session.name, None);

    SessionAggregateRecord {
        session_id: session.session_id,
        name: session.name,
        status: status.clone(),
        created_at: session.created_at,
        updated_at: session.updated_at,
        category: SessionCategory::RemoteShared,
        user_input: None,
        repo_path: session.repo_path,
        repo_name: session.repo_name,
        branch: None,
        model: session.model,
        account_id: None,
        cli_agent_type: session.cli_agent_type,
        key_source: KeySource::OwnKey,
        tier: None,
        pid: None,
        total_tokens: session.total_tokens,
        worktree_path: None,
        worktree_branch: None,
        base_branch: None,
        merge_status: None,
        background: false,
        is_active: is_active_status(&status),
        display_label,
        parent_session_id: None,
        org_member_id: None,
        agent_org_id: None,
        agent_org_name: None,
        agent_definition_id: None,
        agent_icon_id: Some("radio".to_string()),
        agent_display_name: Some("Shared Session".to_string()),
        agent_exec_mode: None,
        draft_text: None,
        reply_target_event_id: None,
        pinned: false,
        files_changed: None,
        lines_added: None,
        lines_removed: None,
        touched_files: None,
        source_session_id: Some(session.source_session_id),
        share_id: Some(session.share_id),
        source_category: Some(session.source_category),
        share_mode: Some(session.share_mode.as_str().to_string()),
        mirror_status: Some(status),
        source_peer_label: session.source_peer_label,
        last_connected_at: session.last_connected_at,
        ended_at: session.ended_at,
    }
}

#[tauri::command]
pub async fn remote_shared_session_create(
    request: CreateRemoteSharedSessionRequest,
) -> Result<RemoteSharedSessionRecord, String> {
    tokio::task::spawn_blocking(move || create_remote_shared_session(request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn remote_shared_session_patch(
    request: PatchRemoteSharedSessionRequest,
) -> Result<RemoteSharedSessionRecord, String> {
    tokio::task::spawn_blocking(move || patch_remote_shared_session(request))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn remote_shared_session_get(
    session_id: String,
) -> Result<Option<RemoteSharedSessionRecord>, String> {
    tokio::task::spawn_blocking(move || get_remote_shared_session(&session_id))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn remote_shared_session_list() -> Result<Vec<RemoteSharedSessionRecord>, String> {
    tokio::task::spawn_blocking(list_remote_shared_sessions)
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn remote_shared_session_delete(session_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || delete_remote_shared_session(&session_id))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}
