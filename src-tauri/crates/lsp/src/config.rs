//! LSP Global Configuration
//!
//! Manages the global LSP configuration stored in `~/.orgii/lsp.json`.
//! This configuration controls:
//! - Auto-install behavior for LSP servers
//! - Custom server definitions (user-defined servers)
//! - Per-server overrides (e.g., custom binary path, args)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::RwLock;

use app_paths::lsp_config;

/// Global configuration for the LSP system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspConfig {
    /// Whether auto-install of missing LSP servers is enabled.
    /// Default: true
    #[serde(default = "app_utils::default_true")]
    pub auto_install: bool,

    /// Per-server configuration overrides keyed by server ID.
    #[serde(default)]
    pub servers: HashMap<String, ServerOverride>,

    /// Custom user-defined servers.
    #[serde(default)]
    pub custom_servers: Vec<CustomServerDef>,
}

impl Default for LspConfig {
    fn default() -> Self {
        Self {
            auto_install: true, // Default to enabled
            servers: HashMap::new(),
            custom_servers: Vec::new(),
        }
    }
}

/// Overrides for a built-in server definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOverride {
    /// Whether this server is enabled.
    /// Set to false to disable a built-in server.
    #[serde(default = "app_utils::default_true")]
    pub enabled: bool,

    /// Custom binary path (overrides default lookup).
    pub binary_path: Option<String>,

    /// Additional or replacement command-line arguments.
    pub args: Option<Vec<String>>,

    /// Additional environment variables.
    #[serde(default)]
    pub env: HashMap<String, String>,

    /// Custom initialization options (merged with defaults).
    pub init_options: Option<serde_json::Value>,
}

/// A custom user-defined LSP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomServerDef {
    /// Unique identifier for this server.
    pub id: String,

    /// Human-readable display name.
    pub display_name: String,

    /// File extensions this server handles.
    pub extensions: Vec<String>,

    /// VSCode language IDs this server handles.
    #[serde(default)]
    pub language_ids: Vec<String>,

    /// Binary name or full path.
    pub binary: String,

    /// Command-line arguments.
    #[serde(default)]
    pub args: Vec<String>,

    /// Environment variables to set.
    #[serde(default)]
    pub env: HashMap<String, String>,

    /// Files/directories that indicate workspace root.
    #[serde(default)]
    pub root_markers: Vec<String>,

    /// Initialization options to send.
    pub init_options: Option<serde_json::Value>,
}

// ============================================
// Global Config Instance
// ============================================

static CONFIG: OnceLock<RwLock<LspConfig>> = OnceLock::new();

/// Get the global LSP configuration, loading from disk if needed.
pub fn global_config() -> &'static RwLock<LspConfig> {
    CONFIG.get_or_init(|| {
        let config = load_config().unwrap_or_default();
        RwLock::new(config)
    })
}

/// Load configuration from `~/.orgii/lsp.json`.
pub fn load_config() -> Result<LspConfig, ConfigError> {
    let path = lsp_config();

    if !path.exists() {
        return Ok(LspConfig::default());
    }

    let content = std::fs::read_to_string(&path).map_err(|err| ConfigError::ReadError {
        path: path.clone(),
        reason: err.to_string(),
    })?;

    serde_json::from_str(&content).map_err(|err| ConfigError::ParseError {
        path,
        reason: err.to_string(),
    })
}

/// Save configuration to `~/.orgii/lsp.json`.
pub fn save_config(config: &LspConfig) -> Result<(), ConfigError> {
    let path = lsp_config();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| ConfigError::WriteError {
            path: path.clone(),
            reason: err.to_string(),
        })?;
    }

    let content =
        serde_json::to_string_pretty(config).map_err(|err| ConfigError::SerializeError {
            reason: err.to_string(),
        })?;

    std::fs::write(&path, content).map_err(|err| ConfigError::WriteError {
        path,
        reason: err.to_string(),
    })?;

    Ok(())
}

/// Reload configuration from disk into the global instance.
pub async fn reload_config() -> Result<(), ConfigError> {
    let config = load_config()?;
    let mut guard = global_config().write().await;
    *guard = config;
    Ok(())
}

/// Update the global configuration and save to disk.
pub async fn update_config<F>(updater: F) -> Result<(), ConfigError>
where
    F: FnOnce(&mut LspConfig),
{
    let mut guard = global_config().write().await;
    updater(&mut guard);
    save_config(&guard)
}

// ============================================
// Helper Functions
// ============================================

/// Check if auto-install is enabled.
pub async fn is_auto_install_enabled() -> bool {
    global_config().read().await.auto_install
}

/// Get override for a specific server.
pub async fn get_server_override(server_id: &str) -> Option<ServerOverride> {
    global_config().read().await.servers.get(server_id).cloned()
}

/// Check if a server is enabled (not explicitly disabled).
pub async fn is_server_enabled(server_id: &str) -> bool {
    let config = global_config().read().await;
    config
        .servers
        .get(server_id)
        .map(|o| o.enabled)
        .unwrap_or(true)
}

/// Get all custom server definitions.
pub async fn get_custom_servers() -> Vec<CustomServerDef> {
    global_config().read().await.custom_servers.clone()
}

/// Find a custom server by ID.
pub async fn find_custom_server(id: &str) -> Option<CustomServerDef> {
    global_config()
        .read()
        .await
        .custom_servers
        .iter()
        .find(|s| s.id == id)
        .cloned()
}

// ============================================
// Errors
// ============================================

/// Configuration errors.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Failed to read config from {path}: {reason}")]
    ReadError { path: PathBuf, reason: String },

    #[error("Failed to parse config from {path}: {reason}")]
    ParseError { path: PathBuf, reason: String },

    #[error("Failed to serialize config: {reason}")]
    SerializeError { reason: String },

    #[error("Failed to write config to {path}: {reason}")]
    WriteError { path: PathBuf, reason: String },
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = LspConfig::default();
        assert!(config.auto_install); // default_true
        assert!(config.servers.is_empty());
        assert!(config.custom_servers.is_empty());
    }

    #[test]
    fn test_config_serialization() {
        let config = LspConfig {
            auto_install: false,
            servers: {
                let mut map = HashMap::new();
                map.insert(
                    "rust".to_string(),
                    ServerOverride {
                        enabled: true,
                        binary_path: Some("/usr/local/bin/rust-analyzer".to_string()),
                        args: Some(vec!["--log-file=/tmp/ra.log".to_string()]),
                        env: HashMap::new(),
                        init_options: None,
                    },
                );
                map
            },
            custom_servers: vec![CustomServerDef {
                id: "my-lsp".to_string(),
                display_name: "My Custom LSP".to_string(),
                extensions: vec!["xyz".to_string()],
                language_ids: vec!["xyz".to_string()],
                binary: "my-lsp-server".to_string(),
                args: vec!["--stdio".to_string()],
                env: HashMap::new(),
                root_markers: vec!["my-project.json".to_string()],
                init_options: None,
            }],
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: LspConfig = serde_json::from_str(&json).unwrap();

        assert!(!parsed.auto_install);
        assert!(parsed.servers.contains_key("rust"));
        assert_eq!(parsed.custom_servers.len(), 1);
        assert_eq!(parsed.custom_servers[0].id, "my-lsp");
    }

    #[test]
    fn test_partial_config_parsing() {
        // Config with only some fields set
        let json = r#"{"autoInstall": false}"#;
        let config: LspConfig = serde_json::from_str(json).unwrap();

        assert!(!config.auto_install);
        assert!(config.servers.is_empty());
        assert!(config.custom_servers.is_empty());
    }
}
