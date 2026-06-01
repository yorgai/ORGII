//! Path helpers for the centralized project store.
//!
//! Roots:
//! - `~/.orgii/projects/`           — top-level project data root
//! - `~/.orgii/projects/assets/`    — binary attachments
//! - `~/.orgii/projects/exports/`   — manual export bundles
//!
//! The DB itself lives at `~/.orgii/projects/projects.db`; this module exposes
//! the sibling directory roots for assets and export bundles.

use std::path::PathBuf;

use app_paths::orgii_root;

/// Top-level project data root: `~/.orgii/projects/`.
pub fn projects_root() -> PathBuf {
    orgii_root().join("projects")
}

/// Binary assets directory: `~/.orgii/projects/assets/`.
///
/// Per-project subdirectory layout: `assets/{project_id}/{asset_id}.{ext}`.
pub fn assets_root() -> PathBuf {
    projects_root().join("assets")
}

/// Per-project assets directory: `~/.orgii/projects/assets/{project_id}/`.
pub fn project_assets_dir(project_id: &str) -> PathBuf {
    assets_root().join(project_id)
}

/// Manual export bundles directory: `~/.orgii/projects/exports/`.
///
/// Used by the `project_export_db` / `project_import_db` Tauri commands.
/// Each export is a self-contained SQLite file plus an assets tarball.
pub fn exports_root() -> PathBuf {
    projects_root().join("exports")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_root_ends_with_projects() {
        // The parent of `projects/` is the orgii root, which is either
        // `~/.orgii/` in production or a tempdir under `ORGII_HOME` during
        // sandboxed tests; only the trailing component is stable, so
        // that's all we assert here.
        let root = projects_root();
        assert!(
            root.ends_with("projects"),
            "expected path to end with 'projects', got {:?}",
            root
        );
    }

    #[test]
    fn assets_root_is_under_projects_root() {
        assert!(assets_root().starts_with(projects_root()));
    }

    #[test]
    fn project_assets_dir_includes_id() {
        let dir = project_assets_dir("01J9XYZ");
        assert!(dir.to_string_lossy().contains("01J9XYZ"));
        assert!(dir.starts_with(assets_root()));
    }

    #[test]
    fn exports_root_is_under_projects_root() {
        assert!(exports_root().starts_with(projects_root()));
    }
}
