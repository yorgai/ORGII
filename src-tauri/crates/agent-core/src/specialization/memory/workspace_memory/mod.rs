//! Workspace Memory Store — file-based, workspace-scoped memory system (L2).
//!
//! Uses Markdown files with YAML frontmatter stored in
//! `{workspace}/.orgii/workspace-memory/`. No embeddings required — relevance is
//! determined by a Sonnet side-query at session start.
//!
//! # Architecture
//!
//! Self-contained ecosystem (everything L2 lives here):
//!
//! Module layout:
//!
//! - **`frontmatter`** — `parse_frontmatter` (YAML-style header parser),
//!   re-exported flat because `commands.rs` reaches it through
//!   `workspace_memory::parse_frontmatter`.
//! - **`manifest`** — directory scan, manifest formatting, `MEMORY.md`
//!   index loader, and age/freshness helpers, also flat-re-exported for
//!   the same reason.
//! - **`prompt_sections`** — eval-validated prompt constants
//!   (`TYPES_SECTION`, `WHAT_NOT_TO_SAVE`, `WHEN_TO_ACCESS`,
//!   `TRUSTING_RECALL`, `MEMORY_DRIFT_CAVEAT`, `MEMORY_FRONTMATTER_EXAMPLE`).
//!   Reached only by sibling submodules (`prefetch.rs`, `extract::runner.rs`)
//!   via their deeper path.
//! - **`prefetch`** — session-start side-query that selects the most
//!   relevant memories for the user's first message.
//! - **`extract`** — per-turn forked memory agent that decides whether
//!   to write/update memory files based on the latest exchange.
//! - **`auto_dream`** — offline forked memory agent that consolidates
//!   redundant or stale memory files in the background.
//! - **`lock`** — file mutex (`.consolidate-lock`) that protects
//!   `auto_dream` from running concurrently in two processes.

pub mod auto_dream;
pub mod extract;
pub mod lock;
pub mod prefetch;
pub mod surface_state;

mod frontmatter;
mod manifest;
mod prompt_sections;

use std::path::{Path, PathBuf};

pub use frontmatter::parse_frontmatter;
pub use manifest::{
    format_memory_manifest, load_memory_index, memory_age, memory_freshness_text, scan_memory_files,
};
// `prompt_sections::*` constants are reached only by sibling submodules
// (`prefetch.rs` + `extract::runner.rs`) via their deeper path, so we don't
// flatten them onto `workspace_memory::*`.

// ============================================
// Constants
// ============================================

/// Name of the index file.
pub const ENTRYPOINT_NAME: &str = "MEMORY.md";

/// Maximum lines in the MEMORY.md index before truncation.
pub const MAX_ENTRYPOINT_LINES: usize = 200;

/// Maximum bytes in the MEMORY.md index before truncation.
pub(super) const MAX_ENTRYPOINT_BYTES: usize = 25_000;

/// Maximum number of memory files to track.
pub(super) const MAX_MEMORY_FILES: usize = 200;

/// Maximum lines to read when parsing frontmatter.
pub(super) const FRONTMATTER_MAX_LINES: usize = 30;

/// Subdirectory under `.orgii/` for workspace memory.
const WORKSPACE_MEMORY_DIR: &str = "workspace-memory";

/// Returns true when `workspace` is (a path equivalent to) the OS Agent's
/// personal workspace (`~/.orgii/personal/workspace/`). Used by [`memory_dir`]
/// to redirect storage out of the nested `.orgii/workspace-memory/` location
/// it would otherwise produce there. Comparison is structural (canonicalize
/// when both sides exist on disk) so a `..` or trailing-slash variant still
/// matches.
fn is_personal_workspace(workspace: &Path) -> bool {
    let target = app_paths::personal_workspace();
    if workspace == target.as_path() {
        return true;
    }
    let lhs = std::fs::canonicalize(workspace).ok();
    let rhs = std::fs::canonicalize(&target).ok();
    matches!((lhs, rhs), (Some(a), Some(b)) if a == b)
}

// ============================================
// Types
// ============================================

/// Memory type taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryType {
    /// Information about the user's role, goals, preferences.
    User,
    /// Corrections, preferences, workflow adjustments from user feedback.
    Feedback,
    /// Workspace-specific facts, conventions, architectural decisions.
    Workspace,
    /// Reference material, API docs, tool usage patterns.
    Reference,
}

impl MemoryType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Feedback => "feedback",
            Self::Workspace => "workspace",
            Self::Reference => "reference",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_lowercase().as_str() {
            "user" => Some(Self::User),
            "feedback" => Some(Self::Feedback),
            "workspace" => Some(Self::Workspace),
            "reference" => Some(Self::Reference),
            _ => None,
        }
    }
}

impl std::fmt::Display for MemoryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Metadata header for a memory file.
#[derive(Debug, Clone)]
pub struct MemoryHeader {
    /// Relative path within the memory directory.
    pub filename: String,
    /// Absolute path on disk.
    pub file_path: PathBuf,
    /// Last modification time in milliseconds since epoch.
    pub mtime_ms: u64,
    /// Description from YAML frontmatter.
    pub description: Option<String>,
    /// Memory type from YAML frontmatter.
    pub memory_type: Option<MemoryType>,
}

// ============================================
// Path Helpers
// ============================================

/// Returns the workspace memory directory for a workspace.
///
/// Normal projects: `<workspace>/.orgii/workspace-memory/`.
///
/// **Personal-workspace special case:** when `workspace` IS the OS Agent's
/// personal workspace (`~/.orgii/personal/workspace/`), the natural join
/// would produce `~/.orgii/personal/workspace/.orgii/workspace-memory/` — a
/// nested `.orgii` inside the OS Agent's working directory that confuses
/// the workspace browser, leaks `.orgii/` artifacts into shell `ls`
/// output, and visually pretends `personal/workspace` is a workspace root.
/// We redirect to the flat `~/.orgii/personal/workspace-memory/` instead so
/// the OS Agent's workspace-memory sits alongside its other personal state
/// (`automations.json`, `rules/`, `rules-config.json`, …).
pub fn memory_dir(workspace: &Path) -> PathBuf {
    if is_personal_workspace(workspace) {
        return app_paths::personal_root().join(WORKSPACE_MEMORY_DIR);
    }
    workspace.join(".orgii").join(WORKSPACE_MEMORY_DIR)
}

/// Check if a path is inside the workspace memory directory.
pub fn is_memory_path(path: &Path, workspace: &Path) -> bool {
    let mem_dir = memory_dir(workspace);
    path.starts_with(&mem_dir)
}

/// One-time migration of workspace-memory files written under the legacy
/// nested location `~/.orgii/personal/workspace/.orgii/workspace-memory/` to
/// the new flat location `~/.orgii/personal/workspace-memory/`.
///
/// Triggered by [`migrate_personal_workspace_memory`] at app startup.
/// Idempotent: if the legacy directory is missing or already empty, this
/// is a no-op. Files already present at the destination are kept (the
/// legacy copy is dropped) to avoid clobbering newer content. Returns the
/// number of files moved so the caller can log the migration.
pub fn migrate_personal_workspace_memory() -> std::io::Result<usize> {
    let personal_ws = app_paths::personal_workspace();
    let legacy_dir = personal_ws.join(".orgii").join(WORKSPACE_MEMORY_DIR);
    if !legacy_dir.exists() {
        return Ok(0);
    }
    let new_dir = app_paths::personal_root().join(WORKSPACE_MEMORY_DIR);
    std::fs::create_dir_all(&new_dir)?;

    let mut moved = 0usize;
    for entry in std::fs::read_dir(&legacy_dir)? {
        let entry = entry?;
        let src = entry.path();
        if !src.is_file() {
            continue;
        }
        let Some(filename) = src.file_name() else {
            continue;
        };
        let dest = new_dir.join(filename);
        if dest.exists() {
            // Newer copy already at destination — drop the legacy one.
            let _ = std::fs::remove_file(&src);
            continue;
        }
        // rename() across same filesystem is atomic; falls back to copy
        // + delete on cross-device errors.
        if std::fs::rename(&src, &dest).is_err() {
            std::fs::copy(&src, &dest)?;
            let _ = std::fs::remove_file(&src);
        }
        moved += 1;
    }

    // Clean up the now-empty `.orgii/workspace-memory` and parent `.orgii` so
    // we don't leave a misleading shell `ls` artifact. Failures are
    // non-fatal — the dir might still hold a `.consolidate-lock` or a
    // user-dropped file we shouldn't touch.
    let _ = std::fs::remove_dir(&legacy_dir);
    let _ = std::fs::remove_dir(personal_ws.join(".orgii"));
    Ok(moved)
}

// ============================================
// Tool Policy
// ============================================

/// Allow-list tool policy used by both `extract::runner` and `auto_dream`.
///
/// The two forked memory agents share an identical surface: read tools
/// everywhere, plus `edit_file` (the runner / auto-dream are responsible
/// for confining writes to the memory directory via path checks before
/// invoking the tool — the policy only narrows the *available* surface).
pub(super) fn build_memory_policy() -> crate::tools::policy::ResolvedToolPolicy {
    use crate::tools::names as tool_names;
    use crate::tools::policy::{ResolvedToolPolicy, ToolPolicyLayer};
    ResolvedToolPolicy::from_layers(vec![ToolPolicyLayer {
        allow: Some(vec![
            tool_names::READ_FILE.to_string(),
            tool_names::CODE_SEARCH.to_string(),
            tool_names::LIST_DIR.to_string(),
            tool_names::RUN_SHELL.to_string(),
            tool_names::EDIT_FILE.to_string(),
        ]),
        deny: Vec::new(),
    }])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_type_parse() {
        assert_eq!(MemoryType::parse("user"), Some(MemoryType::User));
        assert_eq!(MemoryType::parse("feedback"), Some(MemoryType::Feedback));
        assert_eq!(MemoryType::parse("workspace"), Some(MemoryType::Workspace));
        assert_eq!(MemoryType::parse("reference"), Some(MemoryType::Reference));
        assert_eq!(MemoryType::parse("invalid"), None);
        assert_eq!(MemoryType::parse("User"), Some(MemoryType::User)); // case-insensitive
    }

    #[test]
    fn test_memory_dir() {
        let workspace = Path::new("/home/user/workspace");
        let dir = memory_dir(workspace);
        assert_eq!(
            dir,
            PathBuf::from("/home/user/workspace/.orgii/workspace-memory")
        );
    }

    #[test]
    fn test_is_memory_path() {
        let workspace = Path::new("/home/user/workspace");
        let mem_file = Path::new("/home/user/workspace/.orgii/workspace-memory/user_prefs.md");
        let other_file = Path::new("/home/user/workspace/src/main.rs");

        assert!(is_memory_path(mem_file, workspace));
        assert!(!is_memory_path(other_file, workspace));
    }

    /// `memory_dir(personal_workspace())` MUST flatten to
    /// `personal_root().join("workspace-memory")` — never to the nested
    /// `personal/workspace/.orgii/workspace-memory/` that the literal join
    /// would otherwise produce. Regression guard for the bug that
    /// surfaced 11 mystery memory files at the wrong location in the UI.
    #[test]
    fn memory_dir_redirects_personal_workspace() {
        let _sb = test_helpers::test_env::sandbox();
        let personal_ws = app_paths::personal_workspace();
        let dir = memory_dir(&personal_ws);
        let expected = app_paths::personal_root().join("workspace-memory");
        assert_eq!(dir, expected);
        assert!(
            !dir.starts_with(&personal_ws),
            "memory_dir for personal_workspace must NOT live inside personal_workspace itself; got {}",
            dir.display()
        );
    }

    /// One-time migration moves files from the legacy nested location
    /// into the flat `personal_root()/workspace-memory/` and deletes the
    /// now-empty parent `.orgii/` directory.
    #[test]
    fn migrate_personal_workspace_memory_moves_files_and_cleans_up() {
        let _sb = test_helpers::test_env::sandbox();
        let personal_ws = app_paths::personal_workspace();
        let legacy_dir = personal_ws.join(".orgii").join(WORKSPACE_MEMORY_DIR);
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("user_prefs.md"), "hello").unwrap();
        std::fs::write(legacy_dir.join("workspace_facts.md"), "world").unwrap();

        let moved = migrate_personal_workspace_memory().unwrap();
        assert_eq!(moved, 2);

        let new_dir = app_paths::personal_root().join(WORKSPACE_MEMORY_DIR);
        assert!(new_dir.join("user_prefs.md").exists());
        assert!(new_dir.join("workspace_facts.md").exists());

        // Legacy nested `.orgii/` MUST be gone so it stops showing up in
        // shell `ls` of the OS Agent's working directory.
        assert!(
            !legacy_dir.exists(),
            "legacy memory dir should be removed after migration"
        );
        assert!(
            !personal_ws.join(".orgii").exists(),
            "legacy parent .orgii should be removed after migration"
        );

        // Idempotent on second call.
        let again = migrate_personal_workspace_memory().unwrap();
        assert_eq!(again, 0);
    }

    /// Migration is safe to call when the legacy dir doesn't exist (most
    /// common case after first run / fresh install).
    #[test]
    fn migrate_personal_workspace_memory_no_legacy_is_noop() {
        let _sb = test_helpers::test_env::sandbox();
        let moved = migrate_personal_workspace_memory().unwrap();
        assert_eq!(moved, 0);
    }
}
