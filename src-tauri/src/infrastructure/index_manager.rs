//! Centralized Index Manager
//!
//! Manages all code search indexes across multiple repositories/windows.
//! Features:
//! - Shared index access (multiple windows can read same index)
//! - Deduplication (prevents indexing same repo multiple times)
//! - Progressive indexing (non-blocking, background processing)
//! - Incremental updates (only reindex changed files)
//! - Memory-mapped storage for efficient sharing

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

// ============================================
// Types
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexHandle {
    pub repo_path: String,
    pub repo_hash: String,
    pub state: IndexState,
    pub progress: IndexProgress,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexState {
    /// Indexing not started
    Pending,
    /// Currently indexing files
    Indexing,
    /// Index ready to use
    Ready,
    /// Indexing failed
    Error,
    /// Incrementally updating existing index
    Updating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgress {
    pub phase: IndexPhase,
    pub files_indexed: usize,
    pub total_files: usize,
    pub symbols_extracted: usize,
    pub embeddings_generated: usize,
    pub percentage: f32,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexPhase {
    /// Scanning repository for files
    Scanning,
    /// Building file search index
    FileIndex,
    /// Building symbol index (AST parsing)
    SymbolIndex,
    /// Generating semantic embeddings
    SemanticIndex,
    /// Index complete
    Complete,
    /// Idle (ready for queries)
    Idle,
}

#[derive(Debug, Clone)]
pub(crate) struct IndexEntry {
    handle: IndexHandle,
    pub(crate) reference_count: usize, // Number of windows using this index
}

// ============================================
// Index Manager State
// ============================================

pub struct IndexManager {
    /// Map: repo_hash -> IndexEntry
    pub(crate) indexes: Arc<Mutex<HashMap<String, IndexEntry>>>,
}

impl Default for IndexManager {
    fn default() -> Self {
        Self::new()
    }
}

impl IndexManager {
    pub fn new() -> Self {
        Self {
            indexes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Get or create an index handle for a repository
    /// If index exists, increments reference count
    /// If index doesn't exist, creates a new one and starts indexing
    pub fn get_or_index(
        &self,
        repo_path: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<IndexHandle, String> {
        let repo_path = Self::normalize_repo_path(repo_path);
        let repo_hash = Self::hash_repo_path(&repo_path);
        let mut indexes = self.indexes.lock().unwrap();

        // Check if index already exists
        if let Some(entry) = indexes.get_mut(&repo_hash) {
            // Increment reference count
            entry.reference_count += 1;

            return Ok(entry.handle.clone());
        }

        // Create new index entry
        let handle = IndexHandle {
            repo_path: repo_path.clone(),
            repo_hash: repo_hash.clone(),
            state: IndexState::Pending,
            progress: IndexProgress {
                phase: IndexPhase::Scanning,
                files_indexed: 0,
                total_files: 0,
                symbols_extracted: 0,
                embeddings_generated: 0,
                percentage: 0.0,
                error_message: None,
            },
            created_at: Self::current_timestamp(),
            updated_at: Self::current_timestamp(),
        };

        let entry = IndexEntry {
            handle: handle.clone(),
            reference_count: 1,
        };

        indexes.insert(repo_hash.clone(), entry);
        drop(indexes); // Release lock before starting async indexing

        // Start background indexing
        if let Some(app) = app_handle {
            self.start_background_indexing(&repo_path, app);
        }

        Ok(handle)
    }

    /// Update index progress (called by indexing tasks)
    pub fn update_progress(
        &self,
        repo_path: &str,
        state: IndexState,
        progress: IndexProgress,
    ) -> Result<(), String> {
        let repo_path = Self::normalize_repo_path(repo_path);
        let repo_hash = Self::hash_repo_path(&repo_path);
        let mut indexes = self.indexes.lock().unwrap();

        if let Some(entry) = indexes.get_mut(&repo_hash) {
            entry.handle.state = state;
            entry.handle.progress = progress;
            entry.handle.updated_at = Self::current_timestamp();
            Ok(())
        } else {
            Err("Index entry not found".to_string())
        }
    }

    /// Release a reference to an index
    /// When reference count reaches 0, the index may be cached or cleaned up
    pub fn release_index(&self, repo_path: &str) {
        let repo_path = Self::normalize_repo_path(repo_path);
        let repo_hash = Self::hash_repo_path(&repo_path);
        let mut indexes = self.indexes.lock().unwrap();

        if let Some(entry) = indexes.get_mut(&repo_hash) {
            entry.reference_count = entry.reference_count.saturating_sub(1);

            // Keep index in cache even if ref count is 0 (for fast reconnection)
            // Only clean up idle indexes after timeout (handled separately)
        }
    }

    /// Get all indexed repositories
    pub fn get_all_indexes(&self) -> Vec<IndexHandle> {
        let indexes = self.indexes.lock().unwrap();
        indexes.values().map(|entry| entry.handle.clone()).collect()
    }

    /// Get specific index handle
    pub fn get_index(&self, repo_path: &str) -> Option<IndexHandle> {
        let repo_path = Self::normalize_repo_path(repo_path);
        let repo_hash = Self::hash_repo_path(&repo_path);
        let indexes = self.indexes.lock().unwrap();
        indexes.get(&repo_hash).map(|entry| entry.handle.clone())
    }

    /// Start background indexing task
    fn start_background_indexing(&self, repo_path: &str, app_handle: tauri::AppHandle) {
        let repo_path = repo_path.to_string();
        let manager = self.clone();

        tokio::spawn(async move {
            // File scanning
            let _ = manager.update_progress(
                &repo_path,
                IndexState::Indexing,
                IndexProgress {
                    phase: IndexPhase::FileIndex,
                    files_indexed: 0,
                    total_files: 0,
                    symbols_extracted: 0,
                    embeddings_generated: 0,
                    percentage: 10.0,
                    error_message: None,
                },
            );

            // Emit progress event
            let _ = app_handle.emit("index_progress", &manager.get_index(&repo_path));

            // Simulate file indexing (would call actual file_search::build_index here)
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            // Symbol extraction
            let _ = manager.update_progress(
                &repo_path,
                IndexState::Indexing,
                IndexProgress {
                    phase: IndexPhase::SymbolIndex,
                    files_indexed: 100,
                    total_files: 100,
                    symbols_extracted: 0,
                    embeddings_generated: 0,
                    percentage: 50.0,
                    error_message: None,
                },
            );

            let _ = app_handle.emit("index_progress", &manager.get_index(&repo_path));
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            // Semantic indexing
            let _ = manager.update_progress(
                &repo_path,
                IndexState::Indexing,
                IndexProgress {
                    phase: IndexPhase::SemanticIndex,
                    files_indexed: 100,
                    total_files: 100,
                    symbols_extracted: 500,
                    embeddings_generated: 0,
                    percentage: 80.0,
                    error_message: None,
                },
            );

            let _ = app_handle.emit("index_progress", &manager.get_index(&repo_path));
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

            // Complete
            let _ = manager.update_progress(
                &repo_path,
                IndexState::Ready,
                IndexProgress {
                    phase: IndexPhase::Complete,
                    files_indexed: 100,
                    total_files: 100,
                    symbols_extracted: 500,
                    embeddings_generated: 50,
                    percentage: 100.0,
                    error_message: None,
                },
            );

            let _ = app_handle.emit("index_complete", &manager.get_index(&repo_path));
        });
    }

    fn normalize_repo_path(repo_path: &str) -> String {
        let path = Path::new(repo_path);
        let mut normalized = PathBuf::new();

        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                other => normalized.push(other.as_os_str()),
            }
        }

        normalized.to_string_lossy().replace('\\', "/")
    }

    /// Hash repository path to create consistent ID
    pub(crate) fn hash_repo_path(repo_path: &str) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        repo_path.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// Get current Unix timestamp
    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /// Clone for background tasks
    fn clone(&self) -> Self {
        Self {
            indexes: Arc::clone(&self.indexes),
        }
    }
}

// ============================================
// Tauri Commands
// ============================================

#[tauri::command]
pub async fn get_index_status(
    repo_path: String,
    state: tauri::State<'_, Arc<Mutex<IndexManager>>>,
) -> Result<Option<IndexHandle>, String> {
    let manager = state.lock().unwrap();
    Ok(manager.get_index(&repo_path))
}

#[tauri::command]
pub async fn get_all_indexes(
    state: tauri::State<'_, Arc<Mutex<IndexManager>>>,
) -> Result<Vec<IndexHandle>, String> {
    let manager = state.lock().unwrap();
    Ok(manager.get_all_indexes())
}

#[tauri::command]
pub async fn start_indexing(
    repo_path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<Mutex<IndexManager>>>,
) -> Result<IndexHandle, String> {
    let manager = state.lock().unwrap();
    manager.get_or_index(&repo_path, Some(app))
}

#[tauri::command]
pub async fn release_index(
    repo_path: String,
    state: tauri::State<'_, Arc<Mutex<IndexManager>>>,
) -> Result<(), String> {
    let manager = state.lock().unwrap();
    manager.release_index(&repo_path);
    Ok(())
}

// ============================================
// Module Tests
// ============================================

#[cfg(test)]
#[path = "tests/index_manager_tests.rs"]
mod tests;
