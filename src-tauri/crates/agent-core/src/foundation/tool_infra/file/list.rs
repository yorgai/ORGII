//! Directory listing primitive: `list_dir`.
//!
//! Returns a sorted `Vec<(name, is_dir)>`. Wrapped with
//! [`super::FILE_IO_TIMEOUT`] to guard against hangs on slow / network mounts.
//!
//! Path resolution honors the sandbox `allowed_dir` and any
//! `additional_allowed_dirs` (e.g. scratchpad) just like the read/write
//! primitives — the underlying check is shared via
//! [`super::fallback::resolve_existing_entry`].

use std::path::{Path, PathBuf};

use super::fallback::resolve_existing_entry;
use super::path_resolution::EntryKind;
use super::FILE_IO_TIMEOUT;

/// List directory contents.
///
/// Returns a sorted vector of `(name, is_dir)` entries.
/// Wrapped with [`super::FILE_IO_TIMEOUT`].
///
/// `additional_allowed_dirs` lets callers grant access to extra trees
/// (e.g., the agent scratchpad) without widening the primary `allowed_dir`.
pub async fn list_dir_with_extras(
    path: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
) -> Result<Vec<(String, bool)>, String> {
    let resolved = resolve_existing_entry(
        path,
        allowed_dir,
        additional_allowed_dirs,
        EntryKind::Directory,
    )?;

    let inner = async {
        let mut entries = Vec::new();
        let mut dir = tokio::fs::read_dir(&resolved)
            .await
            .map_err(|err| format!("Failed to read directory: {}", err))?;

        while let Ok(Some(entry)) = dir.next_entry().await {
            let is_dir = entry
                .file_type()
                .await
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            let name = entry.file_name().to_string_lossy().to_string();
            entries.push((name, is_dir));
        }

        entries.sort_by(|entry_a, entry_b| entry_a.0.cmp(&entry_b.0));
        Ok(entries)
    };

    tokio::time::timeout(FILE_IO_TIMEOUT, inner)
        .await
        .map_err(|_| {
            format!(
                "list_dir timed out after {}s: {}",
                FILE_IO_TIMEOUT.as_secs(),
                path
            )
        })?
}

/// Test-only convenience wrapper — production callers always pass an
/// explicit `additional_allowed_dirs` slice via `list_dir_with_extras`.
#[cfg(test)]
pub(super) async fn list_dir(
    path: &str,
    allowed_dir: Option<&Path>,
) -> Result<Vec<(String, bool)>, String> {
    list_dir_with_extras(path, allowed_dir, &[]).await
}
