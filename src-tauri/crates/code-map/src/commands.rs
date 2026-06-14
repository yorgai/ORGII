use std::path::PathBuf;

use tauri::AppHandle;

use crate::types::{
    CodeMapNodeDetails, CodeMapQueryRequest, CodeMapSearchResponse, CodeMapStatus,
    CodeMapWorkspaceSummary,
};
use crate::Result;

#[tauri::command]
pub async fn code_map_get_status(workspace_path: String) -> Result<CodeMapStatus> {
    crate::get_status(PathBuf::from(workspace_path)).await
}

#[tauri::command]
pub async fn code_map_get_many_statuses(
    workspace_paths: Vec<String>,
) -> Result<Vec<CodeMapWorkspaceSummary>> {
    crate::get_many_statuses(workspace_paths.into_iter().map(PathBuf::from).collect()).await
}

#[tauri::command]
pub async fn code_map_start_index(
    app: AppHandle,
    workspace_path: String,
    force: bool,
) -> Result<CodeMapStatus> {
    crate::start_index(Some(app), PathBuf::from(workspace_path), force).await
}

#[tauri::command]
pub async fn code_map_cancel_index(workspace_path: String) -> Result<bool> {
    crate::cancel_index(PathBuf::from(workspace_path)).await
}

#[tauri::command]
pub async fn code_map_clear_index(workspace_path: String) -> Result<CodeMapStatus> {
    crate::clear_index(PathBuf::from(workspace_path)).await
}

#[tauri::command]
pub async fn code_map_search(request: CodeMapQueryRequest) -> Result<CodeMapSearchResponse> {
    crate::search(request.workspace_path.clone(), request).await
}

#[tauri::command]
pub async fn code_map_node_details(request: CodeMapQueryRequest) -> Result<CodeMapNodeDetails> {
    crate::node_details(request.workspace_path.clone(), request).await
}
