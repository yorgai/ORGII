//! Path syntax validation on [`SecurityPolicy`].
//!
//! Split from `policy/mod.rs` purely for file-size hygiene; these
//! methods retain access to private fields because Rust permits child
//! modules to read parent-module privates.
//!
//! Path *containment* (is this path inside the session's allowed
//! roots?) is NOT decided here — the single source of truth for that
//! is `core::session::workspace::SessionWorkspace::is_path_allowed`.
//! This module only rejects syntactically dangerous paths and the
//! user-configured forbidden list.

use std::path::{Component, Path, PathBuf};

use super::SecurityPolicy;

impl SecurityPolicy {
    /// Validate path *syntax* and the configured forbidden list.
    ///
    /// Rejects null bytes, `..` components, URL-encoded traversal, and
    /// any path inside `forbidden_paths`. Containment against the
    /// session workspace is the caller's responsibility (combine with
    /// `SessionWorkspace::is_path_allowed` when `workspace_only`).
    pub fn validate_path_syntax(&self, path: &str) -> Result<(), String> {
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
}
