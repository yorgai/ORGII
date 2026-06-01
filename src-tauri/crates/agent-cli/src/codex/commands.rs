//! Tauri commands for reading / writing `~/.codex/config.toml`.

use app_paths as paths;
use std::path::PathBuf;

fn codex_config_path() -> PathBuf {
    paths::home_dir().join(".codex").join("config.toml")
}

/// Read `~/.codex/config.toml` and return it as a JSON value.
/// Returns an empty object `{}` when the file does not exist.
#[tauri::command]
pub async fn codex_config_read() -> Result<serde_json::Value, String> {
    let path = codex_config_path();
    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }

    tokio::task::spawn_blocking(move || {
        let raw = std::fs::read_to_string(&path)
            .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
        let toml_val: toml::Value =
            toml::from_str(&raw).map_err(|err| format!("Invalid TOML: {err}"))?;
        let json_val = toml_to_json(&toml_val);
        Ok(json_val)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Merge a partial JSON object into the existing config and write it back.
///
/// Only top-level keys present in `partial` are overwritten; the rest of the
/// file is preserved. Nested tables (e.g. `features`) are merged one level
/// deep so individual flags can be toggled without clobbering the rest.
#[tauri::command]
pub async fn codex_config_write_partial(partial: serde_json::Value) -> Result<(), String> {
    let path = codex_config_path();

    tokio::task::spawn_blocking(move || {
        let mut current: toml::Value = if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .map_err(|err| format!("Failed to read {}: {err}", path.display()))?;
            toml::from_str(&raw).map_err(|err| format!("Invalid TOML: {err}"))?
        } else {
            toml::Value::Table(toml::map::Map::new())
        };

        let partial_toml = json_to_toml(&partial);

        if let (toml::Value::Table(ref mut current_table), toml::Value::Table(partial_table)) =
            (&mut current, partial_toml)
        {
            for (key, value) in partial_table {
                if let (Some(toml::Value::Table(existing_sub)), toml::Value::Table(ref new_sub)) =
                    (current_table.get_mut(&key), &value)
                {
                    for (sub_key, sub_val) in new_sub {
                        existing_sub.insert(sub_key.clone(), sub_val.clone());
                    }
                } else {
                    current_table.insert(key, value);
                }
            }
        }

        let dir = path.parent().unwrap();
        std::fs::create_dir_all(dir).map_err(|err| format!("Failed to create ~/.codex: {err}"))?;

        let serialized = toml::to_string_pretty(&current)
            .map_err(|err| format!("TOML serialize error: {err}"))?;
        std::fs::write(&path, serialized)
            .map_err(|err| format!("Failed to write {}: {err}", path.display()))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Return the absolute path to `~/.codex/config.toml`.
#[tauri::command]
pub async fn codex_config_get_path() -> Result<String, String> {
    Ok(codex_config_path().to_string_lossy().to_string())
}

/// Read `~/.codex/config.toml` as a raw string (for the TOML editor).
/// Returns an empty string when the file does not exist.
#[tauri::command]
pub async fn codex_config_read_raw() -> Result<String, String> {
    let path = codex_config_path();
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

/// Write a raw TOML string to `~/.codex/config.toml`.
/// Validates that the content is parseable TOML before writing.
#[tauri::command]
pub async fn codex_config_write_raw(content: String) -> Result<(), String> {
    let path = codex_config_path();
    tokio::task::spawn_blocking(move || {
        let _: toml::Value =
            toml::from_str(&content).map_err(|err| format!("Invalid TOML: {err}"))?;

        let dir = path.parent().unwrap();
        std::fs::create_dir_all(dir).map_err(|err| format!("Failed to create ~/.codex: {err}"))?;
        std::fs::write(&path, &content)
            .map_err(|err| format!("Failed to write {}: {err}", path.display()))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

// ── TOML ↔ JSON helpers ──

fn toml_to_json(val: &toml::Value) -> serde_json::Value {
    match val {
        toml::Value::String(s) => serde_json::Value::String(s.clone()),
        toml::Value::Integer(i) => serde_json::json!(*i),
        toml::Value::Float(f) => serde_json::json!(*f),
        toml::Value::Boolean(b) => serde_json::Value::Bool(*b),
        toml::Value::Datetime(dt) => serde_json::Value::String(dt.to_string()),
        toml::Value::Array(arr) => serde_json::Value::Array(arr.iter().map(toml_to_json).collect()),
        toml::Value::Table(table) => {
            let map: serde_json::Map<String, serde_json::Value> = table
                .iter()
                .map(|(k, v)| (k.clone(), toml_to_json(v)))
                .collect();
            serde_json::Value::Object(map)
        }
    }
}

fn json_to_toml(val: &serde_json::Value) -> toml::Value {
    match val {
        serde_json::Value::Null => toml::Value::String(String::new()),
        serde_json::Value::Bool(b) => toml::Value::Boolean(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                toml::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                toml::Value::Float(f)
            } else {
                toml::Value::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => toml::Value::String(s.clone()),
        serde_json::Value::Array(arr) => toml::Value::Array(arr.iter().map(json_to_toml).collect()),
        serde_json::Value::Object(map) => {
            let table: toml::map::Map<String, toml::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), json_to_toml(v)))
                .collect();
            toml::Value::Table(table)
        }
    }
}
