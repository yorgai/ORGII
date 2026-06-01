//! Tantivy full-text index commands — index, search, and manage repositories.

use std::path::PathBuf;
use tauri::Emitter;

use crate::tantivy_index::{
    CodeIndex, IncrementalResult, SearchHit, TantivyIndexInfo, TantivyIndexStats,
};

/// Index a repository using Tantivy for fast full-text search.
#[tauri::command]
pub async fn index_repository_tantivy(
    repo_id: String,
    repo_path: String,
    window: tauri::Window,
) -> Result<TantivyIndexStats, String> {
    let path = PathBuf::from(&repo_path);
    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }

    let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
        .map_err(|e| format!("Failed to open/create index: {}", e))?;

    let repo_path_clone = repo_path.clone();
    let window_clone = window.clone();

    let _ = window.emit(
        "indexing-progress",
        serde_json::json!({
            "repo_path": repo_path,
            "current": 0,
            "total": 0,
        }),
    );

    let stats = index
        .index_repository(&repo_id, &path, move |current, total| {
            if current == 1 || current % 20 == 0 || current == total {
                let _ = window_clone.emit(
                    "indexing-progress",
                    serde_json::json!({
                        "repo_path": repo_path_clone,
                        "current": current,
                        "total": total,
                    }),
                );
            }
        })
        .map_err(|e| format!("Failed to index repository: {}", e))?;

    println!("✅ [Indexing] {} files indexed", stats.files_indexed);
    let _ = window.emit(
        "indexing-complete",
        serde_json::json!({
            "repo_path": repo_path,
            "files": stats.files_indexed,
        }),
    );

    Ok(stats)
}

/// Search indexed code using Tantivy.
#[tauri::command]
pub async fn search_tantivy(
    query: String,
    repo_filter: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    tokio::task::spawn_blocking(move || {
        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open index: {}", e))?;

        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);
        let results = index
            .search(&query, repo_filter.as_deref(), limit, offset)
            .map_err(|e| format!("Search failed: {}", e))?;

        println!(
            "🔍 [Tantivy] Found {} results for '{}'",
            results.len(),
            query
        );

        Ok(results)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Get index statistics.
#[tauri::command]
pub async fn get_tantivy_index_info() -> Result<TantivyIndexInfo, String> {
    tokio::task::spawn_blocking(|| {
        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open index: {}", e))?;

        index
            .stats()
            .map_err(|e| format!("Failed to get stats: {}", e))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Remove a specific repository from the Tantivy index.
#[tauri::command]
pub async fn remove_repository_tantivy(repo_id: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open index: {}", e))?;

        let num_deleted = index
            .remove_repository(&repo_id)
            .map_err(|e| format!("Failed to remove repository: {}", e))?;

        println!(
            "🗑️ [Tantivy] Removed {} documents for repo_id: {}",
            num_deleted, repo_id
        );

        Ok(num_deleted)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Clear the Tantivy index.
#[tauri::command]
pub async fn clear_tantivy_index() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open index: {}", e))?;

        index
            .clear()
            .map_err(|e| format!("Failed to clear index: {}", e))?;

        println!("🗑️ [Tantivy] Index cleared");

        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Incrementally index specific files (re-index changed files only).
#[tauri::command]
pub async fn incremental_index_files(
    repo_id: String,
    repo_path: String,
    file_paths: Vec<String>,
) -> Result<IncrementalResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&repo_path);
        if !path.exists() {
            return Err(format!("Repository path does not exist: {}", repo_path));
        }

        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open/create index: {}", e))?;

        let result = index
            .incremental_index_files(&repo_id, &path, &file_paths)
            .map_err(|e| format!("Incremental indexing failed: {}", e))?;

        println!(
            "🔄 [Tantivy] Incremental: {} updated, {} failed out of {} files",
            result.files_updated,
            result.files_failed,
            file_paths.len()
        );

        Ok(result)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Remove specific files from the Tantivy index.
#[tauri::command]
pub async fn remove_files_from_index(
    repo_id: String,
    file_paths: Vec<String>,
) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let index = CodeIndex::open_or_create(&CodeIndex::default_index_path())
            .map_err(|e| format!("Failed to open/create index: {}", e))?;

        let deleted = index
            .delete_files(&repo_id, &file_paths)
            .map_err(|e| format!("Failed to remove files from index: {}", e))?;

        println!("🗑️ [Tantivy] Removed {} files from index", deleted);

        Ok(deleted)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}
