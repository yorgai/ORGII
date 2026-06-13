//! No-op stubs for semantic-search Tauri commands when the feature is disabled.

use super::types::{EmbeddingModelStatus, IncrementalResult};
use serde::{Deserialize, Serialize};

const NOT_ENABLED: &str =
    "Advanced search is not enabled in this build. Build with the semantic-search feature to re-enable.";

/// Mirrors the advanced-search semantic hit JSON wire shape so
/// the frontend Zod schema for `search_semantic` stays valid even when the
/// stub returns an empty vec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticHit {
    pub repo_id: String,
    pub repo_path: String,
    pub relative_path: String,
    pub language: String,
    pub content: String,
    pub start_line: u64,
    pub end_line: u64,
    pub score: f32,
}

#[tauri::command]
pub fn check_semantic_available() -> bool {
    false
}

#[tauri::command]
pub fn check_embedding_model_status() -> EmbeddingModelStatus {
    EmbeddingModelStatus {
        installed: false,
        model_size_bytes: None,
        model_dir: String::new(),
    }
}

#[tauri::command]
pub async fn download_embedding_model(_window: tauri::Window) -> Result<(), String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub fn delete_embedding_model() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn set_model_dir(_path: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_model_dir_path() -> String {
    String::new()
}

#[tauri::command]
pub fn get_model_info() -> Result<String, String> {
    Ok(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn search_semantic(
    _query: String,
    _repo_filter: Option<String>,
    _limit: Option<usize>,
    _model_id: Option<String>,
    _offset: Option<usize>,
) -> Result<Vec<SemanticHit>, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn index_repository_semantic(
    _repo_id: String,
    _repo_path: String,
    _model_id: Option<String>,
    _window: tauri::Window,
) -> Result<usize, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn incremental_index_semantic(
    _repo_id: String,
    _repo_path: String,
    _file_paths: Vec<String>,
    _model_id: Option<String>,
) -> Result<IncrementalResult, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn remove_repository_semantic(_repo_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn cancel_semantic_indexing(
    _repo_id: String,
    _window: tauri::Window,
) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn stop_embedder() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn debug_qdrant_collection_info() -> Result<String, String> {
    Ok(NOT_ENABLED.to_string())
}

