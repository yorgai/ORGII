//! Pure utility functions used by `prompt_builders`.
//!
//! Extracted to keep `prompt_builders.rs` under the 600-line limit.
//! All functions here are stateless helpers with no session/config awareness.

use std::path::Path;

use crate::session::types::ToolSummary;
use crate::utils::safe_truncate_utf8;

// ============================================
// Conventions loader
// ============================================

/// Maximum number of parent directories to walk when looking for
/// project-memory files above the workspace root (matches the reference
/// agent's bounded upward recursion).
const MEMORY_FILE_MAX_UPWARD_LEVELS: usize = 3;
/// Cap on any single memory file body.
const MEMORY_FILE_MAX_BYTES: usize = 40_000;
/// Maximum `@import` expansions per memory file (guards cycles/abuse).
const MEMORY_FILE_MAX_IMPORTS: usize = 8;

/// Load project conventions for the system prompt.
///
/// Layered merge (later layers append, never replace):
/// 1. `.orgii/agent-rules.md` — ORG2-native rules (highest priority, first)
/// 2. `CLAUDE.md` / `AGENTS.md` at the workspace root and up to
///    [`MEMORY_FILE_MAX_UPWARD_LEVELS`] parents (nearest wins per name) —
///    ecosystem-standard project memory used by other agent CLIs; loading
///    them makes ORG2 a drop-in for repos already carrying these files
/// 3. `CLAUDE.local.md` at the workspace root — user-local overrides
///
/// `@path` import lines inside CLAUDE.md-style files are expanded inline
/// (single level, bounded), matching the reference implementation.
pub(super) fn load_conventions(workspace_path: &Path) -> Option<String> {
    let mut sections: Vec<String> = Vec::new();

    let conventions_path = workspace_path.join(".orgii").join("agent-rules.md");
    match std::fs::read_to_string(&conventions_path) {
        Ok(content) => sections.push(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            tracing::warn!(
                "[prompt] Failed to read conventions at {}: {err}",
                conventions_path.display()
            );
        }
    }

    // CLAUDE.md / AGENTS.md: nearest file per name wins, searching the
    // workspace root first and then up to N parents.
    for name in ["CLAUDE.md", "AGENTS.md"] {
        let mut dir = Some(workspace_path);
        for _ in 0..=MEMORY_FILE_MAX_UPWARD_LEVELS {
            let Some(current) = dir else { break };
            let candidate = current.join(name);
            if let Ok(content) = std::fs::read_to_string(&candidate) {
                sections.push(format!(
                    "<!-- from {} -->\n{}",
                    candidate.display(),
                    expand_memory_imports(&content, current)
                ));
                break;
            }
            dir = current.parent();
        }
    }

    // CLAUDE.local.md: workspace root only (user-local, usually gitignored).
    let local = workspace_path.join("CLAUDE.local.md");
    if let Ok(content) = std::fs::read_to_string(&local) {
        sections.push(format!(
            "<!-- from {} -->\n{}",
            local.display(),
            expand_memory_imports(&content, workspace_path)
        ));
    }

    if sections.is_empty() {
        return None;
    }
    let merged = sections.join("\n\n");
    Some(cap_text(&merged, MEMORY_FILE_MAX_BYTES, "project conventions"))
}

/// Expand `@path` import lines (CLAUDE.md convention): a line consisting of
/// `@relative/or/absolute/path` is replaced by that file's contents. Single
/// level only — imported files are NOT scanned for further imports — and
/// bounded by [`MEMORY_FILE_MAX_IMPORTS`].
fn expand_memory_imports(content: &str, base_dir: &Path) -> String {
    let mut expanded_count = 0usize;
    let mut out: Vec<String> = Vec::with_capacity(content.lines().count());
    for line in content.lines() {
        let trimmed = line.trim();
        let is_import = trimmed.starts_with('@')
            && !trimmed.contains(char::is_whitespace)
            && trimmed.len() > 1;
        if !is_import || expanded_count >= MEMORY_FILE_MAX_IMPORTS {
            out.push(line.to_string());
            continue;
        }
        let raw_path = &trimmed[1..];
        let path = if Path::new(raw_path).is_absolute() {
            std::path::PathBuf::from(raw_path)
        } else {
            base_dir.join(raw_path)
        };
        match std::fs::read_to_string(&path) {
            Ok(imported) => {
                expanded_count += 1;
                out.push(format!("<!-- imported from {} -->", path.display()));
                out.push(imported);
            }
            Err(_) => out.push(line.to_string()),
        }
    }
    out.join("\n")
}

// ============================================
// Text truncation / formatting
// ============================================

pub(super) fn cap_text(text: &str, max_bytes: usize, label: &str) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    format!(
        "{}\n\n[{} truncated at {}KB]",
        safe_truncate_utf8(text, max_bytes),
        label,
        max_bytes / 1000
    )
}

pub(super) fn format_tool_summaries(tool_summaries: &[ToolSummary]) -> String {
    if tool_summaries.is_empty() {
        return "No tools currently available.".to_string();
    }
    tool_summaries
        .iter()
        .map(|ts| {
            let short = truncate_preview(&ts.description, 80);
            format!("- **{}**: {}", ts.name, short)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn truncate_preview(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    format!("{}...", safe_truncate_utf8(s, max_bytes))
}

pub(super) fn truncate_at_boundary(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_chars {
        return trimmed.replace('\n', " ");
    }
    let window = safe_truncate_utf8(trimmed, max_chars);
    let cut = window
        .rfind(". ")
        .map(|pos| pos + 1)
        .or_else(|| window.rfind('\n'))
        .unwrap_or(window.len());
    let mut result: String = window[..cut].replace('\n', " ");
    result.push_str("...");
    result
}

/// List all known project slugs from the global project store.
///
/// A DB read failure here previously vanished into `unwrap_or_default()`
/// and made the prompt look like the user had no projects at all,
/// which is indistinguishable from a fresh install. We now warn and
/// still return an empty list (the prompt section is best-effort
/// context — refusing to render the whole prompt would break worse
/// than silently omitting one section).
pub(super) fn list_project_slugs() -> Vec<String> {
    match project_management::projects::io::read_all_projects() {
        Ok(projects) => projects.into_iter().map(|p| p.slug).collect(),
        Err(err) => {
            tracing::warn!(
                "[prompt] read_all_projects failed: {}; omitting project list section",
                err
            );
            Vec::new()
        }
    }
}

// ============================================
// Workspace path / additional-dirs rendering
// ============================================

/// Resolve the workspace path string for prompt sections.
///
/// Channel-only sessions have no `SessionWorkspace`, so we fall back to
/// the orgii root (the user's personal workspace). Returning the displayable
/// string here keeps the two channel prompt sections from cloning the same
/// `unwrap_or(&orgii_root)` snippet.
pub(super) fn resolve_workspace_path_string(
    config: &crate::session::types::SystemPromptConfig,
) -> String {
    let orgii_root = app_paths::orgii_root();
    let ws_path = config
        .workspace
        .as_ref()
        .map(|ws| ws.working_dir())
        .unwrap_or(&orgii_root);
    ws_path.display().to_string()
}

/// Render an `Additional working directories:` block for the channel
/// system prompt. Returns an empty string when the session has none —
/// callers branch on `is_empty()` for layout.
pub(super) fn render_channel_additional_dirs_block(
    config: &crate::session::types::SystemPromptConfig,
) -> String {
    let Some(ws) = config.workspace.as_ref() else {
        return String::new();
    };
    if ws.additional_directories.is_empty() {
        return String::new();
    }
    let mut buf = String::from("- **Additional working directories:**\n");
    for path in ws.additional_directories.keys() {
        buf.push_str(&format!("   - `{}`\n", path.display()));
    }
    if buf.ends_with('\n') {
        buf.pop();
    }
    buf
}

pub(super) fn append_personal_workspace_context(lines: &mut Vec<String>, workspace_path: &str) {
    let slugs = list_project_slugs();
    if !slugs.is_empty() {
        lines.push(String::new());
        lines.push("### Personal Workspace".to_string());
        lines.push(format!("- **Path:** {}", workspace_path));
        lines.push(format!(
            "- **Projects:** {} ({})",
            slugs.len(),
            slugs.join(", ")
        ));
    }
}
