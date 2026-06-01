//! GitHub Token Store
//!
//! Secure storage for GitHub OAuth tokens using a local JSON file
//! (`~/.orgii/github_tokens.json`) with restrictive permissions (0o600 on Unix).

use std::collections::HashMap;

use app_utils::json as json_helpers;

fn storage_path() -> std::path::PathBuf {
    app_paths::github_tokens()
}

fn load_store() -> HashMap<String, String> {
    json_helpers::load_json_store(&storage_path())
}

fn save_store(store: &HashMap<String, String>) -> Result<(), String> {
    json_helpers::save_json_store(&storage_path(), store, "github tokens")
}

/// Store a GitHub OAuth token.
pub fn save(user_id: &str, token: &str) -> Result<(), String> {
    let mut store = load_store();
    store.insert(user_id.to_string(), token.to_string());
    save_store(&store)?;
    log::info!("[GitHub][TokenStore] Token saved for user {}", user_id);
    Ok(())
}

/// Retrieve the GitHub OAuth token.
/// Returns `Ok(None)` if no token is stored.
pub fn get(user_id: &str) -> Result<Option<String>, String> {
    let store = load_store();
    match store.get(user_id) {
        Some(token) => {
            log::info!("[GitHub][TokenStore] Token found for user {}", user_id);
            Ok(Some(token.clone()))
        }
        None => {
            log::info!("[GitHub][TokenStore] No token stored for user {}", user_id);
            Ok(None)
        }
    }
}

/// Remove the GitHub OAuth token.
/// Called on 401 when refresh also fails, forcing re-auth.
pub fn clear(user_id: &str) -> Result<(), String> {
    let mut store = load_store();
    if store.remove(user_id).is_some() {
        save_store(&store)?;
        log::info!("[GitHub][TokenStore] Token cleared for user {}", user_id);
    } else {
        log::info!(
            "[GitHub][TokenStore] No token to clear for user {}",
            user_id
        );
    }
    Ok(())
}
