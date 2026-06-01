use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use app_paths as paths;

pub const SOURCE_PAT: &str = "pat";
pub const SOURCE_OAUTH_DEVICE: &str = "oauth_device";
pub const SOURCE_OAUTH_REDIRECT: &str = "oauth_redirect";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionTokenRecord {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at_unix: Option<i64>,
    pub source: String,
}

impl ConnectionTokenRecord {
    pub fn pat(access_token: impl Into<String>) -> Self {
        Self {
            access_token: access_token.into(),
            refresh_token: None,
            expires_at_unix: None,
            source: SOURCE_PAT.to_string(),
        }
    }
}

fn load_store_from(path: &Path) -> Result<HashMap<String, ConnectionTokenRecord>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read sync connection tokens: {err}"))?;
    serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse sync connection tokens: {err}"))
}

fn save_store_to(
    path: &Path,
    store: &HashMap<String, ConnectionTokenRecord>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create sync connection tokens dir: {err}"))?;
    }
    let contents = serde_json::to_string_pretty(store)
        .map_err(|err| format!("Failed to serialize sync connection tokens: {err}"))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, contents)
        .map_err(|err| format!("Failed to write sync connection tokens temp file: {err}"))?;
    paths::set_sensitive_file_permissions(&tmp_path).ok();
    std::fs::rename(&tmp_path, path)
        .map_err(|err| format!("Failed to rename sync connection tokens file: {err}"))
}

fn load_store() -> Result<HashMap<String, ConnectionTokenRecord>, String> {
    load_store_from(&paths::sync_connection_tokens())
}

fn save_store(store: &HashMap<String, ConnectionTokenRecord>) -> Result<(), String> {
    save_store_to(&paths::sync_connection_tokens(), store)
}

pub fn save(connection_id: &str, record: ConnectionTokenRecord) -> Result<(), String> {
    let mut store = load_store()?;
    store.insert(connection_id.to_string(), record);
    save_store(&store)
}

pub fn get(connection_id: &str) -> Result<Option<ConnectionTokenRecord>, String> {
    Ok(load_store()?.get(connection_id).cloned())
}

pub fn clear(connection_id: &str) -> Result<(), String> {
    let mut store = load_store()?;
    store.remove(connection_id);
    save_store(&store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_helpers::test_env;

    #[test]
    fn token_round_trips_by_connection_id() {
        let _guard = test_env::sandbox();
        let record = ConnectionTokenRecord {
            access_token: "access".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_at_unix: Some(123),
            source: SOURCE_OAUTH_REDIRECT.to_string(),
        };

        save("connection-1", record.clone()).expect("save connection token");
        assert_eq!(get("connection-1").expect("get token"), Some(record));

        clear("connection-1").expect("clear token");
        assert_eq!(get("connection-1").expect("get after clear"), None);
    }
}
