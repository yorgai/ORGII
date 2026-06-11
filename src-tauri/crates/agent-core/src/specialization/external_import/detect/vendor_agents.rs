//! Generic scanner for the `<dot-vendor>/agents/<name>.md` layout.
//!
//! Used by the Claude Code, Cursor, Codex, and Gemini detectors. The
//! parsing stays in lockstep across vendors — only the `SourceAgent`
//! brand differs. Adding a new vendor is a one-line dispatch entry.

use std::path::Path;

use super::super::types::{
    frontmatter_declares_readonly, readonly_excluded_tool_names, DetectedItem, FidelityWarning,
    ItemKind, ItemPreview, SourceAgent, SourceScope,
};
use super::helpers::{
    first_body_line, home_dir, orgii_agent_definition_exists, path_has_denied_ancestor,
    split_frontmatter, MAX_ITEMS_PER_BATCH, MAX_RULE_BYTES,
};

/// Scans `<dot-vendor>/agents/<name>.md` for both workspace-local and
/// user-global scopes.
pub(super) fn detect_vendor_agents(
    repo_path: Option<&Path>,
    vendor_dir: &str,
    source_agent: SourceAgent,
) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let dir = repo.join(vendor_dir).join("agents");
        scan_vendor_agent_dir(
            &dir,
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            source_agent,
            &mut out,
        );
    }

    if repo_path.is_none() {
        if let Some(home) = home_dir() {
            let dir = home.join(vendor_dir).join("agents");
            scan_vendor_agent_dir(&dir, SourceScope::UserGlobal, source_agent, &mut out);
        }
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

pub(super) fn scan_vendor_agent_dir(
    dir: &Path,
    scope: SourceScope,
    source_agent: SourceAgent,
    out: &mut Vec<DetectedItem>,
) {
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
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if path_has_denied_ancestor(&path) {
            continue;
        }

        if let Some(item) = build_vendor_agent_item(&path, &scope, source_agent) {
            out.push(item);
        }
    }
}

fn build_vendor_agent_item(
    path: &Path,
    scope: &SourceScope,
    source_agent: SourceAgent,
) -> Option<DetectedItem> {
    let stem = path.file_stem()?.to_str()?.to_string();
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

    let suggested_name = frontmatter_pairs
        .iter()
        .find(|(k, _)| k == "name")
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or(stem);

    if frontmatter_declares_readonly(&frontmatter_pairs) {
        warnings.push(FidelityWarning::ReadonlyDowngraded {
            excluded_tools: readonly_excluded_tool_names(),
        });
    }

    let already_imported = orgii_agent_definition_exists(&suggested_name);

    Some(DetectedItem {
        source_agent,
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
