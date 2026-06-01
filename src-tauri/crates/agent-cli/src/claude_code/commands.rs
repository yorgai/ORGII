//! Tauri commands for reading / writing Claude Code config:
//!   - `~/.claude/settings.json`  (user-level settings)

use app_paths as paths;
use app_utils::json as json_helpers;
use std::path::PathBuf;

fn settings_path() -> PathBuf {
    paths::home_dir().join(".claude").join("settings.json")
}

/// Read `~/.claude/settings.json` and return as JSON.
/// Returns an empty object `{}` when the file does not exist.
#[tauri::command]
pub async fn claude_code_config_read() -> Result<serde_json::Value, String> {
    let path = settings_path();
    tokio::task::spawn_blocking(move || json_helpers::read_json_file(&path))
        .await
        .map_err(|err| format!("Task join error: {err}"))?
}

/// Merge a partial JSON object into `~/.claude/settings.json`.
/// Nested objects are merged recursively so individual keys can be updated
/// without clobbering sibling keys.
#[tauri::command]
pub async fn claude_code_config_write_partial(partial: serde_json::Value) -> Result<(), String> {
    let path = settings_path();
    tokio::task::spawn_blocking(move || {
        let mut current = json_helpers::read_json_file(&path)?;
        json_helpers::merge_json(&mut current, &partial);
        json_helpers::write_json_file(&path, &current)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Return the absolute path to `~/.claude/settings.json`.
#[tauri::command]
pub async fn claude_code_config_get_path() -> Result<String, String> {
    Ok(settings_path().to_string_lossy().to_string())
}

/// Read `~/.claude/settings.json` as a raw string (for the JSON editor).
/// Returns an empty string when the file does not exist.
#[tauri::command]
pub async fn claude_code_config_read_raw() -> Result<String, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(String::new());
    }
    tokio::task::spawn_blocking(move || {
        std::fs::read_to_string(&path)
            .map_err(|err| format!("Failed to read {}: {err}", path.display()))
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Write a raw JSON string to `~/.claude/settings.json`.
/// Validates that the content is parseable JSON before writing.
#[tauri::command]
pub async fn claude_code_config_write_raw(content: String) -> Result<(), String> {
    let path = settings_path();
    tokio::task::spawn_blocking(move || {
        let _: serde_json::Value =
            serde_json::from_str(&content).map_err(|err| format!("Invalid JSON: {err}"))?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|err| format!("Failed to create ~/.claude: {err}"))?;
        }
        std::fs::write(&path, &content)
            .map_err(|err| format!("Failed to write {}: {err}", path.display()))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}
