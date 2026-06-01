//! Tauri commands for policy CRUD operations.

use std::path::{Path, PathBuf};

use super::config::PolicyConfig;
use super::{
    config_for_source, list_policies_merged, parse_source, policies_dir_for_source,
    save_config_for_source, PolicyInfo,
};

/// List all policies (global + workspace).
#[tauri::command]
pub async fn policies_list(workspace_path: Option<String>) -> Result<Vec<PolicyInfo>, String> {
    let pp = workspace_path.as_deref().map(Path::new);

    tokio::task::spawn_blocking({
        let pp_owned = pp.map(|p| p.to_path_buf());
        move || list_policies_merged(pp_owned.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Read the content of a specific policy file.
#[tauri::command]
pub async fn policies_read(
    workspace_path: Option<String>,
    name: String,
    source: String,
) -> Result<String, String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let dir = policies_dir_for_source(src, pp.as_deref())?;
        let file_path = dir.join(format!("{}.md", name));
        if !file_path.exists() {
            let mdc_path = dir.join(format!("{}.mdc", name));
            if mdc_path.exists() {
                return std::fs::read_to_string(&mdc_path)
                    .map_err(|e| format!("Failed to read policy: {}", e));
            }
            return Err(format!("Policy not found: {}", name));
        }
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read policy: {}", e))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Create a new policy file.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn policies_create(
    workspace_path: Option<String>,
    name: String,
    content: String,
    source: String,
    agents: Vec<String>,
    scope_repo_paths: Option<Vec<String>>,
    scope_exclude_repo_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let dir = policies_dir_for_source(src, pp.as_deref())?;

        if !dir.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create policies dir: {}", e))?;
        }

        let file_path = dir.join(format!("{}.md", name));
        let mdc_path = dir.join(format!("{}.mdc", name));
        if file_path.exists() || mdc_path.exists() {
            return Err(format!("Policy already exists: {}", name));
        }

        std::fs::write(&file_path, &content)
            .map_err(|e| format!("Failed to write policy: {}", e))?;

        let mut config = config_for_source(src, pp.as_deref())?;
        config.policies.insert(
            name,
            PolicyConfig {
                agents,
                disabled: false,
                scope_repo_paths: normalize_scope_list(scope_repo_paths),
                scope_exclude_repo_paths: normalize_scope_list(scope_exclude_repo_paths),
            },
        );
        save_config_for_source(&config, src, pp.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Drop empty Vecs so on-disk JSON omits the field entirely.
fn normalize_scope_list(list: Option<Vec<String>>) -> Option<Vec<String>> {
    list.filter(|v| !v.is_empty())
}

/// Update an existing policy's content.
#[tauri::command]
pub async fn policies_update(
    workspace_path: Option<String>,
    name: String,
    content: String,
    source: String,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let dir = policies_dir_for_source(src, pp.as_deref())?;
        let md_path = dir.join(format!("{}.md", name));
        let mdc_path = dir.join(format!("{}.mdc", name));
        let file_path = if md_path.exists() {
            md_path
        } else if mdc_path.exists() {
            mdc_path
        } else {
            return Err(format!("Policy not found: {}", name));
        };
        std::fs::write(&file_path, &content).map_err(|e| format!("Failed to write policy: {}", e))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Delete a policy file and its config entry.
#[tauri::command]
pub async fn policies_delete(
    workspace_path: Option<String>,
    name: String,
    source: String,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let dir = policies_dir_for_source(src, pp.as_deref())?;
        let file_path = dir.join(format!("{}.md", name));
        if file_path.exists() {
            std::fs::remove_file(&file_path)
                .map_err(|e| format!("Failed to delete policy: {}", e))?;
        }
        let mdc_path = dir.join(format!("{}.mdc", name));
        if mdc_path.exists() {
            std::fs::remove_file(&mdc_path)
                .map_err(|e| format!("Failed to delete policy: {}", e))?;
        }

        let mut config = config_for_source(src, pp.as_deref())?;
        config.policies.remove(&name);
        save_config_for_source(&config, src, pp.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Toggle a policy's enabled state.
#[tauri::command]
pub async fn policies_toggle(
    workspace_path: Option<String>,
    name: String,
    enabled: bool,
    source: String,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let mut config = config_for_source(src, pp.as_deref())?;
        let entry = config
            .policies
            .entry(name)
            .or_insert_with(PolicyConfig::default);
        entry.disabled = !enabled;
        save_config_for_source(&config, src, pp.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Set which agents a policy applies to.
#[tauri::command]
pub async fn policies_set_agents(
    workspace_path: Option<String>,
    name: String,
    source: String,
    agents: Vec<String>,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let mut config = config_for_source(src, pp.as_deref())?;
        let entry = config
            .policies
            .entry(name)
            .or_insert_with(PolicyConfig::default);
        entry.agents = agents;
        save_config_for_source(&config, src, pp.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Set repo-scope filters (include/exclude) for a policy.
///
/// Pass `None` (or an empty array) for either field to clear it.
#[tauri::command]
pub async fn policies_set_scope(
    workspace_path: Option<String>,
    name: String,
    source: String,
    scope_repo_paths: Option<Vec<String>>,
    scope_exclude_repo_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let pp = workspace_path.map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        let src = parse_source(&source)?;
        let mut config = config_for_source(src, pp.as_deref())?;
        let entry = config
            .policies
            .entry(name)
            .or_insert_with(PolicyConfig::default);
        entry.scope_repo_paths = normalize_scope_list(scope_repo_paths);
        entry.scope_exclude_repo_paths = normalize_scope_list(scope_exclude_repo_paths);
        save_config_for_source(&config, src, pp.as_deref())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}
