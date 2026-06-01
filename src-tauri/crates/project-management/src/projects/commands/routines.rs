//! Routine commands: definitions, fire history, and materialization.

use super::super::io;
use super::super::types::{RoutineDefinition, RoutineFire};

#[tauri::command]
pub async fn project_list_routines() -> Result<Vec<RoutineDefinition>, String> {
    tokio::task::spawn_blocking(io::list_routines)
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn project_read_routine(id: String) -> Result<RoutineDefinition, String> {
    tokio::task::spawn_blocking(move || io::read_routine(&id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn project_upsert_routine(
    routine: RoutineDefinition,
) -> Result<RoutineDefinition, String> {
    tokio::task::spawn_blocking(move || io::upsert_routine(routine))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn project_delete_routine(id: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || io::delete_routine(&id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

#[tauri::command]
pub async fn project_list_routine_fires(routine_id: String) -> Result<Vec<RoutineFire>, String> {
    tokio::task::spawn_blocking(move || io::list_routine_fires(&routine_id))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}
