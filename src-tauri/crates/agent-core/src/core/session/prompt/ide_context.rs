//! IDE context formatter for coding session prompts.
//!
//! Formats IDE state (open files, cursor, git status, linter errors)
//! into a system prompt section.

use crate::session::IdeContext;

/// Format IDE context into a system prompt section.
pub fn format_ide_context(ctx: &IdeContext) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(ref active) = ctx.active_file {
        parts.push(format!("- Focused file: `{}`", active));
    }

    if let Some(ref pos) = ctx.cursor_position {
        parts.push(format!("- Cursor at: `{}`", pos));
    }

    if !ctx.open_files.is_empty() {
        parts.push(format!("- Open files: {}", ctx.open_files.join(", ")));
    }

    if let Some(ref branch) = ctx.git_branch {
        parts.push(format!("- Git branch: `{}`", branch));
    }

    if let Some(ref status) = ctx.git_status {
        parts.push(format!("- Git status: {}", status));
    }

    if !ctx.git_changed_files.is_empty() {
        let files = ctx.git_changed_files.join("\n  ");
        parts.push(format!("- Changed files:\n  {}", files));
    }

    if !ctx.linter_errors.is_empty() {
        let errors = ctx.linter_errors.join("\n  ");
        parts.push(format!("- Linter issues:\n  {}", errors));
    }

    if ctx.workspace_folders.len() > 1 {
        let folders = ctx
            .workspace_folders
            .iter()
            .map(|f| format!("`{}`", f))
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("- Workspace folders: {}", folders));
    }

    if parts.is_empty() {
        return String::new();
    }

    format!("## IDE Context\n\n{}", parts.join("\n"))
}
