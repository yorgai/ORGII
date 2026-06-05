//! Sticky notes persistence.
//!
//! Backs the sidebar sticky-notes feature with a single JSON document at
//! `~/.orgii/sticky-notes.json`. Schema is opaque to the backend — the
//! frontend owns the shape and the backend only round-trips the JSON value
//! to disk. This keeps the storage layer trivial and lets the UI evolve
//! freely without Rust schema churn.

use serde_json::Value;
use std::path::Path;
use tokio::task::spawn_blocking;

/// Read the sticky-notes JSON document.
///
/// Returns `Ok(None)` only when the file does not yet exist (first run).
/// Any IO or JSON parse failure is surfaced so the frontend can decide
/// whether to fall back to defaults or refuse to overwrite a corrupt file.
#[tauri::command]
pub async fn sticky_notes_load() -> Result<Option<Value>, String> {
    spawn_blocking(load_blocking)
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

/// Replace the sticky-notes JSON document on disk.
///
/// The whole document is rewritten atomically (write-then-rename) so a
/// crash mid-save cannot leave a truncated file.
#[tauri::command]
pub async fn sticky_notes_save(document: Value) -> Result<(), String> {
    spawn_blocking(move || save_blocking(document))
        .await
        .map_err(|err| format!("Task join error: {}", err))?
}

fn load_blocking() -> Result<Option<Value>, String> {
    let path = app_paths::sticky_notes();
    read_document(&path)
}

fn save_blocking(document: Value) -> Result<(), String> {
    let path = app_paths::sticky_notes();
    write_document(&path, &document)
}

fn read_document(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).map_err(|err| {
        format!(
            "Failed to read sticky notes from {}: {}",
            path.display(),
            err
        )
    })?;
    let parsed: Value = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse sticky notes from {}: {}",
            path.display(),
            err
        )
    })?;
    Ok(Some(parsed))
}

fn write_document(path: &Path, document: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create sticky-notes parent dir: {}", err))?;
    }

    let serialized = serde_json::to_string_pretty(document)
        .map_err(|err| format!("Failed to serialize sticky notes: {}", err))?;

    // Atomic replace: write to a sibling tmp file, then rename over the
    // real path. `rename` is atomic on POSIX and Win32 ReplaceFile-like
    // on Windows when both paths are on the same volume (which they are,
    // since both live next to each other under ~/.orgii/).
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, serialized)
        .map_err(|err| format!("Failed to write sticky notes tmp file: {}", err))?;
    std::fs::rename(&tmp_path, path)
        .map_err(|err| format!("Failed to replace sticky notes file: {}", err))?;

    Ok(())
}

#[cfg(test)]
#[path = "sticky_notes_tests.rs"]
mod tests;
