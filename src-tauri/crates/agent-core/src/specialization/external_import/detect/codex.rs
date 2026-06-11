//! Detectors for OpenAI Codex CLI artifacts.
//!
//! Covers:
//!   - `AGENTS.md` / `~/.codex/AGENTS.md`  → `Policy`
//!   - `.codex/agents/<name>.md`            → `AgentDefinition`
//!
//! `AGENTS.md` is OpenAI Codex CLI's repo-instruction convention
//! (analogous to Claude Code's `CLAUDE.md`). The user-global location is
//! `~/.codex/AGENTS.md` by default, but Codex honors a `CODEX_HOME` env
//! var override — we mirror that so users with custom Codex homes still
//! get auto-detection. We deliberately ignore the `AGENTS.override.md`
//! sibling (it's meant for transient overrides, not import templates).

use std::path::Path;

use super::super::types::{DetectedItem, ItemKind, ItemPreview, SourceAgent, SourceScope};
use super::helpers::{
    codex_home_dir, first_body_line, orgii_target_exists, path_has_denied_ancestor, MAX_RULE_BYTES,
};
use super::vendor_agents::detect_vendor_agents;
use crate::specialization::policies::PolicySource;

// ============================================================
// Codex — `AGENTS.md`
// ============================================================

pub(super) fn detect_codex_agents_md(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let path = repo.join("AGENTS.md");
        if let Some(item) = build_codex_agents_item(
            &path,
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            PolicySource::Workspace,
            Some(repo),
        ) {
            out.push(item);
        }
    }

    if repo_path.is_none() {
        if let Some(dir) = codex_home_dir() {
            let path = dir.join("AGENTS.md");
            if let Some(item) =
                build_codex_agents_item(&path, SourceScope::UserGlobal, PolicySource::Global, None)
            {
                out.push(item);
            }
        }
    }

    out
}

fn build_codex_agents_item(
    path: &Path,
    scope: SourceScope,
    target_source: PolicySource,
    workspace_path: Option<&Path>,
) -> Option<DetectedItem> {
    if !path.is_file() {
        return None;
    }
    if path_has_denied_ancestor(path) {
        return None;
    }

    let raw = std::fs::read_to_string(path).ok()?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size_bytes > MAX_RULE_BYTES {
        return None;
    }

    let suggested_name = match scope {
        SourceScope::UserGlobal => "agents-md-global".to_string(),
        SourceScope::WorkspaceLocal { .. } => "agents-md".to_string(),
    };
    let already_imported = orgii_target_exists(target_source, workspace_path, &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::Codex,
        source_scope: scope,
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

// ============================================================
// Codex — agents
// ============================================================

pub(super) fn detect_codex_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".codex", SourceAgent::Codex)
}
