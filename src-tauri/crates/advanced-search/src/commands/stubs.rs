//! No-op stubs for the archived semantic-search Tauri commands.
//!
//! The real implementations were moved to
//! `.archive/semantic-modules/work_station/search/code/commands/semantic_commands.rs`
//! and is now folded into the optional `advanced_search` crate. The frontend still wires
//! invokes for these command names (search settings UI, code search mode
//! toggle, etc.), so we keep the surface addressable and return a consistent
//! "not enabled" error / inert value.
//!
//! Restore steps: see `commands/mod.rs` + `Cargo.toml` for the exact lines to
//! uncomment, then delete this file.
//!
//! The function signatures, names, and `Result` shapes below MUST stay
//! byte-identical to the originals so the frontend `invoke<T>(...)` callers
//! keep type-checking against unchanged TypeScript wrappers.

use super::types::EmbeddingModelStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalResult {
    pub files_updated: usize,
    pub files_failed: usize,
    pub failed_paths: Vec<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchingLine {
    pub line_number: usize,
    pub content: String,
    pub column_start: Option<usize>,
    pub column_end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub repo_id: String,
    pub repo_path: String,
    pub relative_path: String,
    pub language: String,
    pub line_count: usize,
    pub score: f32,
    pub matching_lines: Vec<MatchingLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TantivyIndexStats {
    pub files_indexed: usize,
    pub total_bytes: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TantivyIndexInfo {
    pub num_documents: usize,
    pub num_segments: usize,
    pub index_size_bytes: u64,
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

#[tauri::command]
pub async fn index_repository_tantivy(
    _repo_id: String,
    _repo_path: String,
    _window: tauri::Window,
) -> Result<TantivyIndexStats, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn search_tantivy(
    _query: String,
    _repo_filter: Option<String>,
    _limit: Option<usize>,
    _offset: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn get_tantivy_index_info() -> Result<TantivyIndexInfo, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn remove_repository_tantivy(_repo_id: String) -> Result<usize, String> {
    Ok(0)
}

#[tauri::command]
pub async fn clear_tantivy_index() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn incremental_index_files(
    _repo_id: String,
    _repo_path: String,
    _file_paths: Vec<String>,
) -> Result<IncrementalResult, String> {
    Err(NOT_ENABLED.to_string())
}

#[tauri::command]
pub async fn remove_files_from_index(
    _repo_id: String,
    _file_paths: Vec<String>,
) -> Result<usize, String> {
    Ok(0)
}
