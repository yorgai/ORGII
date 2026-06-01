//! Detector pipeline for the external-import wizard.
//!
//! Phase 1 covers rule-flavored sources only. Each detector is a small
//! pure function: given a directory + scope, return `DetectedItem`s. We
//! never error on a single malformed file — broken frontmatter becomes
//! a `FidelityWarning::FrontmatterParseError` and the body is still
//! offered for import.

use std::path::{Path, PathBuf};

use super::types::{
    frontmatter_declares_readonly, readonly_excluded_tool_names, DetectedItem, FidelityWarning,
    ItemKind, ItemPreview, SourceAgent, SourceScope,
};
use crate::intelligence::mcp::config::{
    global_config_path, workspace_config_path, McpConfigFile, McpTransportType,
};
use crate::intelligence::policies::{policies_dir_for_source, PolicySource};

/// Maximum size of a single rule file we'll surface in detection
/// results. Larger files almost always indicate a bug or a misplaced
/// document and would dominate the wizard list.
const MAX_RULE_BYTES: u64 = 1024 * 1024; // 1 MiB

/// Cap on items per `(SourceAgent, ItemKind)` pair. Defends the wizard
/// against pathological repos with thousands of rule files.
const MAX_ITEMS_PER_BATCH: usize = 1000;

/// Skip any path whose ancestors include a directory named one of these
/// — they invariably point at vendor / extension bundles, not
/// user-authored rules. (We saw `CLAUDE.md` files inside
/// `~/.cursor/extensions/` and `~/.windsurf/extensions/` as bundled
/// extension docs; importing them would be wrong.)
const ANCESTOR_DENY_LIST: &[&str] = &["extensions", "node_modules", ".git"];

/// Top-level detector. Runs every source for one destination section and
/// concatenates the results. `None` scans user-global sources for the Global
/// section; `Some(repo)` scans repo-local sources for that repo's section.
/// Sources that produce zero items are silently omitted.
///
/// Phase 1 covered policy-flavored sources (rule files). Phase 2 adds
/// Skill and AgentDefinition sources from Claude Code's standard
/// layout (`~/.claude/agents/*.md`, `~/.claude/commands/*.md`,
/// `~/.claude/skills/<name>/SKILL.md`, plus the same paths under
/// `<repo>/.claude/`). Phase 3 adds Cursor IDE skill bundles from
/// `<repo>/.cursor/skills/<name>/SKILL.md` and the user-global
/// `~/.cursor/skills-cursor/<name>/SKILL.md`. Phase 4 adds MCP server
/// config detection from external `mcpServers` JSON files.
pub fn detect_all(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    out.extend(detect_cursor_rules(repo_path));
    out.extend(detect_claude_code_memory(repo_path));
    out.extend(detect_codex_agents_md(repo_path));
    out.extend(detect_gemini_md(repo_path));
    out.extend(detect_copilot_instructions(repo_path));
    out.extend(detect_kiro_steering(repo_path));

    out.extend(detect_claude_code_agents(repo_path));
    out.extend(detect_cursor_agents(repo_path));
    out.extend(detect_codex_agents(repo_path));
    out.extend(detect_gemini_agents(repo_path));
    out.extend(detect_copilot_agents(repo_path));
    out.extend(detect_claude_code_skills(repo_path));
    out.extend(detect_cursor_skills(repo_path));
    out.extend(detect_mcp_servers(repo_path));

    out
}

// ============================================================
// Cursor IDE — `.cursor/rules/*.mdc`
// ============================================================

pub(super) fn detect_cursor_rules(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let dir = repo.join(".cursor").join("rules");
        scan_cursor_rule_dir(
            &dir,
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            PolicySource::Workspace,
            Some(repo),
            &mut out,
        );
    }

    if repo_path.is_none() {
        let user_global = home_dir().map(|home| home.join(".cursor").join("rules"));
        if let Some(dir) = user_global {
            scan_cursor_rule_dir(
                &dir,
                SourceScope::UserGlobal,
                PolicySource::Global,
                None,
                &mut out,
            );
        }
    }

    out
}

fn scan_cursor_rule_dir(
    dir: &Path,
    scope: SourceScope,
    target_source: PolicySource,
    workspace_path: Option<&Path>,
    out: &mut Vec<DetectedItem>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return, // Missing dir is normal — silent.
    };

    for entry in entries.flatten() {
        if out
            .iter()
            .filter(|item| {
                matches!(item.source_agent, SourceAgent::CursorIde) && item.kind == ItemKind::Policy
            })
            .count()
            >= MAX_ITEMS_PER_BATCH
        {
            return;
        }

        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("mdc") {
            continue;
        }
        if path_has_denied_ancestor(&path) {
            continue;
        }

        let item = match build_cursor_rule_item(&path, &scope, target_source, workspace_path) {
            Some(item) => item,
            None => continue,
        };
        out.push(item);
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
}

fn build_cursor_rule_item(
    path: &Path,
    scope: &SourceScope,
    target_source: PolicySource,
    workspace_path: Option<&Path>,
) -> Option<DetectedItem> {
    let name = path.file_stem()?.to_str()?.to_string();
    if name.is_empty() {
        return None;
    }

    let raw = std::fs::read_to_string(path).ok()?;
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    if size_bytes > MAX_RULE_BYTES {
        return None;
    }

    let mut warnings = Vec::new();
    let (frontmatter_pairs, body) = match split_frontmatter(&raw) {
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
        }
    };

    let already_imported = orgii_target_exists(target_source, workspace_path, &name);

    Some(DetectedItem {
        source_agent: SourceAgent::CursorIde,
        source_scope: scope.clone(),
        kind: ItemKind::Policy,
        source_path: path.to_path_buf(),
        suggested_name: name,
        already_imported,
        fidelity_warnings: warnings,
        preview: ItemPreview {
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

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
// Codex — `<repo>/AGENTS.md` and `${CODEX_HOME:-~/.codex}/AGENTS.md`
//
// AGENTS.md is OpenAI Codex CLI's repo-instruction convention
// (analogous to Claude Code's CLAUDE.md). User-global location is
// `~/.codex/AGENTS.md` by default, but Codex honors a `CODEX_HOME`
// env var override — we mirror that so users with custom Codex
// homes still get auto-detection. We deliberately ignore the
// `AGENTS.override.md` sibling (it's meant for transient
// overrides, not import templates).
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
// Gemini CLI — `<repo>/GEMINI.md` and `~/.gemini/GEMINI.md`
//
// GEMINI.md is Gemini CLI's hierarchical context-file convention.
// Gemini's own discovery walks up the tree and recurses into
// subdirs; for ORGII's import we only surface the canonical workspace
// root + user-global files since those are the ones a user would
// reasonably "promote" into a ORGII rule.
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
// GitHub Copilot — `<repo>/.github/copilot-instructions.md`
//                 + `<repo>/.github/instructions/*.instructions.md`
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
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
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
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

// ============================================================
// Kiro — `<repo>/.kiro/steering/*.md`
// ============================================================

pub(super) fn detect_kiro_steering(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();
    let Some(repo) = repo_path else {
        return out;
    };

    let dir = repo.join(".kiro").join("steering");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };

    for entry in entries.flatten() {
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

        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.is_empty() {
            continue;
        }

        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size_bytes > MAX_RULE_BYTES {
            continue;
        }

        let suggested_name = format!("kiro-{}", stem);
        let already_imported =
            orgii_target_exists(PolicySource::Workspace, Some(repo), &suggested_name);

        out.push(DetectedItem {
            source_agent: SourceAgent::Kiro,
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
        });
    }

    out
}

// ============================================================
// Markdown sub-agent definitions — Claude Code, Cursor, Codex
//
// All three vendors converged on the same on-disk format: one
// markdown file per sub-agent under `<scope>/<vendor>/agents/`,
// with YAML frontmatter (`name`, `description`, optional model /
// tools / readonly) and the body as the system prompt. Cursor's
// own subagents docs explicitly enumerate `.cursor/agents/`,
// `.claude/agents/`, and `.codex/agents/` as compatible layouts:
// see https://cursor.com/docs/subagents.md
//
// We share `scan_vendor_agent_dir` + `build_vendor_agent_item`
// across all three so the parsing stays in lockstep — only the
// `SourceAgent` brand differs per vendor. Adding a new vendor is
// a one-line dispatch entry plus a new `SourceAgent` variant.
// ============================================================

pub(super) fn detect_claude_code_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".claude", SourceAgent::ClaudeCode)
}

pub(super) fn detect_cursor_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".cursor", SourceAgent::CursorIde)
}

pub(super) fn detect_codex_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    detect_vendor_agents(repo_path, ".codex", SourceAgent::Codex)
}

pub(super) fn detect_gemini_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    // Gemini CLI subagents (Oct 2025) live under `.gemini/agents/<name>.md`
    // (workspace) and `~/.gemini/agents/<name>.md` (user-global). Same
    // markdown + YAML frontmatter shape as Claude Code / Cursor.
    // Source: https://developers.googleblog.com/en/subagents-have-arrived-in-gemini-cli/
    detect_vendor_agents(repo_path, ".gemini", SourceAgent::GeminiCli)
}

pub(super) fn detect_copilot_agents(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    // GitHub Copilot custom agents (formerly "chat modes") live under
    // `<repo>/.github/agents/<name>.agent.md` (new, post-Oct 2025) and
    // `<repo>/.github/chatmodes/<name>.chatmode.md` (back-compat). User-
    // global Copilot agents are stored inside the VS Code profile, which
    // is OS-specific and not auto-detected here.
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
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
        }
    };

    // Copilot frontmatter does not require a `name` field — fall back
    // to the (suffix-stripped) file stem.
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
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

/// Generic scanner for the `<dot-vendor>/agents/<name>.md` layout.
/// Used by `detect_claude_code_agents` / `detect_cursor_agents` /
/// `detect_codex_agents` / `detect_gemini_agents`.
fn detect_vendor_agents(
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

fn scan_vendor_agent_dir(
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
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
        }
    };

    // Prefer `name` from frontmatter when present, otherwise fall back
    // to the file stem so the suggested name stays predictable.
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
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

// ============================================================
// Claude Code — skills and slash commands
//
// Two layouts are supported:
//   - `~/.claude/skills/<name>/SKILL.md` (and same under `<repo>/.claude/skills/`)
//   - `~/.claude/commands/*.md` (one file = one command-style skill)
// Import targets are decided by the current ORGII repo context, not by the source path.
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
    // file_name, not the literal "SKILL". For loose `commands/*.md`
    // files we use the file stem.
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
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
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
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

// ============================================================
// Cursor IDE — skills
//
// Two layouts are supported, mirroring how Cursor itself stores them:
//   - Workspace-local:  `<repo>/.cursor/skills/<name>/SKILL.md`
//   - User-global:    `~/.cursor/skills-cursor/<name>/SKILL.md`
//
// Both bundle as a directory containing `SKILL.md` (and optional
// sibling assets), identical to Claude Code's skill layout. The
// suggested name is the parent directory's `file_name`. Single-file
// loose layouts are intentionally NOT supported here — Cursor's UI
// always produces a directory bundle, and we don't want to fall into
// "import every random `.md` under `.cursor/`".
// ============================================================

pub(super) fn detect_cursor_skills(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        scan_cursor_skills_dir(
            &repo.join(".cursor").join("skills"),
            SourceScope::WorkspaceLocal {
                repo_path: repo.to_path_buf(),
            },
            Some(repo),
            &mut out,
        );
    }

    if repo_path.is_none() {
        if let Some(home) = home_dir() {
            // Cursor's user-global directory is `skills-cursor`, not `skills`,
            // to disambiguate from workspace-local skills inside repos that
            // happen to have a `.cursor/skills/` folder.
            scan_cursor_skills_dir(
                &home.join(".cursor").join("skills-cursor"),
                SourceScope::UserGlobal,
                None,
                &mut out,
            );
        }
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

fn scan_cursor_skills_dir(
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
            .filter(|item| {
                item.kind == ItemKind::Skill && matches!(item.source_agent, SourceAgent::CursorIde)
            })
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
        if let Some(item) = build_cursor_skill_item(&skill_md, &scope, target_repo_path) {
            out.push(item);
        }
    }
}

fn build_cursor_skill_item(
    path: &Path,
    scope: &SourceScope,
    target_repo_path: Option<&Path>,
) -> Option<DetectedItem> {
    let stem = path.parent()?.file_name()?.to_str()?.to_string();
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
        Ok(parts) => parts,
        Err(detail) => {
            warnings.push(FidelityWarning::FrontmatterParseError { detail });
            (Vec::new(), raw.as_str())
        }
    };

    let suggested_name = stem;
    let already_imported = orgii_skill_exists(target_repo_path, &suggested_name);

    Some(DetectedItem {
        source_agent: SourceAgent::CursorIde,
        source_scope: scope.clone(),
        kind: ItemKind::Skill,
        source_path: path.to_path_buf(),
        suggested_name,
        already_imported,
        fidelity_warnings: warnings,
        preview: ItemPreview {
            summary: first_body_line(body),
            frontmatter: frontmatter_pairs,
            size_bytes,
        },
    })
}

// ============================================================
// MCP servers — external `mcpServers` JSON configs
// ============================================================

fn detect_mcp_servers(repo_path: Option<&Path>) -> Vec<DetectedItem> {
    let mut out = Vec::new();

    if let Some(repo) = repo_path {
        let scope = SourceScope::WorkspaceLocal {
            repo_path: repo.to_path_buf(),
        };
        let candidates = [
            (
                repo.join(".cursor").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
            (
                repo.join(".cursor").join("mcp-servers.json"),
                SourceAgent::CursorIde,
            ),
            (
                repo.join(".claude").join("mcp.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                repo.join(".claude").join("mcp-servers.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                repo.join(".vscode").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
        ];
        for (path, source_agent) in candidates {
            scan_mcp_config_file(&path, source_agent, scope.clone(), Some(repo), &mut out);
        }
    } else if let Some(home) = home_dir() {
        let candidates = [
            (
                home.join(".cursor").join("mcp.json"),
                SourceAgent::CursorIde,
            ),
            (
                home.join(".cursor").join("mcp-servers.json"),
                SourceAgent::CursorIde,
            ),
            (
                home.join(".claude").join("mcp.json"),
                SourceAgent::ClaudeCode,
            ),
            (
                home.join(".claude").join("mcp-servers.json"),
                SourceAgent::ClaudeCode,
            ),
        ];
        for (path, source_agent) in candidates {
            scan_mcp_config_file(&path, source_agent, SourceScope::UserGlobal, None, &mut out);
        }
    }

    out.sort_by(|a, b| a.suggested_name.cmp(&b.suggested_name));
    out
}

fn load_external_mcp_config(path: &Path) -> Result<McpConfigFile, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read MCP config {}: {}", path.display(), err))?;
    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse MCP config {}: {}", path.display(), err))?;
    let Some(servers) = value
        .get_mut("mcpServers")
        .and_then(|entry| entry.as_object_mut())
    else {
        return Ok(McpConfigFile::default());
    };

    for server in servers.values_mut() {
        let Some(server_obj) = server.as_object_mut() else {
            continue;
        };
        if !server_obj.contains_key("type") {
            let inferred = if server_obj.contains_key("url") {
                "streamableHttp"
            } else {
                "stdio"
            };
            server_obj.insert(
                "type".to_string(),
                serde_json::Value::String(inferred.to_string()),
            );
        }
        if server_obj.get("type").and_then(|entry| entry.as_str()) == Some("http") {
            server_obj.insert(
                "type".to_string(),
                serde_json::Value::String("streamableHttp".to_string()),
            );
        }
    }

    serde_json::from_value(value).map_err(|err| {
        format!(
            "Failed to parse MCP server entries {}: {}",
            path.display(),
            err
        )
    })
}

fn scan_mcp_config_file(
    path: &Path,
    source_agent: SourceAgent,
    source_scope: SourceScope,
    target_repo_path: Option<&Path>,
    out: &mut Vec<DetectedItem>,
) {
    if !path.is_file() || path_has_denied_ancestor(path) {
        return;
    }

    let Ok(config) = load_external_mcp_config(path) else {
        return;
    };

    for (name, server_config) in config.mcp_servers {
        if out.iter().filter(|item| item.kind == ItemKind::Mcp).count() >= MAX_ITEMS_PER_BATCH {
            return;
        }
        if name.is_empty() {
            continue;
        }
        let summary = match server_config.transport_type {
            McpTransportType::Stdio => server_config
                .command
                .clone()
                .unwrap_or_else(|| "stdio MCP server".to_string()),
            McpTransportType::Sse => server_config
                .url
                .clone()
                .unwrap_or_else(|| "SSE MCP server".to_string()),
            McpTransportType::StreamableHttp => server_config
                .url
                .clone()
                .unwrap_or_else(|| "Streamable HTTP MCP server".to_string()),
        };
        let already_imported = orgii_mcp_exists(target_repo_path, &name);
        out.push(DetectedItem {
            source_agent,
            source_scope: source_scope.clone(),
            kind: ItemKind::Mcp,
            source_path: path.to_path_buf(),
            suggested_name: name,
            already_imported,
            fidelity_warnings: Vec::new(),
            preview: ItemPreview {
                summary,
                frontmatter: Vec::new(),
                size_bytes: std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0),
            },
        });
    }
}

// ============================================================
// Helpers
// ============================================================

type FrontmatterPairs = Vec<(String, String)>;

/// Tear off a `---\n...---\n` YAML frontmatter block. Returns the
/// (key, value-as-string) pairs and the remaining body. Frontmatter
/// values are emitted as JSON strings so the FE can render lists /
/// objects verbatim.
fn split_frontmatter(raw: &str) -> Result<(FrontmatterPairs, &str), String> {
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

    // Cheap, tolerant parse: we want pairs not full YAML semantics.
    // Anything we don't recognise is preserved as a JSON-encoded
    // string so the FE preview can show it.
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

fn first_body_line(body: &str) -> String {
    body.lines()
        .map(|line| line.trim())
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or("")
        .chars()
        .take(200)
        .collect()
}

fn path_has_denied_ancestor(path: &Path) -> bool {
    path.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| ANCESTOR_DENY_LIST.contains(&name))
            .unwrap_or(false)
    })
}

fn orgii_target_exists(source: PolicySource, workspace_path: Option<&Path>, name: &str) -> bool {
    let Ok(dir) = policies_dir_for_source(source, workspace_path) else {
        return false;
    };
    dir.join(format!("{}.md", name)).exists() || dir.join(format!("{}.mdc", name)).exists()
}

fn orgii_skill_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
    let root = match target_repo_path {
        Some(repo_path) => repo_path.join(".orgii").join("skills"),
        None => app_paths::global_skills_dir(),
    };
    root.join(name).join("SKILL.md").exists()
}

fn orgii_mcp_exists(target_repo_path: Option<&Path>, name: &str) -> bool {
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
/// persisted in `~/.orgii/agent-definitions.json`. We only check the
/// JSON-blob form — built-in agents (id starts with `builtin:`) are
/// never collision targets for a user import.
fn orgii_agent_definition_exists(name: &str) -> bool {
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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Codex's user-global config dir. Defaults to `~/.codex` but Codex
/// honors a `CODEX_HOME` env override (see OpenAI Codex CLI docs);
/// we mirror that so users with relocated Codex homes still get
/// auto-detection of their `AGENTS.md`.
fn codex_home_dir() -> Option<PathBuf> {
    if let Some(custom) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(custom));
    }
    home_dir().map(|h| h.join(".codex"))
}
