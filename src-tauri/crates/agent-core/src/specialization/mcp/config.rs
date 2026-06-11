//! MCP server configuration.
//!
//! Supports global (`~/.orgii/mcp-servers.json`) and workspace-scoped
//! (`{workspace}/.orgii/mcp-servers.json`) config files. Workspace entries
//! override global entries by server name.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Transport type for an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum McpTransportType {
    Stdio,
    Sse,
    StreamableHttp,
}

/// Configuration for a single MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    /// Transport type.
    #[serde(rename = "type")]
    pub transport_type: McpTransportType,

    /// Command to spawn (stdio only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// Arguments for the command (stdio only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,

    /// Working directory for the command (stdio only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,

    /// Environment variables for the command (stdio only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,

    /// URL for SSE/streamable HTTP transport.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// HTTP headers for SSE/streamable HTTP transport.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,

    /// Tool names that are auto-approved (skip permission prompt).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_approve: Option<Vec<String>>,

    /// Whether this server is disabled.
    #[serde(default)]
    pub disabled: bool,

    /// Connection timeout in seconds.
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_timeout() -> u64 {
    30
}

/// Which config file scope an MCP server entry belongs to.
///
/// `Global` → `~/.orgii/mcp-servers.json` (per-user, all workspaces).
/// `Workspace` → `<workspace>/.orgii/mcp-servers.json` (this workspace only).
///
/// The wire form is `"global"` / `"workspace"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum McpConfigScope {
    #[default]
    Global,
    Workspace,
}

/// Root config file structure.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigFile {
    /// Map of server name → config.
    #[serde(default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

impl McpConfigFile {
    /// Load from a file path.
    ///
    /// A missing file is a normal first-run state and resolves to an empty
    /// config. Existing unreadable or invalid JSON files return an error so
    /// read-then-write paths cannot accidentally overwrite a user's broken
    /// config with `{}`.
    pub fn load_from(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let contents = std::fs::read_to_string(path)
            .map_err(|err| format!("Failed to read MCP config {}: {}", path.display(), err))?;
        serde_json::from_str(&contents)
            .map_err(|err| format!("Failed to parse MCP config {}: {}", path.display(), err))
    }

    /// Save to a file path. Creates parent directories if needed.
    pub fn save_to(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("Failed to create directory: {}", err))?;
            }
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|err| format!("Failed to serialize MCP config: {}", err))?;
        std::fs::write(path, json).map_err(|err| format!("Failed to write MCP config: {}", err))?;
        Ok(())
    }

    /// Load workspace-scoped config from `{workspace}/.orgii/mcp-servers.json`.
    pub fn load_for_workspace(workspace_path: &Path) -> Result<Self, String> {
        Self::load_from(&workspace_config_path(workspace_path))
    }

    /// Load global config from `~/.orgii/mcp-servers.json`.
    pub fn load_global() -> Result<Self, String> {
        Self::load_from(&global_config_path())
    }

    /// Merge global + workspace configs.
    ///
    /// When a server name exists in BOTH scopes, the workspace entry wins
    /// for connection details (command/url/env/...) but `disabled` is the
    /// OR of both scopes — disabling a server in either file keeps it off.
    /// A workspace `mcp-servers.json` previously wholesale-replaced the
    /// global entry by name, silently resurrecting servers the user had
    /// disabled globally.
    ///
    /// Returns ALL servers including disabled ones so callers can render
    /// them in the UI list and toggle them back on. Connection paths
    /// (`McpManager::connect_all`, etc.) already filter `!cfg.disabled`
    /// before spawning a child process; consumers that need only the
    /// enabled subset should call [`Self::enabled_servers`].
    pub fn load_merged(workspace_path: Option<&Path>) -> Result<Self, String> {
        Self::load_merged_with_workspace_scope(workspace_path, true)
    }

    pub fn load_merged_with_workspace_scope(
        workspace_path: Option<&Path>,
        load_workspace_resources: bool,
    ) -> Result<Self, String> {
        let mut merged = Self::load_global()?;

        if load_workspace_resources {
            if let Some(workspace) = workspace_path {
                let workspace_config = Self::load_for_workspace(workspace)?;
                for (name, mut server_config) in workspace_config.mcp_servers {
                    if let Some(global_entry) = merged.mcp_servers.get(&name) {
                        server_config.disabled = server_config.disabled || global_entry.disabled;
                    }
                    merged.mcp_servers.insert(name, server_config);
                }
            }
        }

        Ok(merged)
    }

    /// Get only enabled servers.
    pub fn enabled_servers(&self) -> HashMap<&str, &McpServerConfig> {
        self.mcp_servers
            .iter()
            .filter(|(_name, cfg)| !cfg.disabled)
            .map(|(name, cfg)| (name.as_str(), cfg))
            .collect()
    }
}

/// Global config path: `~/.orgii/mcp-servers.json`.
pub fn global_config_path() -> PathBuf {
    app_paths::mcp_servers_config()
}

/// Workspace config path: `{workspace}/.orgii/mcp-servers.json`.
pub fn workspace_config_path(workspace_path: &Path) -> PathBuf {
    app_paths::workspace_mcp_servers_config(workspace_path)
}

/// Find which config file (workspace or global) owns the entry for
/// `name` and return both the loaded file struct and its on-disk path
/// so the caller can mutate-and-save without guessing scope.
///
/// Resolution mirrors [`McpConfigFile::load_merged`] precedence:
///   1. Workspace config (if `workspace_path` is provided and the entry
///      exists there) — workspace always wins.
///   2. Global config.
///
/// Returns `Ok(None)` if the entry isn't in either file.
pub fn insert_server_config(
    path: &Path,
    name: String,
    server_config: McpServerConfig,
) -> Result<(), String> {
    let mut config = McpConfigFile::load_from(path)?;
    config.mcp_servers.insert(name, server_config);
    config.save_to(path)
}

pub fn locate_owning_config(
    name: &str,
    workspace_path: Option<&Path>,
) -> Result<Option<(McpConfigFile, PathBuf)>, String> {
    if let Some(workspace) = workspace_path {
        let workspace_cfg = McpConfigFile::load_for_workspace(workspace)?;
        if workspace_cfg.mcp_servers.contains_key(name) {
            return Ok(Some((workspace_cfg, workspace_config_path(workspace))));
        }
    }

    let global_cfg = McpConfigFile::load_global()?;
    if global_cfg.mcp_servers.contains_key(name) {
        return Ok(Some((global_cfg, global_config_path())));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_server_config() -> McpServerConfig {
        McpServerConfig {
            transport_type: McpTransportType::Stdio,
            command: Some("docs-server".to_string()),
            args: None,
            cwd: None,
            env: None,
            url: None,
            headers: None,
            auto_approve: None,
            disabled: false,
            timeout: 30,
        }
    }

    #[test]
    fn load_from_missing_file_returns_empty_config() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mcp-servers.json");

        let config = McpConfigFile::load_from(&path).unwrap();

        assert!(config.mcp_servers.is_empty());
    }

    #[test]
    fn load_from_invalid_json_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mcp-servers.json");
        std::fs::write(&path, "{not valid json").unwrap();

        let err = McpConfigFile::load_from(&path).unwrap_err();

        assert!(err.contains("Failed to parse MCP config"));
    }

    #[test]
    fn insert_server_config_does_not_overwrite_invalid_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mcp-servers.json");
        let original = "{not valid json";
        std::fs::write(&path, original).unwrap();

        let err =
            insert_server_config(&path, "docs".to_string(), sample_server_config()).unwrap_err();

        assert!(err.contains("Failed to parse MCP config"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn load_from_valid_json_reads_servers() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("mcp-servers.json");
        std::fs::write(
            &path,
            r#"{
              "mcpServers": {
                "docs": {
                  "type": "stdio",
                  "command": "docs-server",
                  "timeout": 7
                }
              }
            }"#,
        )
        .unwrap();

        let config = McpConfigFile::load_from(&path).unwrap();

        let server = config.mcp_servers.get("docs").unwrap();
        assert_eq!(server.transport_type, McpTransportType::Stdio);
        assert_eq!(server.command.as_deref(), Some("docs-server"));
        assert_eq!(server.timeout, 7);
    }
}
