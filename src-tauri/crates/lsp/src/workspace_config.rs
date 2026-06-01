//! Workspace LSP & Lint Configuration
//!
//! Manages per-workspace LSP and lint tool settings stored in `.orgii/settings.json`.
//! Allows users to enable/disable specific language servers and lint tools per project.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// ============================================
// Types
// ============================================

/// LSP-specific settings within workspace config.
///
/// The runtime decides "is server X enabled?" exclusively via
/// `!disabled.contains(X)` (see [`is_server_enabled`]); enabling a
/// server simply means it isn't in the deny list.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LspSettings {
    #[serde(default)]
    pub disabled: Vec<String>,
}

/// Lint tool settings within workspace config — same shape as
/// [`LspSettings`]: `disabled` is the only field the runtime reads.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LintSettings {
    #[serde(default)]
    pub disabled: Vec<String>,
}

/// Full workspace settings structure
/// This can be extended with other settings in the future
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceSettings {
    #[serde(default)]
    pub lsp: LspSettings,
    #[serde(default)]
    pub lint: LintSettings,
}

/// LSP config returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLspConfig {
    pub disabled: Vec<String>,
}

/// Lint config returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLintConfig {
    pub disabled: Vec<String>,
}

impl From<LspSettings> for WorkspaceLspConfig {
    fn from(settings: LspSettings) -> Self {
        WorkspaceLspConfig {
            disabled: settings.disabled,
        }
    }
}

impl From<LintSettings> for WorkspaceLintConfig {
    fn from(settings: LintSettings) -> Self {
        WorkspaceLintConfig {
            disabled: settings.disabled,
        }
    }
}

// ============================================
// File Operations
// ============================================

/// Get the path to the workspace settings file
fn get_settings_path(workspace_path: &str) -> std::path::PathBuf {
    Path::new(workspace_path)
        .join(".orgii")
        .join("settings.json")
}

/// Load workspace settings from .orgii/settings.json
/// Returns default settings if file doesn't exist
pub fn load_workspace_settings(workspace_path: &str) -> WorkspaceSettings {
    let settings_path = get_settings_path(workspace_path);

    if !settings_path.exists() {
        return WorkspaceSettings::default();
    }

    // A corrupt or unreadable `.orgii/settings.json` silently reverts
    // the user's workspace LSP settings to defaults — the user would
    // see their toggles flip back with no explanation, and the next
    // save would overwrite the file with the defaults, losing whatever
    // partial-but-recoverable state was there. Warn separately on
    // read failure (Rule 6) and JSON parse failure so the operator can
    // distinguish FS issues from schema drift.
    match fs::read_to_string(&settings_path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!(
                    path = %settings_path.display(),
                    error = %err,
                    "lsp::workspace_config: settings.json parse failed; using defaults"
                );
                WorkspaceSettings::default()
            }
        },
        Err(err) => {
            tracing::warn!(
                path = %settings_path.display(),
                error = %err,
                "lsp::workspace_config: settings.json read failed; using defaults"
            );
            WorkspaceSettings::default()
        }
    }
}

/// Save workspace settings to .orgii/settings.json
/// Creates the .orgii directory if it doesn't exist
pub fn save_workspace_settings(
    workspace_path: &str,
    settings: &WorkspaceSettings,
) -> Result<(), String> {
    let settings_path = get_settings_path(workspace_path);

    // Create .orgii directory if it doesn't exist
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .orgii directory: {}", e))?;
    }

    // Serialize with pretty printing
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

/// Check if a language server is enabled for a workspace
pub fn is_server_enabled(workspace_path: &str, language: &str) -> bool {
    let settings = load_workspace_settings(workspace_path);
    !settings.lsp.disabled.contains(&language.to_string())
}

/// Set whether a language server is enabled for a workspace
pub fn set_server_enabled(
    workspace_path: &str,
    language: &str,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_workspace_settings(workspace_path);
    let language_str = language.to_string();

    if enabled {
        settings.lsp.disabled.retain(|l| l != &language_str);
    } else if !settings.lsp.disabled.contains(&language_str) {
        settings.lsp.disabled.push(language_str);
    }

    save_workspace_settings(workspace_path, &settings)
}

// ============================================
// Tauri Commands
// ============================================

/// Get the LSP configuration for a workspace
#[tauri::command]
pub fn lsp_get_workspace_config(workspace_path: String) -> WorkspaceLspConfig {
    let settings = load_workspace_settings(&workspace_path);
    settings.lsp.into()
}

/// Set whether a language server is enabled for a workspace
#[tauri::command]
pub fn lsp_set_server_enabled(
    workspace_path: String,
    language: String,
    enabled: bool,
) -> Result<(), String> {
    set_server_enabled(&workspace_path, &language, enabled)
}

/// Check if a specific language server is enabled for a workspace
#[tauri::command]
pub fn lsp_is_server_enabled(workspace_path: String, language: String) -> bool {
    is_server_enabled(&workspace_path, &language)
}

// ============================================
// Lint Tool Functions
// ============================================

/// Check if a lint tool is enabled for a workspace
pub fn is_lint_tool_enabled(workspace_path: &str, tool_id: &str) -> bool {
    let settings = load_workspace_settings(workspace_path);
    !settings.lint.disabled.contains(&tool_id.to_string())
}

/// Set whether a lint tool is enabled for a workspace
pub fn set_lint_tool_enabled(
    workspace_path: &str,
    tool_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = load_workspace_settings(workspace_path);
    let tool_str = tool_id.to_string();

    if enabled {
        settings.lint.disabled.retain(|t| t != &tool_str);
    } else if !settings.lint.disabled.contains(&tool_str) {
        settings.lint.disabled.push(tool_str);
    }

    save_workspace_settings(workspace_path, &settings)
}

// ============================================
// Lint Tool Tauri Commands
// ============================================

/// Get the lint tool configuration for a workspace
#[tauri::command]
pub fn lint_get_workspace_config(workspace_path: String) -> WorkspaceLintConfig {
    let settings = load_workspace_settings(&workspace_path);
    settings.lint.into()
}

/// Set whether a lint tool is enabled for a workspace
#[tauri::command]
pub fn lint_set_tool_enabled(
    workspace_path: String,
    tool_id: String,
    enabled: bool,
) -> Result<(), String> {
    set_lint_tool_enabled(&workspace_path, &tool_id, enabled)
}

/// Check if a specific lint tool is enabled for a workspace
#[tauri::command]
pub fn lint_is_tool_enabled(workspace_path: String, tool_id: String) -> bool {
    is_lint_tool_enabled(&workspace_path, &tool_id)
}

#[cfg(test)]
#[path = "tests/workspace_config_tests.rs"]
mod tests;
