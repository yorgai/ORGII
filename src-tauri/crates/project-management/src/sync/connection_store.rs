use std::collections::HashMap;
use std::path::Path;

use rand::RngCore;
use serde::{Deserialize, Serialize};

use app_paths as paths;

pub const ADAPTER_LINEAR: &str = "linear";
pub const ADAPTER_GITHUB_ISSUES: &str = "github_issues";
pub const AUTH_METHOD_PAT: &str = "pat";
pub const AUTH_METHOD_OAUTH: &str = "oauth";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncConnection {
    pub id: String,
    pub adapter_id: String,
    pub label: String,
    pub auth_method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,
    pub created_at_unix: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateConnectionRequest {
    pub adapter_id: String,
    pub label: String,
    pub auth_method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_email: Option<String>,
}

fn validate_adapter_id(adapter_id: &str) -> Result<(), String> {
    match adapter_id {
        ADAPTER_LINEAR | ADAPTER_GITHUB_ISSUES => Ok(()),
        _ => Err(format!("Unsupported project sync adapter '{adapter_id}'")),
    }
}

fn validate_auth_method(auth_method: &str) -> Result<(), String> {
    match auth_method {
        AUTH_METHOD_PAT | AUTH_METHOD_OAUTH => Ok(()),
        _ => Err(format!(
            "Unsupported project sync auth method '{auth_method}'"
        )),
    }
}

fn normalize_label(label: &str) -> Result<String, String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return Err("Connection label is required".to_string());
    }
    Ok(trimmed.to_string())
}

fn generate_connection_id() -> String {
    let mut bytes = [0_u8; 12];
    rand::rng().fill_bytes(&mut bytes);
    format!("project-sync-{}", hex::encode(bytes))
}

fn load_store_from(path: &Path) -> Result<HashMap<String, SyncConnection>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read sync connections: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Failed to parse sync connections: {err}"))
}

fn save_store_to(path: &Path, store: &HashMap<String, SyncConnection>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create sync connections dir: {err}"))?;
    }
    let contents = serde_json::to_string_pretty(store)
        .map_err(|err| format!("Failed to serialize sync connections: {err}"))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, contents)
        .map_err(|err| format!("Failed to write sync connections temp file: {err}"))?;
    paths::set_sensitive_file_permissions(&tmp_path).ok();
    std::fs::rename(&tmp_path, path)
        .map_err(|err| format!("Failed to rename sync connections file: {err}"))
}

fn load_store() -> Result<HashMap<String, SyncConnection>, String> {
    load_store_from(&paths::sync_connections())
}

fn save_store(store: &HashMap<String, SyncConnection>) -> Result<(), String> {
    save_store_to(&paths::sync_connections(), store)
}

pub fn list() -> Result<Vec<SyncConnection>, String> {
    let mut records: Vec<_> = load_store()?.into_values().collect();
    records.sort_by(|left, right| {
        right
            .created_at_unix
            .cmp(&left.created_at_unix)
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(records)
}

pub fn create(request: CreateConnectionRequest) -> Result<SyncConnection, String> {
    validate_adapter_id(&request.adapter_id)?;
    validate_auth_method(&request.auth_method)?;
    let label = normalize_label(&request.label)?;

    let mut store = load_store()?;
    let connection = SyncConnection {
        id: generate_connection_id(),
        adapter_id: request.adapter_id,
        label,
        auth_method: request.auth_method,
        account_email: request
            .account_email
            .map(|email| email.trim().to_string())
            .filter(|email| !email.is_empty()),
        created_at_unix: chrono::Utc::now().timestamp(),
    };
    store.insert(connection.id.clone(), connection.clone());
    save_store(&store)?;
    Ok(connection)
}

pub fn rename(connection_id: &str, label: &str) -> Result<SyncConnection, String> {
    let label = normalize_label(label)?;
    let mut store = load_store()?;
    let connection = store
        .get_mut(connection_id)
        .ok_or_else(|| format!("Sync connection '{connection_id}' not found"))?;
    connection.label = label;
    let updated = connection.clone();
    save_store(&store)?;
    Ok(updated)
}

pub fn get(connection_id: &str) -> Result<SyncConnection, String> {
    load_store()?
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("Sync connection '{connection_id}' not found"))
}

pub fn delete(connection_id: &str) -> Result<(), String> {
    let mut store = load_store()?;
    if store.remove(connection_id).is_none() {
        return Err(format!("Sync connection '{connection_id}' not found"));
    }
    save_store(&store)?;
    super::connection_token_store::clear(connection_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_helpers::test_env;

    #[test]
    fn create_list_rename_delete_connection_round_trips() {
        let _guard = test_env::sandbox();

        let created = create(CreateConnectionRequest {
            adapter_id: ADAPTER_LINEAR.to_string(),
            label: " Linear Work ".to_string(),
            auth_method: AUTH_METHOD_PAT.to_string(),
            account_email: Some(" user@example.com ".to_string()),
        })
        .expect("create sync connection");

        assert_eq!(created.label, "Linear Work");
        assert_eq!(created.account_email.as_deref(), Some("user@example.com"));
        assert_eq!(
            list().expect("list sync connections"),
            vec![created.clone()]
        );

        let renamed = rename(&created.id, "Linear Personal").expect("rename sync connection");
        assert_eq!(renamed.label, "Linear Personal");

        delete(&created.id).expect("delete sync connection");
        assert!(list().expect("list after delete").is_empty());
    }

    #[test]
    fn create_rejects_unknown_adapter() {
        let _guard = test_env::sandbox();

        let err = create(CreateConnectionRequest {
            adapter_id: "fake".to_string(),
            label: "Fake".to_string(),
            auth_method: AUTH_METHOD_PAT.to_string(),
            account_email: None,
        })
        .expect_err("unknown adapter should fail");

        assert!(err.contains("Unsupported project sync adapter"));
    }
}
