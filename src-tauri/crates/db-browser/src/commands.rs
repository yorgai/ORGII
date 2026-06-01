//! Tauri commands for DB Browser (replaces WASM sql.js frontend layer).
//!
//! All SQLite access for the DB Browser panel goes through these commands.
//! Commands are thin async wrappers around `pool` + `ops`; heavy work runs
//! inside `tokio::task::spawn_blocking` to avoid blocking the async runtime.

use super::ops;
use super::pool;
use super::types::{
    ColumnInfo, ColumnValueMap, ExecuteResult, QueryOptions, QueryResult, TableInfo,
};

// ============================================
// Connection lifecycle
// ============================================

/// Open a SQLite file. Returns a `connection_id` string.
/// If the file is already open the existing ID is returned.
#[tauri::command]
pub async fn db_open(file_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || pool::open(&file_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Close a connection and release its resources.
#[tauri::command]
pub async fn db_close(connection_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        pool::close(&connection_id);
    })
    .await
    .map_err(|e| e.to_string())
}

// ============================================
// Schema introspection
// ============================================

/// List all tables and views in the database.
#[tauri::command]
pub async fn db_get_tables(connection_id: String) -> Result<Vec<TableInfo>, String> {
    tokio::task::spawn_blocking(move || pool::with(&connection_id, ops::get_tables))
        .await
        .map_err(|e| e.to_string())?
}

/// Get column schema for a table.
#[tauri::command]
pub async fn db_get_table_schema(
    connection_id: String,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    tokio::task::spawn_blocking(move || {
        pool::with(&connection_id, |conn| {
            ops::get_table_schema(conn, &table_name)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================
// Query / execute
// ============================================

/// Execute a raw SQL query and return the results.
#[tauri::command]
pub async fn db_query(connection_id: String, sql: String) -> Result<QueryResult, String> {
    tokio::task::spawn_blocking(move || pool::with(&connection_id, |conn| ops::query(conn, &sql)))
        .await
        .map_err(|e| e.to_string())?
}

/// Get paginated data for a table.
#[tauri::command]
pub async fn db_get_table_data(
    connection_id: String,
    table_name: String,
    options: Option<QueryOptions>,
) -> Result<QueryResult, String> {
    tokio::task::spawn_blocking(move || {
        pool::with(&connection_id, |conn| {
            ops::get_table_data(conn, &table_name, options.as_ref())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Execute a write SQL statement (INSERT / UPDATE / DELETE / DDL).
#[tauri::command]
pub async fn db_execute(connection_id: String, sql: String) -> Result<ExecuteResult, String> {
    tokio::task::spawn_blocking(move || pool::with(&connection_id, |conn| ops::execute(conn, &sql)))
        .await
        .map_err(|e| e.to_string())?
}

// ============================================
// CRUD helpers
// ============================================

/// Insert a row. `data` is a map of column → JSON value.
#[tauri::command]
pub async fn db_insert(
    connection_id: String,
    table_name: String,
    data: ColumnValueMap,
) -> Result<ExecuteResult, String> {
    tokio::task::spawn_blocking(move || {
        pool::with(&connection_id, |conn| ops::insert(conn, &table_name, &data))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Update rows matching `where_clause`. `data` contains the new values.
#[tauri::command]
pub async fn db_update(
    connection_id: String,
    table_name: String,
    data: ColumnValueMap,
    where_clause: ColumnValueMap,
) -> Result<ExecuteResult, String> {
    tokio::task::spawn_blocking(move || {
        pool::with(&connection_id, |conn| {
            ops::update(conn, &table_name, &data, &where_clause)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete rows matching `where_clause`.
#[tauri::command]
pub async fn db_delete(
    connection_id: String,
    table_name: String,
    where_clause: ColumnValueMap,
) -> Result<ExecuteResult, String> {
    tokio::task::spawn_blocking(move || {
        pool::with(&connection_id, |conn| {
            ops::delete(conn, &table_name, &where_clause)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================
// File validation
// ============================================

/// Check whether a file is a valid SQLite database (reads the 16-byte header).
#[tauri::command]
pub async fn db_is_valid_sqlite_file(file_path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || ops::is_valid_sqlite_file(&file_path))
        .await
        .map_err(|e| e.to_string())?
}
