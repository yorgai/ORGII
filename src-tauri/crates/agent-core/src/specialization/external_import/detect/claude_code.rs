//! Detectors for Claude Code artifacts.
//!
//! Covers:
//!   - `CLAUDE.md` / `~/.claude/CLAUDE.md`     → `Policy`
//!   - `.claude/agents/<name>.md`               → `AgentDefinition`
//!   - `.claude/skills/<name>/SKILL.md`         → `Skill`
//!   - `.claude/commands/*.md`                  → `Skill`

use std::path::Path;

use super::super::types::{
    DetectedItem, FidelityWarning, ItemKind, ItemPreview, SourceAgent, SourceScope,
};
use super::helpers::{
    first_body_line, home_dir, orgii_skill_exists, orgii_target_exists, path_has_denied_ancestor,
    split_frontmatter, MAX_ITEMS_PER_BATCH, MAX_RULE_BYTES,
};
use super::vendor_agents::detect_vendor_agents;
use crate::specialization::policies::PolicySource;

// ============================================================
// Claude Code — `<repo>/CLAUDE.md` and `~/.claude/CLAUDE.md`
// ============================================================

pub(super) fn detect_claude_code_memory(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let path = repo.join("CLAUDE.md");
        if let Some(item) = build_claude_memory_item(
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
            let path = home.join(".claude").join("CLAUDE.md");
            if let Some(item) =
                build_claude_memory_item(&path, SourceScope::UserGlobal, PolicySource::Global, None)
            {
                out.push(item);
            }
        }
    }

    out
}

fn build_claude_memory_item(
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
        SourceScope::UserGlobal => "claude-memory-global".to_string(),
        SourceScope::WorkspaceLocal { .. } => "claude-memory".to_string(),
    };
    let already_imported = orgii_target_exists(target_source, workspace_path, &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::ClaudeCode,
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
// Claude Code — agents
// ============================================================

pub(super) fn detect_claude_code_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".claude", SourceAgent::ClaudeCode)
}

// ============================================================
// Claude Code — skills and slash commands
//
// Two layouts are supported:
//   - `~/.claude/skills/<name>/SKILL.md`
//   - `~/.claude/commands/*.md`
// ============================================================

pub(super) fn detect_claude_code_skills(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        scan_claude_skills_dir(
            &repo.join(".claude").join("skills"),
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            Some(repo),
            &mut out,
        );
        scan_claude_commands_dir(
            &repo.join(".claude").join("commands"),
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            Some(repo),
            &mut out,
        );
    }

    if repo_path.is_none() {
        if let Some(home) = home_dir() {
            scan_claude_skills_dir(
                &home.join(".claude").join("skills"),
                SourceScope::UserGlobal,
                None,
                &mut out,
            );
            scan_claude_commands_dir(
                &home.join(".claude").join("commands"),
                SourceScope::UserGlobal,
                None,
                &mut out,
            );
        }
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

fn scan_claude_skills_dir(
    dir: &Path,
    scope: SourceScope,
    target_repo_path: Option<&Path>,
    out: &mut Vec<DetectedItem>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if out
            .iter()
            .filter(|item| item.kind == ItemKind::Skill)
            .count()
            >= MAX_ITEMS_PER_BATCH
        {
            return;
        }
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path_has_denied_ancestor(&path) {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        if let Some(item) = build_claude_skill_item(
            &skill_md,
            &scope,
            target_repo_path,
            /* dir_layout */ true,
        ) {
            out.push(item);
        }
    }
}

fn scan_claude_commands_dir(
    dir: &Path,
    scope: SourceScope,
    target_repo_path: Option<&Path>,
    out: &mut Vec<DetectedItem>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if out
            .iter()
            .filter(|item| item.kind == ItemKind::Skill)
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
        if let Some(item) =
            build_claude_skill_item(&path, &scope, target_repo_path, /* dir_layout */ false)
        {
            out.push(item);
        }
    }
}

fn build_claude_skill_item(
    path: &Path,
    scope: &SourceScope,
    target_repo_path: Option<&Path>,
    dir_layout: bool,
) -> Option<DetectedItem> {
    // For `<dir>/SKILL.md` the canonical name is the parent directory's
    // file_name. For loose `commands/*.md` files we use the file stem.
    let stem = if dir_layout {
        path.parent()?.file_name()?.to_str()?.to_string()
    } else {
        path.file_stem()?.to_str()?.to_string()
    };
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

    let suggested_name = stem;
    let already_imported = orgii_skill_exists(target_repo_path, &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::ClaudeCode,
        source_scope: scope.clone(),
        kind: ItemKind::Skill,
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
