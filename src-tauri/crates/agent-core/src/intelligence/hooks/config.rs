//! Hook configuration — parsed from `.orgii/hooks.json`.
//!
//! ## Loading order (global → workspace, merged by event)
//!
//! 1. **Global:** `~/.orgii/hooks.json` — user-wide hooks for all workspaces
//! 2. **Workspace:** `<workspace>/.orgii/hooks.json` — workspace-specific hooks
//!
//! For the same event, hooks from both levels are **concatenated** (global first,
//! workspace appended). There are no built-in default hooks.
//!
//! ## File format
//!
//! ```json
//! {
//!   "hooks": {
//!     "pre_tool_use": [
//!       {
//!         "type": "command",
//!         "command": "echo pre-tool $ORGII_TOOL_NAME",
//!         "timeout_ms": 5000
//!       }
//!     ],
//!     "session_start": [
//!       {
//!         "type": "command",
//!         "command": "./scripts/on-session-start.sh",
//!         "timeout_ms": 10000
//!       }
//!     ]
//!   }
//! }
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use super::events::HookEvent;

/// Default timeout for command hooks (5 seconds).
const DEFAULT_TIMEOUT_MS: u64 = 5000;

/// Maximum timeout allowed for any hook (30 seconds).
const MAX_TIMEOUT_MS: u64 = 30_000;

/// HTTP method for webhook hooks.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    #[default]
    POST,
    PUT,
    PATCH,
}

/// A single hook entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HookEntry {
    /// Execute a shell command with event context as env vars.
    Command {
        command: String,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },
    /// Inject text into the system prompt (only fires on prompt-building events).
    Prompt { content: String },
    /// Send an HTTP webhook with event context as JSON body.
    Http {
        url: String,
        #[serde(default)]
        method: HttpMethod,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
        #[serde(default)]
        headers: HashMap<String, String>,
    },
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_MS
}

impl HookEntry {
    pub fn effective_timeout_ms(&self) -> u64 {
        match self {
            Self::Command { timeout_ms, .. } | Self::Http { timeout_ms, .. } => {
                (*timeout_ms).min(MAX_TIMEOUT_MS)
            }
            Self::Prompt { .. } => 0,
        }
    }
}

/// Top-level hooks configuration file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HooksConfig {
    #[serde(default)]
    pub hooks: HashMap<HookEvent, Vec<HookEntry>>,
}

impl HooksConfig {
    /// Load and merge hooks from global (`~/.orgii/hooks.json`) + workspace
    /// (`<workspace>/.orgii/hooks.json`). For the same event, global hooks
    /// come first, workspace hooks are appended.
    pub fn load(workspace_root: &Path) -> Self {
        Self::load_with_workspace_scope(workspace_root, true)
    }

    pub fn load_with_workspace_scope(
        workspace_root: &Path,
        load_workspace_resources: bool,
    ) -> Self {
        let global = Self::load_file(&global_hooks_path());
        let workspace = if load_workspace_resources {
            Self::load_file(&workspace_hooks_path(workspace_root))
        } else {
            Self::default()
        };

        if global.is_empty() {
            return workspace;
        }
        if workspace.is_empty() {
            return global;
        }

        info!(
            "[hooks] Merging {} global + {} workspace hook(s)",
            global.total_hooks(),
            workspace.total_hooks()
        );
        global.merge(workspace)
    }

    /// Load hooks from a single file path.
    fn load_file(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }

        match std::fs::read_to_string(path) {
            Ok(contents) => match serde_json::from_str::<HooksConfig>(&contents) {
                Ok(config) => config,
                Err(err) => {
                    warn!("[hooks] Failed to parse {}: {}", path.display(), err);
                    Self::default()
                }
            },
            Err(err) => {
                warn!("[hooks] Failed to read {}: {}", path.display(), err);
                Self::default()
            }
        }
    }

    /// Merge another config into this one. For each event, `other`'s hooks
    /// are appended after `self`'s hooks (global-first ordering).
    pub fn merge(mut self, other: Self) -> Self {
        for (event, entries) in other.hooks {
            self.hooks.entry(event).or_default().extend(entries);
        }
        self
    }

    /// Get hooks registered for a specific event.
    pub fn hooks_for(&self, event: HookEvent) -> &[HookEntry] {
        self.hooks.get(&event).map_or(&[], |v| v.as_slice())
    }

    /// Check if any hooks are configured.
    pub fn is_empty(&self) -> bool {
        self.hooks.values().all(|v| v.is_empty())
    }

    /// Total number of hook entries across all events.
    pub fn total_hooks(&self) -> usize {
        self.hooks.values().map(|v| v.len()).sum()
    }
}

/// `~/.orgii/hooks.json`
fn global_hooks_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".orgii")
        .join("hooks.json")
}

/// `<workspace>/.orgii/hooks.json`
fn workspace_hooks_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".orgii").join("hooks.json")
}
