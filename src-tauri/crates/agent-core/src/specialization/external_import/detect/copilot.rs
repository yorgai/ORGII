//! Detectors for GitHub Copilot artifacts.
//!
//! Covers:
//!   - `.github/copilot-instructions.md`               → `Policy`
//!   - `.github/instructions/*.instructions.md`        → `Policy`
//!   - `.github/agents/<name>.agent.md`                → `AgentDefinition`
//!   - `.github/chatmodes/<name>.chatmode.md`          → `AgentDefinition`
//!
//! User-global Copilot agents are stored inside the VS Code profile,
//! which is OS-specific and not auto-detected here.

use std::path::Path;

use super::super::types::{
    frontmatter_declares_readonly, readonly_excluded_tool_names, DetectedItem, FidelityWarning,
    ItemKind, ItemPreview, SourceAgent, SourceScope,
};
use super::helpers::{
    first_body_line, orgii_agent_definition_exists, orgii_target_exists, path_has_denied_ancestor,
    split_frontmatter, MAX_ITEMS_PER_BATCH, MAX_RULE_BYTES,
};
use crate::specialization::policies::PolicySource;

// ============================================================
// GitHub Copilot — instructions (policies)
// ============================================================

pub(super) fn detect_copilot_instructions(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();
    let Some(repo) = repo_path else {
        return out;
    };

    let single = repo.join(".github").join("copilot-instructions.md");
    if single.is_file() && !path_has_denied_ancestor(&single) {
        if let Some(item) = build_copilot_single_item(&single, repo) {
            out.push(item);
        }
    }

    let dir = repo.join(".github").join("instructions");
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if !file_name.ends_with(".instructions.md") {
                continue;
            }
            if path_has_denied_ancestor(&path) {
                continue;
            }
            if let Some(item) = build_copilot_scoped_item(&path, repo) {
                out.push(item);
            }
        }
    }

    out
}

fn build_copilot_single_item(path: &Path, repo: &Path) -> Option<DetectedItem> {
    let raw = std::fs::read_to_string(path).ok()?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size_bytes > MAX_RULE_BYTES {
        return None;
    }

    let suggested_name = "copilot-instructions".to_string();
    let already_imported =
        orgii_target_exists(PolicySource::Workspace, Some(repo), &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::Copilot,
        source_scope: SourceScope::WorkspaceLocal {
            repo_path: repo.to_path_buf(),
        },
        kind: ItemKind::Policy,
        source_path: path.to_path_buf(),
        suggested_name,
        already_imported,
        fidelity_warnings: Vec::new(),
        preview: ItemPreview {
            summary: first_body_line(&raw),
            frontmatter: Vec::new(),
            size_bytes,
        },
    })
}

fn build_copilot_scoped_item(path: &Path, repo: &Path) -> Option<DetectedItem> {
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_suffix(".instructions.md"))?
        .to_string();
    if stem.is_empty() {
        return None;
    }

    let raw = std::fs::read_to_string(path).ok()?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size_bytes > MAX_RULE_BYTES {
        return None;
    }

    let mut warnings = Vec::new();
    let (frontmatter_pairs, body) = match split_frontmatter(&raw) {
        Ok((pairs, body)) => (pairs, body.to_string()),
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.clone())
        }
    };

    let suggested_name = format!("copilot-{}", stem);
    let already_imported =
        orgii_target_exists(PolicySource::Workspace, Some(repo), &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::Copilot,
        source_scope: SourceScope::WorkspaceLocal {
            repo_path: repo.to_path_buf(),
        },
        kind: ItemKind::Policy,
        source_path: path.to_path_buf(),
        suggested_name,
        already_imported,
        fidelity_warnings: warnings,
        preview: ItemPreview {
            summary: first_body_line(&body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

// ============================================================
// GitHub Copilot — agents (custom agents / chat modes)
//
// New layout (post-Oct 2025): `.github/agents/<name>.agent.md`
// Back-compat layout:         `.github/chatmodes/<name>.chatmode.md`
// ============================================================

pub(super) fn detect_copilot_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();
    if let Some(repo) = repo_path {
        let agents_dir = repo.join(".github").join("agents");
        scan_copilot_dir(
            &agents_dir,
            ".agent.md",
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            &mut out,
        );
        let chatmodes_dir = repo.join(".github").join("chatmodes");
        scan_copilot_dir(
            &chatmodes_dir,
            ".chatmode.md",
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            &mut out,
        );
    }
    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

fn scan_copilot_dir(dir: &Path, suffix: &str, scope: SourceScope, out: &mut Vec<DetectedItem>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out
            .iter()
            .filter(|item| item.kind == ItemKind::AgentDefinition)
            .count()
            >= MAX_ITEMS_PER_BATCH
        {
            return;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !file_name.ends_with(suffix) {
            continue;
        }
        if path_has_denied_ancestor(&path) {
            continue;
        }
        // Strip the composite suffix to recover the human-friendly stem,
        // e.g. `code-review.agent.md` → `code-review`.
        let stem = &file_name[..file_name.len() - suffix.len()];
        if stem.is_empty() {
            continue;
        }
        if let Some(item) = build_copilot_agent_item(&path, stem, &scope) {
            out.push(item);
        }
    }
}

fn build_copilot_agent_item(path: &Path, stem: &str, scope: &SourceScope) -> Option<DetectedItem> {
    let raw = std::fs::read_to_string(path).ok()?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size_bytes > MAX_RULE_BYTES {
        return None;
    }

    let mut warnings = Vec::new();
    let (frontmatter_pairs, body) = match split_frontmatter(&raw) {
        Ok((pairs, body)) => (pairs, body.to_string()),
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.clone())
        }
    };

    // Copilot frontmatter does not require a `name` field — fall back to
    // the (suffix-stripped) file stem.
    let suggested_name = frontmatter_pairs
        .iter()
        .find(|(k, _)| k == "name")
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| stem.to_string());

    if frontmatter_declares_readonly(&frontmatter_pairs) {
        warnings.push(FidelityWarning::ReadonlyDowngraded {
            excluded_tools: readonly_excluded_tool_names(),
        });
    }

    let already_imported = orgii_agent_definition_exists(&suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::Copilot,
        source_scope: scope.clone(),
        kind: ItemKind::AgentDefinition,
        source_path: path.to_path_buf(),
        suggested_name,
        already_imported,
        fidelity_warnings: warnings,
        preview: ItemPreview {
            summary: first_body_line(&body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}
