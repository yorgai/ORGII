//! Partial Stream State - Crash Recovery for Streaming Messages
//!
//! - During streaming, the accumulated message content is persisted to a JSON file
//! - Writes are atomic (write to temp file, then rename) to prevent corruption
//! - On crash recovery, the partial file is detected and its content is recovered
//! - After recovery or stream completion, the partial file is deleted
//!
//! ## File Location
//! `~/.orgii/partials/{session_id}.json`
//!
//! ## Lifecycle
//! 1. Stream starts → `save_partial()` creates/updates the file (throttled by frontend)
//! 2. Stream delta → `save_partial()` updates with accumulated content
//! 3. Stream ends → `commit_partial()` saves events to SQLite cache, deletes file
//! 4. App crash → `load_partial()` on next load detects and recovers the state
//!
//! ## Safety
//! - Atomic writes via temp file + rename (no partial/corrupt files on crash)
//! - Per-session isolation (each session has its own partial file)
//! - Self-healing: malformed JSON is logged and deleted, never blocks startup

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ============================================
// Types
// ============================================

/// Partial stream state persisted to disk during streaming.
/// Contains the accumulated message/thinking content so far.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartialStreamState {
    /// Session ID this partial belongs to
    pub session_id: String,
    /// Streaming event ID for the accumulated message (e.g., "stream:message:{sessionId}")
    pub message_event_id: Option<String>,
    /// Streaming event ID for the accumulated thinking (e.g., "stream:thinking:{sessionId}")
    pub thinking_event_id: Option<String>,
    /// Accumulated assistant message content
    pub accumulated_message: Option<String>,
    /// Accumulated thinking/reasoning content
    pub accumulated_thinking: Option<String>,
    /// ISO timestamp when streaming started
    pub started_at: String,
    /// ISO timestamp of the last update
    pub last_updated_at: String,
    /// Model name if available
    pub model: Option<String>,
    /// Whether the stream was interrupted (error/cancel)
    pub was_interrupted: Option<bool>,
}

// ============================================
// File Path Helpers
// ============================================

/// Get the partials directory path: `~/.orgii/partials/`
fn get_partials_dir() -> PathBuf {
    let data_dir = app_paths::partials_dir();

    // Ensure directory exists
    std::fs::create_dir_all(&data_dir).ok();

    data_dir
}

/// Get the partial file path for a session
fn get_partial_path(session_id: &str) -> PathBuf {
    // Sanitize session_id to prevent path traversal
    let safe_id = session_id.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    get_partials_dir().join(format!("{}.json", safe_id))
}

/// Get the temp file path for atomic writes
fn get_temp_path(session_id: &str) -> PathBuf {
    let safe_id = session_id.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    get_partials_dir().join(format!("{}.tmp", safe_id))
}

// ============================================
// Core Operations
// ============================================

/// Save partial stream state to disk (atomic write).
///
/// Writes to a temp file first, then renames to the final path.
/// This ensures the file is never in a corrupt state even if the app crashes mid-write.
#[tauri::command]
pub async fn partial_save(session_id: String, state: PartialStreamState) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = get_partial_path(&session_id);
        let temp_path = get_temp_path(&session_id);

        // Serialize to JSON
        let json = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("Failed to serialize partial state: {}", err))?;

        // Write to temp file first
        std::fs::write(&temp_path, json.as_bytes())
            .map_err(|err| format!("Failed to write temp partial file: {}", err))?;

        // Atomic rename (on same filesystem, this is atomic on POSIX)
        std::fs::rename(&temp_path, &path)
            .map_err(|err| format!("Failed to rename partial file: {}", err))?;

        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Load partial stream state from disk.
///
/// Returns None if no partial file exists or if the file is malformed.
/// Self-healing: malformed files are deleted to prevent blocking future operations.
#[tauri::command]
pub async fn partial_load(session_id: String) -> Result<Option<PartialStreamState>, String> {
    tokio::task::spawn_blocking(move || {
        let path = get_partial_path(&session_id);

        if !path.exists() {
            return Ok(None);
        }

        // Read file
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(err) => {
                eprintln!(
                    "⚠️ [Partial] Failed to read partial file for {}: {}. Removing corrupt file.",
                    session_id, err
                );
                // Self-healing: remove corrupt file
                std::fs::remove_file(&path).ok();
                return Ok(None);
            }
        };

        // Parse JSON
        match serde_json::from_str::<PartialStreamState>(&content) {
            Ok(state) => Ok(Some(state)),
            Err(err) => {
                eprintln!(
                    "⚠️ [Partial] Failed to parse partial file for {}: {}. Removing malformed file.",
                    session_id, err
                );
                // Self-healing: remove malformed file
                std::fs::remove_file(&path).ok();
                Ok(None)
            }
        }
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Delete partial stream state file.
///
/// Called after stream completes or after recovery is done.
/// Safe to call even if no partial file exists.
#[tauri::command]
pub async fn partial_delete(session_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = get_partial_path(&session_id);

        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|err| format!("Failed to delete partial file: {}", err))?;
        }

        // Also clean up any stale temp file
        let temp_path = get_temp_path(&session_id);
        if temp_path.exists() {
            std::fs::remove_file(&temp_path).ok();
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Check if a partial file exists for a session (fast, no parsing).
#[tauri::command]
pub async fn partial_exists(session_id: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let path = get_partial_path(&session_id);
        Ok(path.exists())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// List all session IDs that have partial files (for startup recovery scan).
///
/// Scans the partials directory for .json files and returns the session IDs.
/// This allows the frontend to check all sessions at once on startup.
#[tauri::command]
pub async fn partial_list_all() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(|| {
        let dir = get_partials_dir();

        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut session_ids = Vec::new();

        match std::fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().is_some_and(|ext| ext == "json") {
                        if let Some(stem) = path.file_stem() {
                            session_ids.push(stem.to_string_lossy().to_string());
                        }
                    }
                }
            }
            Err(err) => {
                eprintln!("⚠️ [Partial] Failed to read partials directory: {}", err);
            }
        }

        Ok(session_ids)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Clean up stale partial files older than a given threshold (in hours).
///
/// Prevents orphaned partial files from accumulating if recovery never runs.
#[tauri::command]
pub async fn partial_cleanup_stale(max_age_hours: Option<u64>) -> Result<u32, String> {
    let max_age = max_age_hours.unwrap_or(24);

    tokio::task::spawn_blocking(move || {
        let dir = get_partials_dir();

        if !dir.exists() {
            return Ok(0);
        }

        let mut cleaned = 0u32;
        let now = std::time::SystemTime::now();

        match std::fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path
                        .extension()
                        .is_some_and(|ext| ext == "json" || ext == "tmp")
                    {
                        continue;
                    }

                    // Check file age
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(age) = now.duration_since(modified) {
                                if age.as_secs() > max_age * 3600
                                    && std::fs::remove_file(&path).is_ok()
                                {
                                    cleaned += 1;
                                }
                            }
                        }
                    }
                }
            }
            Err(err) => {
                eprintln!(
                    "⚠️ [Partial] Failed to read partials directory for cleanup: {}",
                    err
                );
            }
        }

        Ok(cleaned)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}
