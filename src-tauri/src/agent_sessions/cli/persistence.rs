//! SQLite persistence for code sessions and chunks.

use chrono::Utc;
use rusqlite::{params, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use super::types::{
    session_defaults, KeySource, SessionRunner, SessionStatus, DEFAULT_CODE_SESSION_FLOW,
};
use agent_core::foundation::session_bridge;
use agent_core::session::AgentExecMode;
use core_types::activity::ActivityChunk;
use database::db::get_connection;

// ============================================
// Types
// ============================================

/// A code generation session record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeSession {
    pub session_id: String,
    pub name: String,
    pub status: SessionStatus,
    pub flow: String,
    pub runner: String,
    /// The CLI agent type (e.g. "claude_code", "cursor_cli").
    pub cli_agent_type: Option<String>,
    pub model: Option<String>,
    pub tier: Option<String>,
    pub account_id: Option<String>,
    pub repo_path: Option<String>,
    pub branch: Option<String>,
    pub user_input: Option<String>,
    pub proxy_token: Option<String>,
    pub proxy_url: Option<String>,
    #[serde(skip_serializing)]
    pub hosted_token: Option<String>,
    pub error_message: Option<String>,
    /// Computed sum of total_tokens from session_token_usage (per-round records).
    pub total_tokens: i64,
    pub pid: Option<i64>,
    pub cli_session_id: Option<String>,
    /// Proxy-side session ID (sess_xxx) for billing context and release.
    pub proxy_session_id: Option<String>,
    /// Worktree path for isolated parallel sessions.
    pub worktree_path: Option<String>,
    /// Branch name inside the worktree (e.g. `agent/abc123`).
    pub worktree_branch: Option<String>,
    /// Base branch the worktree was created from.
    pub base_branch: Option<String>,
    /// Merge status: pending, merged, conflict, skipped.
    pub merge_status: Option<String>,
    /// Whether this session was launched in "fire and forget" background mode.
    pub background: bool,
    /// Key source: own_key (BYOK) or hosted_key (market proxy).
    pub key_source: KeySource,
    /// Per-session execution mode. Mirrors `agent_sessions.agent_exec_mode`
    /// so CLI sessions can participate in the same Plan/Build UI and queue
    /// semantics as Rust-native agents.
    pub agent_exec_mode: Option<String>,
    /// Per-session unsent draft text. Mirror of the field on
    /// `agent_sessions`; written via `session_patch` from the chat
    /// composer. `None` means no draft.
    pub draft_text: Option<String>,
    /// Per-session reply target event id. Mirror of the field on
    /// `agent_sessions`. `None` means no reply banner is open.
    pub reply_target_event_id: Option<String>,
    /// Extra workspace folders granted at launch time (multi-root IDE
    /// workspaces). `None` or empty for single-repo launches. Stored as
    /// a JSON array of absolute paths; for `claude_code` and `codex`,
    /// each entry is forwarded as `--add-dir <path>` when the CLI is
    /// spawned.
    pub additional_directories: Option<Vec<String>>,
    pub parent_session_id: Option<String>,
    pub org_member_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliHistoryMutation {
    pub session_id: String,
    pub epoch: i64,
    pub reason: String,
    pub mutated_at: String,
}

/// Parameters for creating a new code session.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCodeSessionParams {
    pub name: Option<String>,
    pub flow: Option<String>,
    pub runner: Option<String>,
    /// CLI agent type. Deserialized from the `platform` JSON key for wire compat.
    #[serde(rename = "platform")]
    pub cli_agent_type: String,
    pub model: Option<String>,
    pub tier: Option<String>,
    pub account_id: Option<String>,
    pub repo_path: Option<String>,
    pub branch: Option<String>,
    pub proxy_token: Option<String>,
    pub proxy_url: Option<String>,
    pub hosted_token: Option<String>,
    /// Proxy-side session ID (sess_xxx) for billing context and release.
    pub proxy_session_id: Option<String>,
    /// Request worktree isolation for parallel execution.
    #[serde(default)]
    pub isolate: Option<bool>,
    /// Launch in background mode ("fire and forget" with completion notification).
    #[serde(default)]
    pub background: Option<bool>,
    /// Key source: "own_key" (BYOK) or "hosted_key" (market proxy).
    /// Defaults to "own_key" if not provided.
    pub key_source: Option<String>,
    /// Extra workspace folders granted at launch time (multi-root IDE
    /// workspaces). Empty / omitted for single-repo launches; for
    /// `claude_code` / `codex` each entry is forwarded as `--add-dir`.
    #[serde(default)]
    pub additional_directories: Option<Vec<String>>,
    pub parent_session_id: Option<String>,
    pub org_member_id: Option<String>,
}

// ============================================
// Session CRUD
// ============================================

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Create a new code session. Returns the session ID.
pub fn create_session(
    session_id: &str,
    params: &CreateCodeSessionParams,
) -> SqliteResult<CodeSession> {
    let conn = get_connection()?;
    let ts = now_iso();
    let name = params
        .name
        .clone()
        .unwrap_or_else(|| session_defaults::CODE_SESSION_NAME.to_string());
    let flow = params
        .flow
        .clone()
        .unwrap_or_else(|| DEFAULT_CODE_SESSION_FLOW.to_string());
    // Wire-typo guard: `runner` is read back via `SessionRunner::parse`
    // (typed enum) at every read site. If the caller passes a typo'd
    // string here, the row would be persisted as garbage and every
    // subsequent `row_to_session` would reject it as a
    // `FromSqlConversionFailure` — i.e. the session would be created
    // but unloadable. Reject at the entry point instead.
    let runner = match params.runner.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => SessionRunner::parse(raw)
            .ok_or_else(|| {
                rusqlite::Error::ToSqlConversionFailure(
                    format!("unknown SessionRunner value: {raw:?}").into(),
                )
            })?
            .to_string(),
        None => SessionRunner::Local.to_string(),
    };

    let background = params.background.unwrap_or(false);

    // Wire-typo guard for `key_source` — same reasoning as `runner`.
    // `row_to_session` will fail-closed on an unknown column value, so
    // accepting an unvalidated string here would create an unloadable
    // session row (the frontend would see a created session that can
    // never be opened). Validate at the write boundary.
    let key_source_str = match params.key_source.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => KeySource::parse(raw)
            .ok_or_else(|| {
                rusqlite::Error::ToSqlConversionFailure(
                    format!("unknown KeySource value: {raw:?}").into(),
                )
            })?
            .to_string(),
        None => KeySource::default().to_string(),
    };

    let additional_dirs_json: Option<String> = params
        .additional_directories
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));

    conn.execute(
        "INSERT INTO code_sessions
            (session_id, name, status, flow, runner, cli_agent_type, model, tier,
             account_id, repo_path, branch, proxy_token, proxy_url, hosted_token,
             proxy_session_id, background, key_source, additional_directories,
             parent_session_id, org_member_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
        params![
            session_id, name, SessionStatus::Pending.as_ref(), flow, runner, params.cli_agent_type,
            params.model, params.tier, params.account_id,
            params.repo_path, params.branch, params.proxy_token, params.proxy_url,
            params.hosted_token, params.proxy_session_id, background, key_source_str,
            additional_dirs_json, params.parent_session_id, params.org_member_id, ts, ts,
        ],
    )?;

    get_session(session_id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// Column list shared by get_session and list_sessions.
/// COALESCE(cli_agent_type, platform) provides backward compat for rows written before the migration.
const SESSION_COLUMNS: &str =
    "cs.session_id, cs.name, cs.status, cs.flow, cs.runner,
     COALESCE(cs.cli_agent_type, cs.platform), cs.model, cs.tier, cs.account_id, cs.repo_path, cs.branch, cs.user_input,
     cs.proxy_token, cs.proxy_url, cs.hosted_token, cs.error_message,
     COALESCE((SELECT SUM(total_tokens) FROM session_token_usage WHERE session_id = cs.session_id), 0),
     cs.pid, cs.cli_session_id, cs.proxy_session_id,
     cs.worktree_path, cs.worktree_branch, cs.base_branch, cs.merge_status,
     COALESCE(cs.background, 0),
     COALESCE(cs.key_source, 'own_key'),
     cs.agent_exec_mode, cs.draft_text, cs.reply_target_event_id,
     cs.additional_directories,
     cs.parent_session_id, cs.org_member_id,
     cs.created_at, cs.updated_at";

/// Get a session by ID.
pub fn get_session(session_id: &str) -> SqliteResult<Option<CodeSession>> {
    let conn = get_connection()?;
    let query = format!(
        "SELECT {} FROM code_sessions cs WHERE cs.session_id = ?1",
        SESSION_COLUMNS
    );
    let result = conn.query_row(&query, [session_id], row_to_session);
    match result {
        Ok(s) => Ok(Some(s)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// List all code sessions, newest first.
pub fn list_sessions() -> SqliteResult<Vec<CodeSession>> {
    let conn = get_connection()?;
    let query = format!(
        "SELECT {} FROM code_sessions cs ORDER BY cs.created_at DESC",
        SESSION_COLUMNS
    );
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([], row_to_session)?;
    rows.collect()
}

/// Update session status.
pub fn update_status(session_id: &str, status: SessionStatus) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let now = now_iso();
    let affected = if status.is_terminal() {
        conn.execute(
            "UPDATE code_sessions SET status = ?2, pid = NULL, updated_at = ?3 WHERE session_id = ?1",
            params![session_id, status.as_ref(), now],
        )?
    } else {
        conn.execute(
            "UPDATE code_sessions SET status = ?2, updated_at = ?3 WHERE session_id = ?1",
            params![session_id, status.as_ref(), now],
        )?
    };
    Ok(affected > 0)
}

/// Update session status with error message.
pub fn update_status_with_error(
    session_id: &str,
    status: SessionStatus,
    error: &str,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let now = now_iso();
    let affected = if status.is_terminal() {
        conn.execute(
            "UPDATE code_sessions SET status = ?2, error_message = ?3, pid = NULL, updated_at = ?4 WHERE session_id = ?1",
            params![session_id, status.as_ref(), error, now],
        )?
    } else {
        conn.execute(
            "UPDATE code_sessions SET status = ?2, error_message = ?3, updated_at = ?4 WHERE session_id = ?1",
            params![session_id, status.as_ref(), error, now],
        )?
    };
    Ok(affected > 0)
}

/// Store the PID of the CLI subprocess.
pub fn update_pid(session_id: &str, pid: u32) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET pid = ?2, updated_at = ?3 WHERE session_id = ?1",
        params![session_id, pid as i64, now_iso()],
    )?;
    Ok(affected > 0)
}

/// Clear the PID after the CLI subprocess exits.
pub fn clear_pid(session_id: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET pid = NULL, updated_at = ?2 WHERE session_id = ?1",
        params![session_id, now_iso()],
    )?;
    Ok(affected > 0)
}

// `updated_at` invariant — same as the parallel comment in
// `agent_core/core/session/persistence/crud/ops.rs`. `code_sessions.updated_at`
// reflects real conversation / lifecycle activity (status transitions,
// pid changes, worktree merges, message edits via `truncate_chunks_after`).
// Per-session config / composer state writes (model, draft, reply pin,
// proxy creds rotation, internal cli_session_id assignment) leave it
// alone so the sidebar order and Kanban time filter stay tied to user-
// visible activity.

fn resume_profile_key(account_id: Option<&str>) -> String {
    account_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("__session__")
        .to_string()
}

/// Store the CLI agent's own session/conversation ID for resume support.
/// Internal bookkeeping — does not bump `updated_at`.
pub fn update_cli_session_id(session_id: &str, cli_session_id: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let account_id: Option<String> = conn
        .query_row(
            "SELECT account_id FROM code_sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    update_cli_session_id_for_account(session_id, account_id.as_deref(), cli_session_id)
}

/// Store a CLI native session ID under the account/profile that launched the
/// process, not whatever account the session row may point at when the process
/// exits. This prevents a slow old process from writing account A's native
/// conversation id into account B's resume slot after a mid-turn switch.
pub fn update_cli_session_id_for_account(
    session_id: &str,
    account_id: Option<&str>,
    cli_session_id: &str,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let profile_key = resume_profile_key(account_id);
    let tx = conn.unchecked_transaction()?;
    let affected = tx.execute(
        "UPDATE code_sessions
         SET cli_session_id = CASE
             WHEN account_id IS ?3 THEN ?2
             ELSE cli_session_id
         END
         WHERE session_id = ?1",
        params![session_id, cli_session_id, account_id],
    )?;
    if affected == 0 {
        tx.commit()?;
        return Ok(false);
    }
    tx.execute(
        "INSERT INTO code_session_cli_resume_state
            (session_id, profile_key, cli_session_id, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_id, profile_key)
         DO UPDATE SET cli_session_id = excluded.cli_session_id,
                       updated_at = excluded.updated_at",
        params![session_id, profile_key, cli_session_id, now_iso()],
    )?;
    tx.commit()?;
    Ok(true)
}

pub fn get_cli_session_id_for_account(
    session_id: &str,
    account_id: Option<&str>,
) -> SqliteResult<Option<String>> {
    let conn = get_connection()?;
    let profile_key = resume_profile_key(account_id);
    conn.query_row(
        "SELECT cli_session_id
         FROM code_session_cli_resume_state
         WHERE session_id = ?1 AND profile_key = ?2",
        params![session_id, profile_key],
        |row| row.get(0),
    )
    .optional()
}

fn bump_history_mutation_with_tx(
    tx: &rusqlite::Transaction<'_>,
    session_id: &str,
    mutation_reason: &str,
    mutated_at: &str,
) -> SqliteResult<()> {
    tx.execute(
        "INSERT INTO code_session_history_mutations
            (session_id, epoch, reason, mutated_at)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(session_id)
         DO UPDATE SET epoch = epoch + 1,
                       reason = excluded.reason,
                       mutated_at = excluded.mutated_at",
        params![session_id, mutation_reason, mutated_at],
    )?;
    Ok(())
}

fn clear_cli_resume_state_with_tx(
    tx: &rusqlite::Transaction<'_>,
    session_id: &str,
    updated_at: Option<&str>,
    mutation_reason: &str,
) -> SqliteResult<bool> {
    tx.execute(
        "DELETE FROM code_session_cli_resume_state WHERE session_id = ?1",
        params![session_id],
    )?;

    let affected = if let Some(timestamp) = updated_at {
        tx.execute(
            "UPDATE code_sessions SET cli_session_id = NULL, updated_at = ?2 WHERE session_id = ?1",
            params![session_id, timestamp],
        )?
    } else {
        tx.execute(
            "UPDATE code_sessions SET cli_session_id = NULL WHERE session_id = ?1",
            params![session_id],
        )?
    };

    if affected > 0 {
        let mutated_at = updated_at.map(str::to_string).unwrap_or_else(now_iso);
        bump_history_mutation_with_tx(tx, session_id, mutation_reason, &mutated_at)?;
    }

    Ok(affected > 0)
}

pub fn clear_cli_resume_state(session_id: &str, mutation_reason: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let tx = conn.unchecked_transaction()?;
    let updated_at = now_iso();
    let cleared =
        clear_cli_resume_state_with_tx(&tx, session_id, Some(&updated_at), mutation_reason)?;
    tx.commit()?;
    Ok(cleared)
}

pub fn get_history_mutation(session_id: &str) -> SqliteResult<Option<CliHistoryMutation>> {
    let conn = get_connection()?;
    conn.query_row(
        "SELECT session_id, epoch, reason, mutated_at
         FROM code_session_history_mutations
         WHERE session_id = ?1",
        params![session_id],
        |row| {
            Ok(CliHistoryMutation {
                session_id: row.get(0)?,
                epoch: row.get(1)?,
                reason: row.get(2)?,
                mutated_at: row.get(3)?,
            })
        },
    )
    .optional()
}

fn mapped_cli_session_id_for_account_with_conn(
    conn: &rusqlite::Connection,
    session_id: &str,
    account_id: Option<&str>,
) -> SqliteResult<Option<String>> {
    let profile_key = resume_profile_key(account_id);
    conn.query_row(
        "SELECT cli_session_id
         FROM code_session_cli_resume_state
         WHERE session_id = ?1 AND profile_key = ?2",
        params![session_id, profile_key],
        |row| row.get(0),
    )
    .optional()
}

/// Update the model and/or account_id for mid-session switching.
/// Config write — does not bump `updated_at`.
pub fn update_model_and_account(
    session_id: &str,
    model: Option<&str>,
    account_id: Option<&str>,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let current: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT account_id, cli_session_id FROM code_sessions WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let mapped_cli_session_id = if let Some(target_account_id) = account_id {
        let mapped = mapped_cli_session_id_for_account_with_conn(
            &conn,
            session_id,
            Some(target_account_id),
        )?;
        match (mapped, current.as_ref()) {
            (Some(cli_session_id), _) => Some(cli_session_id),
            (None, Some((current_account_id, current_cli_session_id)))
                if current_account_id.as_deref() == Some(target_account_id) =>
            {
                current_cli_session_id.clone()
            }
            (None, _) => None,
        }
    } else {
        None
    };
    let affected = match (model, account_id) {
        (Some(model), Some(account_id)) => conn.execute(
            "UPDATE code_sessions
             SET model = ?2,
                 account_id = ?3,
                 cli_session_id = ?4
             WHERE session_id = ?1",
            params![session_id, model, account_id, mapped_cli_session_id],
        )?,
        (Some(model), None) => conn.execute(
            "UPDATE code_sessions SET model = ?2 WHERE session_id = ?1",
            params![session_id, model],
        )?,
        (None, Some(account_id)) => conn.execute(
            "UPDATE code_sessions
             SET account_id = ?2,
                 cli_session_id = ?3
             WHERE session_id = ?1",
            params![session_id, account_id, mapped_cli_session_id],
        )?,
        (None, None) => 0,
    };
    Ok(affected > 0)
}

/// Update the per-session execution mode on a CLI session row.
/// Mirrors `agent_core::session::persistence::update_agent_exec_mode`.
/// Does not bump `updated_at`; this is composer control state, not activity.
pub fn update_agent_exec_mode(session_id: &str, mode: &str) -> SqliteResult<bool> {
    let parsed = AgentExecMode::parse(mode).ok_or_else(|| {
        rusqlite::Error::ToSqlConversionFailure(
            format!("unknown AgentExecMode value: {mode:?}").into(),
        )
    })?;
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET agent_exec_mode = ?2 WHERE session_id = ?1",
        params![session_id, parsed.as_str()],
    )?;
    Ok(affected > 0)
}

/// Update the per-session unsent draft text on a CLI session row.
/// Mirror of `agent_core::session::persistence::update_draft_text` —
/// see that helper for the empty-string normalization rationale.
/// Composer state — does not bump `updated_at`.
pub fn update_draft_text(session_id: &str, text: Option<&str>) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let normalized = match text {
        Some(s) if !s.is_empty() => Some(s),
        _ => None,
    };
    let affected = conn.execute(
        "UPDATE code_sessions SET draft_text = ?2 WHERE session_id = ?1",
        params![session_id, normalized],
    )?;
    Ok(affected > 0)
}

/// Update the per-session reply target event id on a CLI session row.
/// Composer state — does not bump `updated_at`.
pub fn update_reply_target_event_id(
    session_id: &str,
    event_id: Option<&str>,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let normalized = match event_id {
        Some(s) if !s.is_empty() => Some(s),
        _ => None,
    };
    let affected = conn.execute(
        "UPDATE code_sessions SET reply_target_event_id = ?2 WHERE session_id = ?1",
        params![session_id, normalized],
    )?;
    Ok(affected > 0)
}

/// Update proxy credentials (token, URL, proxy_session_id) after re-allocation.
/// Token rotation is config — does not bump `updated_at`.
pub fn update_proxy_credentials(
    session_id: &str,
    proxy_token: &str,
    proxy_url: &str,
    proxy_session_id: Option<&str>,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET proxy_token = ?2, proxy_url = ?3, proxy_session_id = ?4 WHERE session_id = ?1",
        params![session_id, proxy_token, proxy_url, proxy_session_id],
    )?;
    Ok(affected > 0)
}

/// Delete a session and all its chunks (CASCADE) + per-round token usage records.
pub fn delete_session(session_id: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    conn.execute(
        "DELETE FROM code_session_chunks WHERE session_id = ?1",
        [session_id],
    )?;
    // Clean up per-round token usage records
    conn.execute(
        "DELETE FROM session_token_usage WHERE session_id = ?1",
        [session_id],
    )?;
    let affected = conn.execute(
        "DELETE FROM code_sessions WHERE session_id = ?1",
        [session_id],
    )?;
    Ok(affected > 0)
}

/// Sweep orphaned sessions on startup.
///
/// After an app crash or forced quit, CLI subprocess PIDs are stale and sessions
/// may be stuck in "running" or "pending". This marks them as "failed" and clears
/// their PID so the frontend no longer shows a spinning indicator.
pub fn sweep_stale_sessions() -> SqliteResult<usize> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET status = 'failed', pid = NULL, error_message = 'Session interrupted by app restart', updated_at = ?1 WHERE status IN ('running', 'pending')",
        params![now_iso()],
    )?;
    if affected > 0 {
        tracing::info!(
            "[CLI Persistence] Swept {} stale sessions to 'failed' on startup",
            affected
        );
    }
    Ok(affected)
}

// ============================================
// Chunk CRUD
// ============================================

/// Get the maximum sequence number for a session's chunks.
/// Returns -1 if no chunks exist (so base_sequence + 1 == 0 for first run).
pub fn max_chunk_sequence(session_id: &str) -> SqliteResult<i64> {
    let conn = get_connection()?;
    let max_seq: Option<i64> = conn.query_row(
        "SELECT MAX(sequence) FROM code_session_chunks WHERE session_id = ?1",
        [session_id],
        |row| row.get(0),
    )?;
    Ok(max_seq.unwrap_or(-1))
}

/// Store an ActivityChunk.
pub fn insert_chunk(chunk: &ActivityChunk, sequence: i64) -> SqliteResult<()> {
    let conn = get_connection()?;
    // `serde_json::to_string` on `serde_json::Value` is infallible — the
    // value tree was already validated when the chunk was constructed.
    // Using `expect` here (instead of the previous silent fallback to
    // `"{}"`) means any future schema break, not an empty fallback,
    // fails the write loud and clear and pairs symmetrically with the
    // load side which now refuses to silently substitute `{}` for a
    // corrupt row.
    let args_str = serde_json::to_string(&chunk.args)
        .expect("ActivityChunk.args -> JSON string is infallible for Value");
    let result_str = serde_json::to_string(&chunk.result)
        .expect("ActivityChunk.result -> JSON string is infallible for Value");

    conn.execute(
        "INSERT OR REPLACE INTO code_session_chunks
            (chunk_id, session_id, action_type, function,
             args_json, result_json, thread_id, process_id, sequence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            chunk.chunk_id,
            chunk.session_id,
            chunk.action_type,
            chunk.function,
            args_str,
            result_str,
            chunk.thread_id,
            chunk.process_id,
            sequence,
            chunk.created_at,
        ],
    )?;

    // Record lineage provenance for file-edit chunks (non-blocking, best-effort)
    let sid = chunk.session_id.clone();
    let func = chunk.function.clone();
    let args_for_lineage = args_str;
    std::thread::spawn(move || {
        project_management::lineage::event_hook::process_chunk(&sid, &func, &args_for_lineage);
    });

    Ok(())
}

/// Load all chunks for a session, ordered by sequence.
pub fn load_chunks(session_id: &str) -> SqliteResult<Vec<ActivityChunk>> {
    let conn = get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT chunk_id, session_id, action_type, function,
                args_json, result_json, thread_id, process_id, created_at
         FROM code_session_chunks
         WHERE session_id = ?1
         ORDER BY sequence ASC",
    )?;
    let rows = stmt.query_map([session_id], |row| {
        let args_str: String = row.get(4)?;
        let result_str: String = row.get(5)?;
        // The args/result columns are written as serialized JSON by the
        // chunk writer. Silently rendering a corrupt blob as `{}`
        // (the previous behaviour) made it impossible to tell whether
        // a tool call genuinely had no arguments or whether the row
        // had been corrupted out of band — both look identical to the
        // frontend, but the second case is a real data-integrity bug
        // that would have stayed invisible. Surface a typed
        // `FromSqlConversionFailure` instead so the loader returns
        // an error and the UI can show a real failure state.
        let args = serde_json::from_str::<serde_json::Value>(&args_str).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                format!("invalid args_json for chunk: {err}").into(),
            )
        })?;
        let result = serde_json::from_str::<serde_json::Value>(&result_str).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                format!("invalid result_json for chunk: {err}").into(),
            )
        })?;
        Ok(ActivityChunk {
            chunk_id: row.get(0)?,
            session_id: row.get(1)?,
            action_type: row.get(2)?,
            function: row.get(3)?,
            args,
            result,
            thread_id: row.get(6)?,
            process_id: row.get(7)?,
            created_at: row.get(8)?,
            broadcast_only: false,
        })
    })?;
    let chunks: Vec<ActivityChunk> = rows.collect::<SqliteResult<Vec<_>>>()?;
    tracing::info!(
        "[load_chunks] session={}, returned {} chunks",
        session_id,
        chunks.len()
    );
    Ok(chunks)
}

/// Truncate chunks at and after a specific timestamp.
/// Used for message editing — removes chunks at or after the given timestamp.
/// Also clears the CLI session ID so the next run starts fresh instead of resuming
/// from the CLI agent's saved state (which still has the old conversation).
pub fn truncate_chunks_after(session_id: &str, created_at: &str) -> SqliteResult<i64> {
    let conn = get_connection()?;

    let tx = conn.unchecked_transaction()?;
    let deleted = tx.execute(
        "DELETE FROM code_session_chunks WHERE session_id = ?1 AND created_at >= ?2",
        params![session_id, created_at],
    )?;

    // Clear cli_session_id so the agent starts fresh on re-submit. We do
    // bump `updated_at` here even though clearing the id is by itself
    // bookkeeping — message editing is real conversation activity, so
    // the session should float in time-bucketed views (sidebar / Kanban
    // filters). See the invariant note above.
    let updated_at = now_iso();
    clear_cli_resume_state_with_tx(
        &tx,
        session_id,
        Some(&updated_at),
        session_bridge::CLI_HISTORY_MUTATION_MESSAGE_TRUNCATE,
    )?;
    tx.commit()?;

    Ok(deleted as i64)
}

// ============================================
// Row mapper
// ============================================

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<CodeSession> {
    let status_str: String = row.get(2)?;
    let key_source_str: String = row.get(25)?;

    // DB columns must round-trip the typed enum. An unknown variant means
    // either DB corruption or an out-of-band write — surface it as a
    // `FromSqlConversionFailure` instead of silently mapping to a generic
    // default, which would mis-bill (key_source) or hide a stuck-state row
    // (status).
    let status = SessionStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            format!("unknown SessionStatus value: {status_str:?}").into(),
        )
    })?;
    let key_source = KeySource::parse(&key_source_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            25,
            rusqlite::types::Type::Text,
            format!("unknown KeySource value: {key_source_str:?}").into(),
        )
    })?;
    let agent_exec_mode: Option<String> = row.get(26)?;
    if let Some(mode) = agent_exec_mode.as_deref() {
        if AgentExecMode::parse(mode).is_none() {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                26,
                rusqlite::types::Type::Text,
                format!("unknown AgentExecMode value: {mode:?}").into(),
            ));
        }
    }

    Ok(CodeSession {
        session_id: row.get(0)?,
        name: row.get(1)?,
        status,
        flow: row.get(3)?,
        runner: row.get(4)?,
        cli_agent_type: row.get(5)?,
        model: row.get(6)?,
        tier: row.get(7)?,
        account_id: row.get(8)?,
        repo_path: row.get(9)?,
        branch: row.get(10)?,
        user_input: row.get(11)?,
        proxy_token: row.get(12)?,
        proxy_url: row.get(13)?,
        hosted_token: row.get(14)?,
        error_message: row.get(15)?,
        total_tokens: row.get(16)?,
        pid: row.get(17)?,
        cli_session_id: row.get(18)?,
        proxy_session_id: row.get(19)?,
        worktree_path: row.get(20)?,
        worktree_branch: row.get(21)?,
        base_branch: row.get(22)?,
        merge_status: row.get(23)?,
        background: row.get::<_, bool>(24).unwrap_or(false),
        key_source,
        agent_exec_mode,
        draft_text: row.get(27)?,
        reply_target_event_id: row.get(28)?,
        additional_directories: row
            .get::<_, Option<String>>(29)?
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .filter(|v| !v.is_empty()),
        parent_session_id: row.get(30)?,
        org_member_id: row.get(31)?,
        created_at: row.get(32)?,
        updated_at: row.get(33)?,
    })
}

/// Store worktree info after creating an isolated session.
pub fn update_worktree_info(
    session_id: &str,
    worktree_path: &str,
    worktree_branch: &str,
    base_branch: &str,
) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET worktree_path = ?2, worktree_branch = ?3, base_branch = ?4, \
         merge_status = 'pending', updated_at = ?5 WHERE session_id = ?1",
        params![
            session_id,
            worktree_path,
            worktree_branch,
            base_branch,
            now_iso()
        ],
    )?;
    Ok(affected > 0)
}

/// Update merge status for a session.
pub fn update_merge_status(session_id: &str, merge_status: &str) -> SqliteResult<bool> {
    let conn = get_connection()?;
    let affected = conn.execute(
        "UPDATE code_sessions SET merge_status = ?2, updated_at = ?3 WHERE session_id = ?1",
        params![session_id, merge_status, now_iso()],
    )?;
    Ok(affected > 0)
}

#[cfg(test)]
mod resume_state_tests {
    use super::*;
    use crate::test_utils::test_env;

    fn create_test_session(session_id: &str, account_id: &str) {
        create_session(
            session_id,
            &CreateCodeSessionParams {
                name: Some("resume state test".to_string()),
                flow: None,
                runner: None,
                cli_agent_type: "claude_code".to_string(),
                model: Some("claude-sonnet-4-6".to_string()),
                tier: None,
                account_id: Some(account_id.to_string()),
                repo_path: Some("/tmp".to_string()),
                branch: None,
                proxy_token: None,
                proxy_url: None,
                hosted_token: None,
                proxy_session_id: None,
                isolate: None,
                background: Some(false),
                key_source: Some("own_key".to_string()),
                additional_directories: None,
                parent_session_id: None,
                org_member_id: None,
            },
        )
        .expect("create test CLI session");
    }

    #[test]
    fn cli_resume_state_is_scoped_by_account_and_restored_on_switch_back() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-account-scope";
        create_test_session(session_id, "account-a");

        update_cli_session_id(session_id, "native-a-1").expect("store account A native id");
        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.cli_session_id.as_deref(), Some("native-a-1"));

        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B");
        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-b"));
        assert_eq!(session.cli_session_id, None);

        update_cli_session_id(session_id, "native-b-1").expect("store account B native id");
        update_model_and_account(session_id, Some("claude-opus-4-7"), Some("account-a"))
            .expect("switch back to account A");
        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-a"));
        assert_eq!(session.model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(session.cli_session_id.as_deref(), Some("native-a-1"));

        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch back to account B");
        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-b"));
        assert_eq!(session.cli_session_id.as_deref(), Some("native-b-1"));
    }

    #[test]
    fn model_switch_on_same_account_preserves_legacy_single_column_resume_id() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-same-account";
        create_test_session(session_id, "account-a");
        update_cli_session_id(session_id, "native-a-legacy").expect("store native id");

        update_model_and_account(session_id, Some("claude-opus-4-7"), Some("account-a"))
            .expect("switch model on same account");
        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.model.as_deref(), Some("claude-opus-4-7"));
        assert_eq!(session.cli_session_id.as_deref(), Some("native-a-legacy"));
    }

    #[test]
    fn old_process_resume_id_does_not_overwrite_current_account_column() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-stale-process";
        create_test_session(session_id, "account-a");
        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B while old account A process is still winding down");

        update_cli_session_id_for_account(session_id, Some("account-a"), "native-a-late")
            .expect("late account A process stores native id");

        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-b"));
        assert_eq!(session.cli_session_id, None);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id")
                .as_deref(),
            Some("native-a-late")
        );
    }

    #[test]
    fn clearing_cli_resume_state_removes_all_account_scoped_resume_state() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-clear-primitive";
        create_test_session(session_id, "account-a");
        update_cli_session_id(session_id, "native-a-1").expect("store account A native id");
        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B");
        update_cli_session_id(session_id, "native-b-1").expect("store account B native id");

        assert!(clear_cli_resume_state(
            session_id,
            session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND
        )
        .expect("clear resume state"));
        let mutation = get_history_mutation(session_id)
            .expect("load history mutation")
            .expect("history mutation exists");
        assert_eq!(mutation.epoch, 1);
        assert_eq!(
            mutation.reason,
            session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND
        );

        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.cli_session_id, None);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id"),
            None
        );
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-b"))
                .expect("load account B mapped id"),
            None
        );
    }

    #[test]
    fn account_switch_after_resume_clear_does_not_restore_old_native_id() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-clear-account-switch";
        create_test_session(session_id, "account-a");
        update_cli_session_id(session_id, "native-a-1").expect("store account A native id");
        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B");
        update_cli_session_id(session_id, "native-b-1").expect("store account B native id");

        clear_cli_resume_state(session_id, session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND)
            .expect("clear resume state");
        update_model_and_account(session_id, Some("claude-opus-4-7"), Some("account-a"))
            .expect("switch back to account A after clear");

        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-a"));
        assert_eq!(session.cli_session_id, None);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id"),
            None
        );
    }

    #[test]
    fn late_old_process_after_resume_clear_does_not_pollute_current_account_slot() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-clear-late-process";
        create_test_session(session_id, "account-a");
        update_cli_session_id(session_id, "native-a-1").expect("store account A native id");
        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B");
        update_cli_session_id(session_id, "native-b-1").expect("store account B native id");

        clear_cli_resume_state(session_id, session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND)
            .expect("clear resume state");
        update_model_and_account(session_id, Some("claude-opus-4-7"), Some("account-b"))
            .expect("remain on account B after clear");
        assert!(
            update_cli_session_id_for_account(session_id, Some("account-a"), "native-a-late")
                .expect("late account A process stores only account A slot")
        );

        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.account_id.as_deref(), Some("account-b"));
        assert_eq!(session.cli_session_id, None);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id")
                .as_deref(),
            Some("native-a-late")
        );
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-b"))
                .expect("load account B mapped id"),
            None
        );
    }

    #[test]
    fn truncating_chunks_clears_all_account_scoped_resume_state() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-truncate-clears";
        create_test_session(session_id, "account-a");
        update_cli_session_id(session_id, "native-a-1").expect("store account A native id");
        update_model_and_account(session_id, Some("claude-sonnet-4-6"), Some("account-b"))
            .expect("switch to account B");
        update_cli_session_id(session_id, "native-b-1").expect("store account B native id");

        clear_cli_resume_state(session_id, session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND)
            .expect("seed first history mutation");
        truncate_chunks_after(session_id, "1970-01-01T00:00:00Z").expect("truncate session");
        let mutation = get_history_mutation(session_id)
            .expect("load history mutation")
            .expect("history mutation exists");
        assert_eq!(mutation.epoch, 2);
        assert_eq!(
            mutation.reason,
            session_bridge::CLI_HISTORY_MUTATION_MESSAGE_TRUNCATE
        );

        let session = get_session(session_id)
            .expect("load session")
            .expect("session exists");
        assert_eq!(session.cli_session_id, None);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id"),
            None
        );
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-b"))
                .expect("load account B mapped id"),
            None
        );
    }

    #[test]
    fn late_resume_id_write_after_delete_does_not_create_orphan_state() {
        let _sandbox = test_env::sandbox();
        let session_id = "cli-resume-delete-race";
        create_test_session(session_id, "account-a");
        delete_session(session_id).expect("delete session");

        let updated =
            update_cli_session_id_for_account(session_id, Some("account-a"), "native-a-late")
                .expect("late write should be ignored cleanly");

        assert!(!updated);
        assert_eq!(
            get_cli_session_id_for_account(session_id, Some("account-a"))
                .expect("load account A mapped id"),
            None
        );
    }
}

#[cfg(test)]
mod create_session_input_guards {
    //! These tests pin the wire-typo guards in `create_session` without
    //! requiring a real SQLite connection. They exercise `KeySource::parse`
    //! and `SessionRunner::parse` directly, which is what the production
    //! code calls before issuing the INSERT — a typo'd input MUST fail
    //! at the boundary, otherwise `row_to_session` would later refuse to
    //! load the row and the session would be created-but-unloadable.
    use super::*;

    #[test]
    fn key_source_typo_rejected_at_parse() {
        // The production write path forwards through `KeySource::parse`;
        // a typo like a hyphen instead of an underscore must not silently
        // become `OwnKey` (which would mis-bill a market session).
        assert!(KeySource::parse("own-key").is_none());
        assert!(KeySource::parse("OWN_KEY").is_none());
        assert!(KeySource::parse("free").is_none());
        assert!(KeySource::parse("").is_none());

        // Sanity: legal values still parse.
        assert!(matches!(
            KeySource::parse("own_key"),
            Some(KeySource::OwnKey)
        ));
        assert!(matches!(
            KeySource::parse("hosted_key"),
            Some(KeySource::HostedKey)
        ));
    }

    #[test]
    fn session_runner_typo_rejected_at_parse() {
        // Adding a future `Remote` runner without updating
        // `SessionRunner::parse` would have silently fallen back to
        // `Local` under the old `_ =>` arm. Pin that the only legal
        // value today is `local`.
        assert!(SessionRunner::parse("remote").is_none());
        assert!(SessionRunner::parse("Local").is_none());
        assert!(SessionRunner::parse("").is_none());

        assert!(matches!(
            SessionRunner::parse("local"),
            Some(SessionRunner::Local)
        ));
    }
}
