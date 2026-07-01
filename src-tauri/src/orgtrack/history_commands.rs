use database::db::get_connection;
use orgtrack_core::sources::claude_code::db as claude_code_db;
use orgtrack_core::sources::cli_session_db::{self, CliSession};
use orgtrack_core::sources::cursor_ide::{db as cursor_db, history as cursor_db_history};

fn open_cache_conn() -> Result<rusqlite::Connection, String> {
    get_connection().map_err(|err| format!("Failed to open orgtrack source cache DB: {err}"))
}

#[tauri::command]
pub async fn orgtrack_get_cursor_sessions(
    start_date: String,
    end_date: String,
) -> Result<Vec<cursor_db::CursorSession>, String> {
    tokio::task::spawn_blocking(move || {
        let mut conn = open_cache_conn()?;
        cursor_db::get_cursor_sessions(&mut conn, &start_date, &end_date)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn orgtrack_get_claude_sessions(
    start_date: String,
    end_date: String,
) -> Result<Vec<claude_code_db::ClaudeCodeSession>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        claude_code_db::get_claude_sessions(&conn, &start_date, &end_date)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn orgtrack_get_cli_sessions(
    tool: Option<String>,
    start_date: String,
    end_date: String,
) -> Result<Vec<CliSession>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        cli_session_db::get_cli_sessions(&conn, tool.as_deref(), &start_date, &end_date)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn cursor_ide_full_refresh(
    session_id: String,
) -> Result<cursor_db_history::CursorIdeFullRefresh, String> {
    tokio::task::spawn_blocking(move || {
        let mut conn = open_cache_conn()?;
        cursor_db_history::load_full_refresh_for_session(&mut conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn cursor_ide_turn_window(
    session_id: String,
    user_bubble_id: String,
) -> Result<cursor_db_history::CursorIdeTurnWindow, String> {
    tokio::task::spawn_blocking(move || {
        cursor_db_history::load_turn_window_for_session(&session_id, &user_bubble_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}
