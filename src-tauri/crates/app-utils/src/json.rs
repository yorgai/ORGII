//! Shared JSON file I/O helpers.
//!
//! Used by CLI agent config modules (Claude Code, Cursor) and anywhere else
//! that needs to read/write/merge JSON files on disk.

use std::path::Path;

/// Read a JSON file, returning an empty object `{}` if it does not exist.
pub fn read_json_file(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
    let val: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("Invalid JSON: {err}"))?;
    Ok(val)
}

/// Write a `serde_json::Value` to a file as pretty-printed JSON.
/// Creates parent directories if needed.
pub fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|err| format!("Failed to create {}: {err}", dir.display()))?;
    }
    let serialized = serde_json::to_string_pretty(value)
        .map_err(|err| format!("JSON serialize error: {err}"))?;
    std::fs::write(path, serialized)
        .map_err(|err| format!("Failed to write {}: {err}", path.display()))?;
    Ok(())
}

/// Recursively merge `partial` into `base` (both must be JSON objects).
/// Nested objects are merged; other types are overwritten.
pub fn merge_json(base: &mut serde_json::Value, partial: &serde_json::Value) {
    if let (serde_json::Value::Object(base_map), serde_json::Value::Object(partial_map)) =
        (base, partial)
    {
        for (key, value) in partial_map {
            if let (Some(existing), serde_json::Value::Object(_)) = (base_map.get_mut(key), value) {
                if existing.is_object() {
                    merge_json(existing, value);
                    continue;
                }
            }
            base_map.insert(key.clone(), value.clone());
        }
    }
}

/// Atomic-write a `HashMap<String, String>` as JSON with restricted permissions.
///
/// Used for sensitive key-value stores (auth tokens, GitHub tokens, extension secrets).
/// Writes to a `.tmp` file first, sets restrictive permissions, then renames.
pub fn save_json_store(
    path: &Path,
    store: &std::collections::HashMap<String, String>,
    context_label: &str,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create {context_label} dir: {err}"))?;
    }
    let contents = serde_json::to_string_pretty(store)
        .map_err(|err| format!("Failed to serialize {context_label}: {err}"))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &contents)
        .map_err(|err| format!("Failed to write {context_label} temp file: {err}"))?;

    app_paths::set_sensitive_file_permissions(&tmp_path).ok();

    std::fs::rename(&tmp_path, path)
        .map_err(|err| format!("Failed to rename {context_label} file: {err}"))
}

/// Load a `HashMap<String, String>` from a JSON file, returning empty map if missing.
///
/// `load_json_store` is called for sensitive auth-token / secret stores
/// (GitHub tokens, extension secrets, etc.). A corrupt or unreadable
/// existing file silently turning into an empty map would mean the very
/// next `save_json_store` call overwrites the corrupt file with `{}`,
/// permanently destroying every other token in the store while the user
/// is just re-saving one new entry. Warn separately on FS read failure
/// and JSON parse failure so the operator notices before the next save
/// wipes the file.
pub fn load_json_store(path: &Path) -> std::collections::HashMap<String, String> {
    if !path.exists() {
        return std::collections::HashMap::new();
    }
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str(&contents) {
            Ok(map) => map,
            Err(err) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "load_json_store: JSON parse failed on existing file; returning empty map (next save will OVERWRITE this file)"
                );
                std::collections::HashMap::new()
            }
        },
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "load_json_store: read failed on existing file; returning empty map (next save will OVERWRITE this file)"
            );
            std::collections::HashMap::new()
        }
    }
}
