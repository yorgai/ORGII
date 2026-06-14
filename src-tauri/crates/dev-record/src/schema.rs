//! Coding Activity Tracker — SQLite Schema
//!
//! Tables added to the shared `sessions.db`:
//! - `coding_heartbeats` — raw activity events (auto-cleaned after 90 days)
//! - `coding_daily_summary` — pre-aggregated per (date, workspace_path, language, source)
//! - `coding_sessions` — continuous activity blocks (gap > 5 min = new session)
//! - `cursor_session_cache` — cached parsed sessions from Cursor's state.vscdb
//! - `claude_session_cache` — cached parsed sessions from Claude Code's ~/.claude/
//! - `cli_session_cache` — cached parsed sessions from CLI tools (Codex, Gemini, Kiro, etc.)

use rusqlite::{Connection, Result as SqliteResult};

fn column_exists(conn: &Connection, table: &str, column: &str) -> SqliteResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn rename_column_if_needed(
    conn: &Connection,
    table: &str,
    old_column: &str,
    new_column: &str,
) -> SqliteResult<()> {
    if column_exists(conn, table, old_column)? && !column_exists(conn, table, new_column)? {
        conn.execute(
            &format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {}",
                table, old_column, new_column
            ),
            [],
        )?;
    }
    Ok(())
}

fn migrate_renamed_columns(conn: &Connection) -> SqliteResult<()> {
    rename_column_if_needed(conn, "coding_heartbeats", "project", "workspace_path")?;
    rename_column_if_needed(conn, "coding_daily_summary", "project", "workspace_path")?;
    rename_column_if_needed(conn, "coding_sessions", "project", "workspace_path")?;
    rename_column_if_needed(
        conn,
        "claude_session_cache",
        "project_path",
        "workspace_path",
    )?;
    rename_column_if_needed(conn, "cli_session_cache", "project_path", "workspace_path")?;
    Ok(())
}

pub fn init_tables(conn: &Connection) -> SqliteResult<()> {
    migrate_renamed_columns(conn)?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS coding_heartbeats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       TEXT NOT NULL,
            workspace_path  TEXT,
            file_path       TEXT,
            language        TEXT,
            source          TEXT NOT NULL,
            event_type      TEXT NOT NULL,
            lines_added     INTEGER NOT NULL DEFAULT 0,
            lines_removed   INTEGER NOT NULL DEFAULT 0,
            metadata_json   TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_coding_hb_timestamp
            ON coding_heartbeats(timestamp);
        CREATE INDEX IF NOT EXISTS idx_coding_hb_workspace_path
            ON coding_heartbeats(workspace_path);
        CREATE INDEX IF NOT EXISTS idx_coding_hb_source
            ON coding_heartbeats(source);

        CREATE TABLE IF NOT EXISTS coding_daily_summary (
            date            TEXT NOT NULL,
            workspace_path  TEXT,
            language        TEXT,
            source          TEXT,
            total_seconds   INTEGER NOT NULL DEFAULT 0,
            file_edits      INTEGER NOT NULL DEFAULT 0,
            lines_added     INTEGER NOT NULL DEFAULT 0,
            lines_removed   INTEGER NOT NULL DEFAULT 0,
            terminal_cmds   INTEGER NOT NULL DEFAULT 0,
            agent_actions   INTEGER NOT NULL DEFAULT 0,
            files_touched   INTEGER NOT NULL DEFAULT 0,
            UNIQUE(date, workspace_path, language, source)
        );

        CREATE INDEX IF NOT EXISTS idx_coding_ds_date
            ON coding_daily_summary(date);

        CREATE TABLE IF NOT EXISTS coding_sessions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time       TEXT NOT NULL,
            end_time         TEXT,
            workspace_path   TEXT,
            source           TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            heartbeat_count  INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_coding_sess_start
            ON coding_sessions(start_time);

        CREATE TABLE IF NOT EXISTS cursor_session_cache (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL DEFAULT 0,
            last_active_at  INTEGER NOT NULL DEFAULT 0,
            status          TEXT NOT NULL DEFAULT '',
            is_agentic      INTEGER NOT NULL DEFAULT 0,
            mode            TEXT NOT NULL DEFAULT '',
            model           TEXT NOT NULL DEFAULT '',
            lines_added     INTEGER NOT NULL DEFAULT 0,
            lines_removed   INTEGER NOT NULL DEFAULT 0,
            files_changed   INTEGER NOT NULL DEFAULT 0,
            tokens_used     INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_cursor_cache_created
            ON cursor_session_cache(created_at);
        CREATE INDEX IF NOT EXISTS idx_cursor_cache_status
            ON cursor_session_cache(status);

        CREATE TABLE IF NOT EXISTS cursor_ide_turn_summaries (
            session_id          TEXT NOT NULL,
            composer_id         TEXT NOT NULL,
            turn_id             TEXT NOT NULL,
            next_turn_id        TEXT,
            turn_index          INTEGER NOT NULL,
            started_at          TEXT NOT NULL,
            ended_at            TEXT,
            duration_ms         INTEGER,
            user_preview        TEXT NOT NULL DEFAULT '',
            event_count         INTEGER NOT NULL DEFAULT 0,
            body_event_count    INTEGER NOT NULL DEFAULT 0,
            source_updated_at   INTEGER NOT NULL DEFAULT 0,
            source_bubble_count INTEGER NOT NULL DEFAULT 0,
            source_fingerprint  TEXT NOT NULL DEFAULT '',
            updated_at          TEXT NOT NULL,
            PRIMARY KEY (session_id, turn_id)
        );

        CREATE INDEX IF NOT EXISTS idx_cursor_ide_turns_session_index
            ON cursor_ide_turn_summaries(session_id, turn_index);

        CREATE INDEX IF NOT EXISTS idx_coding_hb_dedup
            ON coding_heartbeats(timestamp, file_path, workspace_path);

        CREATE INDEX IF NOT EXISTS idx_coding_sess_workspace_path
            ON coding_sessions(start_time, workspace_path);

        CREATE INDEX IF NOT EXISTS idx_coding_hb_filepath
            ON coding_heartbeats(file_path);

        CREATE TABLE IF NOT EXISTS ide_scan_progress (
            source              TEXT PRIMARY KEY,
            last_timestamp_ms   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS claude_session_cache (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL DEFAULT 0,
            last_active_at  INTEGER NOT NULL DEFAULT 0,
            message_count   INTEGER NOT NULL DEFAULT 0,
            model           TEXT NOT NULL DEFAULT '',
            workspace_path    TEXT NOT NULL DEFAULT '',
            git_branch      TEXT NOT NULL DEFAULT '',
            input_tokens    INTEGER NOT NULL DEFAULT 0,
            output_tokens   INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_claude_cache_created
            ON claude_session_cache(created_at);

        CREATE TABLE IF NOT EXISTS cli_session_cache (
            id              TEXT PRIMARY KEY,
            tool            TEXT NOT NULL DEFAULT '',
            name            TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL DEFAULT 0,
            last_active_at  INTEGER NOT NULL DEFAULT 0,
            message_count   INTEGER NOT NULL DEFAULT 0,
            model           TEXT NOT NULL DEFAULT '',
            workspace_path    TEXT NOT NULL DEFAULT '',
            input_tokens    INTEGER NOT NULL DEFAULT 0,
            output_tokens   INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_cli_cache_created
            ON cli_session_cache(created_at);
        CREATE INDEX IF NOT EXISTS idx_cli_cache_tool
            ON cli_session_cache(tool);

        CREATE TABLE IF NOT EXISTS imported_history_session_cache (
            source              TEXT NOT NULL,
            source_session_id   TEXT NOT NULL,
            session_id          TEXT NOT NULL,
            source_path         TEXT NOT NULL DEFAULT '',
            source_record_key   TEXT NOT NULL DEFAULT '',
            source_mtime_ms     INTEGER NOT NULL DEFAULT 0,
            source_size_bytes   INTEGER NOT NULL DEFAULT 0,
            source_fingerprint  TEXT NOT NULL DEFAULT '',
            parser_version      INTEGER NOT NULL DEFAULT 0,
            name                TEXT NOT NULL DEFAULT '',
            created_at_ms       INTEGER NOT NULL DEFAULT 0,
            updated_at_ms       INTEGER NOT NULL DEFAULT 0,
            model               TEXT NOT NULL DEFAULT '',
            input_tokens        INTEGER NOT NULL DEFAULT 0,
            output_tokens       INTEGER NOT NULL DEFAULT 0,
            repo_path           TEXT NOT NULL DEFAULT '',
            branch              TEXT NOT NULL DEFAULT '',
            listable            INTEGER NOT NULL DEFAULT 1,
            updated_at          TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (source, source_session_id)
        );

        CREATE INDEX IF NOT EXISTS idx_imported_history_source_updated
            ON imported_history_session_cache(source, updated_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_imported_history_source_repo
            ON imported_history_session_cache(source, repo_path);
        CREATE INDEX IF NOT EXISTS idx_imported_history_source_path
            ON imported_history_session_cache(source, source_path);
        ",
    )?;

    Ok(())
}
