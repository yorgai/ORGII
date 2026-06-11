//! Shared helpers for all IDE detectors.

use std::path::{Path, PathBuf};

use crate::specialization::mcp::config::{
    global_config_path, workspace_config_path, McpConfigFile,
};
use crate::specialization::policies::{policies_dir_for_source, PolicySource};

/// Maximum size of a single rule file we'll surface in detection results.
pub(super) const MAX_RULE_BYTES: u64 = 1024 * 1024; // 1 MiB

/// Cap on items per `(SourceAgent, ItemKind)` pair.
pub(super) const MAX_ITEMS_PER_BATCH: usize = 1000;

/// Skip any path whose ancestors include a directory named one of these.
pub(super) const ANCESTOR_DENY_LIST: &[&str] = &["extensions", "node_modules", ".git"];

pub(super) type FrontmatterPairs = Vec<(String, String)>;

/// Tear off a `---\n...---\n` YAML frontmatter block. Returns the
/// (key, value-as-string) pairs and the remaining body.
pub(super) fn split_frontmatter(raw: &str) -> Result<(FrontmatterPairs, &str), String> {
    if !raw.starts_with("---") {
        return Ok((Vec::new(), raw));
    }
    let after_open = raw.strip_prefix("---").ok_or("missing opening fence")?;
    let after_open = after_open.strip_prefix('\n').unwrap_or(after_open);

    let close_idx = after_open
        .find("\n---")
        .ok_or_else(|| "missing closing frontmatter fence".to_string())?;
    let yaml = &after_open[..close_idx];
    let rest = &after_open[close_idx..];
    let rest = rest.strip_prefix("\n---").unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);

    let parsed: serde_yaml::Value =
        serde_yaml::from_str(yaml).map_err(|err| format!("yaml parse error: {}", err))?;

    let mut pairs = Vec::new();
    if let serde_yaml::Value::Mapping(map) = parsed {
        for (key, value) in map {
            let key_str = match key {
                serde_yaml::Value::String(s) => s,
                other => format!("{:?}", other),
            };
            let value_str = match value {
                serde_yaml::Value::String(s) => s,
                serde_yaml::Value::Bool(b) => b.to_string(),
                serde_yaml::Value::Number(n) => n.to_string(),
                serde_yaml::Value::Null => String::new(),
                other => serde_json::to_string(&other).unwrap_or_default(),
            };
            pairs.push((key_str, value_str));
        }
    }

    Ok((pairs, rest))
}

pub(super) fn first_body_line(body: &str) -> String {
    body.lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

pub(super) fn path_has_denied_ancestor(path: &Path) -> bool {
    path.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| ANCESTOR_DENY_LIST.contains(&name))
            .unwrap_or(false)
    })
}

pub(super) fn orgii_target_exists(
    source: PolicySource,
    workspace_path: Option<&Path>,
    name: &str,
) -> bool {
    let Ok(dir) = policies_dir_for_source(source, workspace_path) else {
        return false;
    };
    dir.join(format!("{}.md", name)).exists() || dir.join(format!("{}.mdc", name)).exists()
}

pub(super) fn orgii_skill_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
    let root = match target_repo_path {
        Some(repo_path) => repo_path.join(".orgii").join("skills"),
        None => app_paths::global_skills_dir(),
    };
    root.join(name).join("SKILL.md").exists()
}

pub(super) fn orgii_mcp_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
    let path = match target_repo_path {
        Some(repo_path) => workspace_config_path(repo_path),
        None => global_config_path(),
    };
    let Ok(config) = McpConfigFile::load_from(&path) else {
        return false;
    };
    config.mcp_servers.contains_key(name)
}

/// True iff a user-defined `AgentDefinition` with id `name` is already
/// persisted in `~/.orgii/agent-definitions.json`.
pub(super) fn orgii_agent_definition_exists(name: &str) -> bool {
    let path = app_paths::agent_definitions();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(arr) = value.as_array() else {
        return false;
    };
    arr.iter()
        .any(|entry| entry.get("id").and_then(|v| v.as_str()) == Some(name))
}

pub(super) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Codex's user-global config dir. Defaults to `~/.codex` but Codex
/// honors a `CODEX_HOME` env override; we mirror that so users with
/// relocated Codex homes still get auto-detection.
pub(super) fn codex_home_dir() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(custom));
    }
    home_dir().map(|h| h.join(".codex"))
}
