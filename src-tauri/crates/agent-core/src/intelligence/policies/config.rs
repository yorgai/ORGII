//! Per-policy configuration: agent scope and enabled state.
//!
//! Stored in `rules-config.json` at global (`~/.orgii/`) and workspace
//! (`{workspace}/.orgii/`) levels.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Configuration for a single policy.
///
/// `scope_repo_paths` / `scope_exclude_repo_paths` are absolute repository
/// paths (canonicalized by the caller) — they match against
/// `PromptCtx.config.workspace.working_dir()`. Path was chosen over a
/// frontend-generated repo UUID because the prompt pipeline's source of
/// truth for "which repo am I in" is the workspace dir, not the jotai store.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyConfig {
    /// Which agent IDs this policy applies to. Empty = all agents.
    #[serde(default)]
    pub agents: Vec<String>,
    /// Whether the policy is disabled.
    #[serde(default)]
    pub disabled: bool,
    /// Repo paths the policy is restricted to (include list). `None` = no
    /// restriction (apply to every repo subject to the exclude list).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_repo_paths: Option<Vec<String>>,
    /// Repo paths the policy must NOT apply to (takes precedence over the
    /// include list). `None` = no exclusions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_exclude_repo_paths: Option<Vec<String>>,
}

/// Per-policy configuration stored alongside policy files.
///
/// Global: `~/.orgii/rules-config.json`
/// Workspace: `{workspace}/.orgii/rules-config.json`
///
/// Policies NOT present in the map default to: enabled, applies to all agents.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PoliciesConfig {
    #[serde(default)]
    pub policies: HashMap<String, PolicyConfig>,
}

impl PoliciesConfig {
    pub fn load_global() -> Result<Self, String> {
        Self::load_from(&app_paths::global_policies_config())
    }

    pub fn load_for_workspace(workspace_path: &Path) -> Result<Self, String> {
        Self::load_from(&app_paths::workspace_policies_config(workspace_path))
    }

    pub fn load_from_path(path: &Path) -> Result<Self, String> {
        Self::load_from(path)
    }

    fn load_from(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }

        let content = std::fs::read_to_string(path)
            .map_err(|err| format!("Failed to read policies config {}: {}", path.display(), err))?;

        serde_json::from_str(&content).map_err(|err| {
            format!(
                "Failed to parse policies config {}: {}",
                path.display(),
                err
            )
        })
    }

    pub fn save_global(&self) -> Result<(), String> {
        Self::save_to_path(&app_paths::global_policies_config(), self)
    }

    pub fn save_for_workspace(&self, workspace_path: &Path) -> Result<(), String> {
        Self::save_to_path(&app_paths::workspace_policies_config(workspace_path), self)
    }

    pub fn save_to(path: &Path, config: &Self) -> Result<(), String> {
        Self::save_to_path(path, config)
    }

    fn save_to_path(path: &Path, config: &Self) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }
        }
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize policies config: {}", e))?;
        std::fs::write(path, json)
            .map_err(|e| format!("Failed to write policies config: {}", e))?;
        Ok(())
    }

    pub fn is_disabled(&self, policy_name: &str) -> bool {
        self.policies.get(policy_name).is_some_and(|c| c.disabled)
    }

    pub fn agents_for(&self, policy_name: &str) -> &[String] {
        self.policies.get(policy_name).map_or(&[], |c| &c.agents)
    }

    /// Repo include scope for a policy. Returns `None` when the policy has
    /// no entry, or its include list is `None`/empty.
    pub fn scope_repo_paths_for(&self, policy_name: &str) -> Option<Vec<String>> {
        self.policies
            .get(policy_name)
            .and_then(|c| c.scope_repo_paths.as_ref())
            .filter(|v| !v.is_empty())
            .cloned()
    }

    /// Repo exclude scope for a policy. Returns `None` when empty.
    pub fn scope_exclude_repo_paths_for(&self, policy_name: &str) -> Option<Vec<String>> {
        self.policies
            .get(policy_name)
            .and_then(|c| c.scope_exclude_repo_paths.as_ref())
            .filter(|v| !v.is_empty())
            .cloned()
    }

    /// Whether a policy applies to a given agent.
    /// No entry or empty agents list = applies to all.
    pub fn applies_to_agent(&self, policy_name: &str, agent_id: &str) -> bool {
        match self.policies.get(policy_name) {
            None => true,
            Some(cfg) => cfg.agents.is_empty() || cfg.agents.iter().any(|a| a == agent_id),
        }
    }

    /// Whether a policy applies to a given repo path.
    ///
    /// Semantics:
    /// - No entry, or both lists `None`/empty → applies to every repo.
    /// - `repo_path = None` (no workspace): if the policy declares any
    ///   include/exclude scope it cannot match → returns false; otherwise
    ///   true. Personal/sovereign sessions go through this with `None`.
    /// - Exclude list takes precedence over the include list.
    pub fn applies_to_repo(&self, policy_name: &str, repo_path: Option<&str>) -> bool {
        let Some(cfg) = self.policies.get(policy_name) else {
            return true;
        };
        let include_set = cfg.scope_repo_paths.as_ref();
        let exclude_set = cfg.scope_exclude_repo_paths.as_ref();
        let has_include = include_set.is_some_and(|v| !v.is_empty());
        let has_exclude = exclude_set.is_some_and(|v| !v.is_empty());
        if !has_include && !has_exclude {
            return true;
        }
        let Some(path) = repo_path else {
            // Policy is repo-scoped but caller has no repo context — drop
            // it instead of broadcasting to every personal/sovereign session.
            return false;
        };
        if has_exclude && exclude_set.unwrap().iter().any(|p| p == path) {
            return false;
        }
        if has_include {
            return include_set.unwrap().iter().any(|p| p == path);
        }
        true
    }
}

#[cfg(test)]
#[path = "tests/policies_config_tests.rs"]
mod tests;
