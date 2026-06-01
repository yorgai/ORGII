//! Path validation methods on [`SecurityPolicy`].
//!
//! Split from `policy/mod.rs` purely for file-size hygiene; these
//! methods retain access to private fields because Rust permits child
//! modules to read parent-module privates.

use std::path::{Component, Path, PathBuf};

use super::SecurityPolicy;

impl SecurityPolicy {
    /// Add a directory to the allowed workspace list (e.g. IDE active repo).
    ///
    /// Paths added here are treated the same as `workspace_dir` for
    /// `workspace_only` checks. Duplicates are ignored.
    pub fn add_allowed_dir(&self, dir: PathBuf) {
        let mut dirs = self.extra_allowed_dirs.lock().unwrap_or_else(|err| {
            tracing::error!(
                "[security] POISONED LOCK on extra_allowed_dirs (add_allowed_dir) — recovering"
            );
            err.into_inner()
        });
        if !dirs.iter().any(|existing| existing == &dir) {
            dirs.push(dir);
        }
    }

    /// Check if an absolute path falls within the workspace or any extra allowed dir.
    pub(super) fn is_within_allowed_dirs(&self, path: &Path) -> bool {
        if path.starts_with(&self.workspace_dir) {
            return true;
        }
        let dirs = self
            .extra_allowed_dirs
            .lock()
            .unwrap_or_else(|err| {
                tracing::error!("[security] POISONED LOCK on extra_allowed_dirs (is_within_allowed_dirs) — recovering");
                err.into_inner()
            });
        dirs.iter().any(|allowed| path.starts_with(allowed))
    }

    /// Validate that a path is allowed for tool access.
    ///
    /// Rejects null bytes, `..` components, URL-encoded traversal,
    /// out-of-workspace absolute paths (when `workspace_only`), and
    /// any path inside the configured forbidden list.
    pub fn is_path_allowed(&self, path: &str) -> Result<(), String> {
        if path.contains('\0') {
            return Err("Path contains null bytes.".into());
        }

        let parsed = Path::new(path);

        for component in parsed.components() {
            if matches!(component, Component::ParentDir) {
                return Err("Path traversal (..) is not allowed.".into());
            }
        }

        let lower = path.to_lowercase();
        if lower.contains("..%2f")
            || lower.contains("%2f..")
            || lower.contains("..%5c")
            || lower.contains("%5c..")
        {
            return Err("URL-encoded path traversal is not allowed.".into());
        }

        let expanded = if let Some(suffix) = path.strip_prefix("~/") {
            let home = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
            home.join(suffix)
        } else {
            PathBuf::from(path)
        };

        if self.workspace_only && expanded.is_absolute() && !self.is_within_allowed_dirs(&expanded)
        {
            return Err(format!(
                "Path '{}' is outside the workspace directory.",
                path
            ));
        }

        for forbidden in &self.forbidden_paths {
            let forbidden_expanded = if let Some(suffix) = forbidden.strip_prefix("~/") {
                let home = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
                home.join(suffix)
            } else {
                PathBuf::from(forbidden)
            };

            if expanded.starts_with(&forbidden_expanded) {
                return Err(format!("Path '{}' is in a forbidden location.", path));
            }
        }

        Ok(())
    }

    /// Check if a resolved (canonicalized) path is within the workspace.
    ///
    /// Call this AFTER `std::fs::canonicalize()` to catch symlink escapes.
    /// Only relevant when `workspace_only` is true.
    pub fn is_resolved_path_allowed(&self, resolved: &Path) -> Result<(), String> {
        if !self.workspace_only {
            return Ok(());
        }

        let workspace_root = self.workspace_dir.canonicalize().map_err(|err| {
            format!(
                "Cannot canonicalize workspace '{}': {} — denying path access (fail-closed)",
                self.workspace_dir.display(),
                err
            )
        })?;

        if resolved.starts_with(&workspace_root) {
            return Ok(());
        }

        let dirs = self.extra_allowed_dirs.lock().unwrap_or_else(|err| {
            tracing::error!(
                "[security] POISONED LOCK on extra_allowed_dirs (symlink check) — recovering"
            );
            err.into_inner()
        });
        for dir in dirs.iter() {
            let canonical = dir.canonicalize().map_err(|err| {
                format!(
                    "Cannot canonicalize extra allowed dir '{}': {} — denying path access (fail-closed)",
                    dir.display(),
                    err
                )
            })?;
            if resolved.starts_with(&canonical) {
                return Ok(());
            }
        }

        Err(format!(
            "Resolved path '{}' escapes the workspace (possible symlink escape).",
            resolved.display()
        ))
    }
}
