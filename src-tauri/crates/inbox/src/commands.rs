//! Tauri commands for inbox message management.

use super::persistence::{self, InboxMessage};

/// List all inbox messages (newest first, capped at 200).
#[tauri::command]
pub async fn inbox_list() -> Result<Vec<InboxMessage>, String> {
    tokio::task::spawn_blocking(|| {
        persistence::list_messages().map_err(|e| format!("Failed to list inbox: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Upsert (insert or replace) an inbox message.
#[tauri::command]
pub async fn inbox_upsert(message: InboxMessage) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        persistence::upsert_message(&message)
            .map_err(|e| format!("Failed to upsert inbox message: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Update the status of an inbox message (read, archived, etc.).
#[tauri::command]
pub async fn inbox_update_status(id: String, status: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        persistence::update_status(&id, &status)
            .map_err(|e| format!("Failed to update inbox status: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Delete an inbox message by ID.
#[tauri::command]
pub async fn inbox_delete(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        persistence::delete_message(&id)
            .map_err(|e| format!("Failed to delete inbox message: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}
