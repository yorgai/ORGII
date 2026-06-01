//! LSP Server Definitions
//!
//! Defines the `ServerDef` trait and implementations for all supported languages.
//! Each implementation owns:
//! - Root pattern detection (include/exclude markers)
//! - Auto-installation methods
//! - Initialization options
//! - File extension mappings

pub mod servers;

use std::path::{Path, PathBuf};

use super::install_pipeline::InstallMethod;
use super::root_detection::{find_nearest_root, RootPattern};

/// A language server definition.
///
/// Implementations define how to spawn, detect roots, and auto-install
/// a particular language server.
pub trait ServerDef: Send + Sync {
    /// Unique identifier for this server (e.g., "typescript", "gopls", "rust-analyzer").
    fn id(&self) -> &'static str;

    /// Human-readable display name (e.g., "TypeScript Language Server").
    fn display_name(&self) -> &'static str;

    /// File extensions this server handles (e.g., ["ts", "tsx", "mts", "cts"]).
    fn extensions(&self) -> &'static [&'static str];

    /// VSCode language IDs this server handles (e.g., ["typescript", "typescriptreact"]).
    fn language_ids(&self) -> &'static [&'static str];

    /// Pattern for detecting workspace root.
    fn root_pattern(&self) -> RootPattern;

    /// How to install this server if not found.
    fn install_method(&self) -> InstallMethod;

    /// The binary name to look for on PATH or in lsp-bin.
    fn binary_name(&self) -> &'static str;

    /// Command-line arguments to pass when spawning.
    fn command_args(&self) -> &'static [&'static str] {
        &["--stdio"]
    }

    /// Environment variables to set when spawning.
    fn env_vars(&self) -> Vec<(&'static str, String)> {
        vec![]
    }

    /// Initialization options to send with the `initialize` request.
    fn initialization_options(&self, _root: &Path) -> Option<serde_json::Value> {
        None
    }

    /// Workspace-level configuration to push via
    /// `workspace/didChangeConfiguration` immediately after `initialized`.
    ///
    /// LSP servers use this notification (not `initializationOptions`)
    /// for settings the user can change at runtime — e.g. format /
    /// validate toggles, tsdk pointers, lint rule overrides. The
    /// `Value` is the `params.settings` payload; the LSP host wraps
    /// it in the JSON-RPC envelope.
    fn workspace_configuration(&self, _root: &Path) -> Option<serde_json::Value> {
        None
    }

    /// Custom root detection logic.
    /// Default implementation uses `root_pattern()` with `find_nearest_root()`.
    fn find_root(&self, file: &Path, workspace_root: &Path) -> Option<PathBuf> {
        find_nearest_root(file, &self.root_pattern(), workspace_root)
    }

    /// Install hint string for display in UI (legacy compatibility).
    fn install_hint(&self) -> String {
        match self.install_method() {
            InstallMethod::Npm { package } => format!("npm install -g {}", package),
            InstallMethod::Go { module } => format!("go install {}", module),
            InstallMethod::Pip { package } => format!("pip install {}", package),
            InstallMethod::Cargo { crate_name } => format!("cargo install {}", crate_name),
            InstallMethod::Dotnet { tool } => format!("dotnet tool install -g {}", tool),
            InstallMethod::GithubRelease { repo, .. } => {
                format!("Download from https://github.com/{}/releases", repo)
            }
            InstallMethod::RequirePath => "Install via system package manager".to_string(),
        }
    }
}

/// Get all built-in server definitions.
pub fn builtin_servers() -> Vec<Box<dyn ServerDef>> {
    servers::all_servers()
}

/// Find server definitions that match a file path.
pub fn servers_for_file(file: &Path) -> Vec<&'static dyn ServerDef> {
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("");

    servers::STATIC_SERVERS
        .iter()
        .filter(|server| server.extensions().contains(&extension))
        .copied()
        .collect()
}

/// Find a server definition by ID.
pub fn server_by_id(id: &str) -> Option<&'static dyn ServerDef> {
    servers::STATIC_SERVERS
        .iter()
        .find(|s| s.id() == id)
        .copied()
}

/// Find server definitions by language ID (VSCode language identifier).
pub fn servers_for_language_id(language_id: &str) -> Vec<&'static dyn ServerDef> {
    let normalized = if language_id.starts_with("typescript") {
        "typescript"
    } else if language_id.starts_with("javascript") {
        "javascript"
    } else {
        language_id
    };

    servers::STATIC_SERVERS
        .iter()
        .filter(|server| {
            server.language_ids().contains(&normalized)
                || server.language_ids().contains(&language_id)
        })
        .copied()
        .collect()
}

/// Get all supported language IDs.
pub fn supported_language_ids() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = servers::STATIC_SERVERS
        .iter()
        .flat_map(|s| s.language_ids().iter().copied())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Get all supported file extensions.
pub fn supported_extensions() -> Vec<&'static str> {
    let mut exts: Vec<&'static str> = servers::STATIC_SERVERS
        .iter()
        .flat_map(|s| s.extensions().iter().copied())
        .collect();
    exts.sort();
    exts.dedup();
    exts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_by_id() {
        // Should find known servers
        let ts = server_by_id("typescript");
        assert!(ts.is_some());
        assert_eq!(ts.unwrap().id(), "typescript");
        assert!(ts.unwrap().extensions().contains(&"ts"));

        let rust = server_by_id("rust");
        assert!(rust.is_some());
        assert_eq!(rust.unwrap().id(), "rust");

        // Should return None for unknown servers
        assert!(server_by_id("unknown-server-xyz").is_none());
    }

    #[test]
    fn test_servers_for_file() {
        use std::path::Path;

        // TypeScript file
        let ts_servers = servers_for_file(Path::new("/path/to/file.ts"));
        assert!(!ts_servers.is_empty());
        assert!(ts_servers.iter().any(|s| s.id() == "typescript"));

        // Rust file
        let rust_servers = servers_for_file(Path::new("/path/to/main.rs"));
        assert!(!rust_servers.is_empty());
        assert!(rust_servers.iter().any(|s| s.id() == "rust"));

        // Python file
        let py_servers = servers_for_file(Path::new("/path/to/script.py"));
        assert!(!py_servers.is_empty());
        assert!(py_servers.iter().any(|s| s.id() == "python"));

        // Unknown extension
        let unknown = servers_for_file(Path::new("/path/to/file.xyz123"));
        assert!(unknown.is_empty());
    }

    #[test]
    fn test_servers_for_language_id() {
        // Direct match
        let ts = servers_for_language_id("typescript");
        assert!(!ts.is_empty());
        assert!(ts.iter().any(|s| s.id() == "typescript"));

        // Normalized match (typescriptreact -> typescript)
        let tsx = servers_for_language_id("typescriptreact");
        assert!(!tsx.is_empty());
        assert!(tsx.iter().any(|s| s.id() == "typescript"));

        // JavaScript variants
        let jsx = servers_for_language_id("javascriptreact");
        assert!(!jsx.is_empty());
        assert!(jsx.iter().any(|s| s.id() == "typescript"));
    }

    #[test]
    fn test_supported_language_ids() {
        let ids = supported_language_ids();
        assert!(ids.contains(&"typescript"));
        assert!(ids.contains(&"rust"));
        assert!(ids.contains(&"python"));
        assert!(ids.contains(&"go"));
    }

    #[test]
    fn test_supported_extensions() {
        let exts = supported_extensions();
        assert!(exts.contains(&"ts"));
        assert!(exts.contains(&"rs"));
        assert!(exts.contains(&"py"));
        assert!(exts.contains(&"go"));
    }

    #[test]
    fn test_builtin_servers_count() {
        let servers = builtin_servers();
        // We defined 28 servers
        assert!(
            servers.len() >= 20,
            "Expected at least 20 servers, got {}",
            servers.len()
        );
    }
}
