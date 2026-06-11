//! Detectors for Gemini CLI artifacts.
//!
//! Covers:
//!   - `GEMINI.md` / `~/.gemini/GEMINI.md`  → `Policy`
//!   - `.gemini/agents/<name>.md`            → `AgentDefinition`
//!
//! `GEMINI.md` is Gemini CLI's hierarchical context-file convention.
//! Gemini's own discovery walks up the tree and recurses into subdirs;
//! for ORGII's import we only surface the canonical workspace root +
//! user-global files since those are the ones a user would reasonably
//! "promote" into an ORGII rule.

use std::path::Path;

use super::super::types::{DetectedItem, ItemKind, ItemPreview, SourceAgent, SourceScope};
use super::helpers::{
    first_body_line, home_dir, orgii_target_exists, path_has_denied_ancestor, MAX_RULE_BYTES,
};
use super::vendor_agents::detect_vendor_agents;
use crate::specialization::policies::PolicySource;

// ============================================================
// Gemini CLI — `GEMINI.md`
// ============================================================

pub(super) fn detect_gemini_md(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let path = repo.join("GEMINI.md");
        if let Some(item) = build_gemini_md_item(
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
        if let Some(home) = home_dir() {
            let path = home.join(".gemini").join("GEMINI.md");
            if let Some(item) =
                build_gemini_md_item(&path, SourceScope::UserGlobal, PolicySource::Global, None)
            {
                out.push(item);
            }
        }
    }

    out
}

fn build_gemini_md_item(
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
        SourceScope::UserGlobal => "gemini-md-global".to_string(),
        SourceScope::WorkspaceLocal { .. } => "gemini-md".to_string(),
    };
    let already_imported = orgii_target_exists(target_source, workspace_path, &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::GeminiCli,
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
// Gemini CLI — agents (Oct 2025)
//
// Live under `.gemini/agents/<name>.md` (workspace) and
// `~/.gemini/agents/<name>.md` (user-global). Same markdown +
// YAML frontmatter shape as Claude Code / Cursor.
// ============================================================

pub(super) fn detect_gemini_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".gemini", SourceAgent::GeminiCli)
}
