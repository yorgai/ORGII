use database::db::get_connection;
use orgtrack_core::sources::cli_session_db::{self, CliSession};

fn open_cache_conn() -> Result<rusqlite::Connection, String> {
    get_connection().map_err(|err| format!("Failed to open orgtrack source cache DB: {err}"))
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
