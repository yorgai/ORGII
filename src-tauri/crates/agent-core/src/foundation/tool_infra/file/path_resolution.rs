//! Path resolution: tilde expansion, sandbox enforcement, lexical normalization.
//!
//! All file tools route raw model-supplied paths through here before touching
//! the filesystem. This is the single point where `allowed_dir` (sandbox)
//! and `additional_allowed_dirs` (e.g. scratchpad) are honored.
//!
//! The fallback chain that recovers from common LLM path mistakes
//! (whitespace, leading `./`, leading `/`, `<repo>/...` prefix, trailing
//! `:line:col`) lives in `try_normalized_variants`; it's a building block
//! used by `super::fallback`.

use std::path::{Path, PathBuf};

/// Normalize a path lexically (without filesystem access).
/// Resolves `.` and `..` components via stack-based traversal.
///
/// Single crate-wide implementation — `core::session::workspace::
/// canonicalize_or_lexical` builds on this for its fallback branch.
pub(crate) fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Resolve and validate a file path.
///
/// Handles:
/// - `~` expansion to home directory
/// - Relative → absolute path resolution
/// - Null-byte rejection
/// - Optional sandbox restriction (`allowed_dir`)
/// - Optional additional allowed directories (e.g., scratchpad)
///
/// When `allowed_dir` is set, both the allowed directory and the target path
/// are canonicalized. If canonicalization fails (e.g., path doesn't exist yet
/// for writes), we normalize via the parent directory.
///
/// Paths that fall within any `additional_allowed_dirs` are also accepted,
/// even when outside the primary `allowed_dir`. This is used to grant the
/// agent access to its scratchpad directory without requiring user permission.
pub fn resolve_path_with_extras(
    raw: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err("Path contains null byte".to_string());
    }

    let expanded = if raw == "~" {
        dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?
    } else if let Some(suffix) = raw.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        home.join(suffix)
    } else {
        PathBuf::from(raw)
    };

    let resolved = if expanded.is_absolute() {
        expanded
    } else if let Some(base) = allowed_dir {
        base.join(expanded)
    } else {
        std::env::current_dir()
            .map_err(|err| format!("Cannot determine current directory: {}", err))?
            .join(expanded)
    };

    if let Some(allowed) = allowed_dir {
        let canonical_allowed = allowed.canonicalize().map_err(|err| {
            format!(
                "Cannot resolve allowed directory '{}': {}",
                allowed.display(),
                err
            )
        })?;

        let canonical_path = match resolved.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                let parent = resolved
                    .parent()
                    .ok_or_else(|| "Cannot determine parent directory".to_string())?;
                let canonical_parent = parent.canonicalize().map_err(|_| {
                    format!(
                        "Parent directory '{}' does not exist or is inaccessible",
                        parent.display()
                    )
                })?;
                let filename = resolved
                    .file_name()
                    .ok_or_else(|| "Path has no filename".to_string())?;
                canonical_parent.join(filename)
            }
        };

        if !canonical_path.starts_with(&canonical_allowed) {
            let in_extra = additional_allowed_dirs.iter().any(|extra_dir| {
                let canonical_extra = extra_dir
                    .canonicalize()
                    .unwrap_or_else(|_| normalize_lexical(extra_dir));
                canonical_path.starts_with(&canonical_extra)
            });

            if !in_extra {
                let mut allowed_roots = vec![canonical_allowed.display().to_string()];
                allowed_roots.extend(
                    additional_allowed_dirs
                        .iter()
                        .map(|dir| dir.display().to_string()),
                );
                return Err(format!(
                    "Path '{}' is outside the allowed directory '{}'. Allowed roots: {}",
                    raw,
                    canonical_allowed.display(),
                    allowed_roots.join(", ")
                ));
            }
        }
    }

    Ok(resolved)
}

/// How an existing entry (file or directory) should be matched during fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    File,
    Directory,
}

pub(super) fn entry_matches(path: &Path, kind: EntryKind) -> bool {
    match kind {
        EntryKind::File => path.is_file(),
        EntryKind::Directory => path.is_dir(),
    }
}

/// Try to normalize common path mistakes the LLM produces and re-resolve.
///
/// Attempts, in order:
/// 1. Trim whitespace.
/// 2. Drop a single leading `./`.
/// 3. Drop a single leading `/` (LLM sending workspace-relative paths as if
///    they were absolute).
/// 4. Drop a leading `<repo-basename>/` segment (LLM duplicating the repo name).
/// 5. Drop trailing `:<line>` or `:<line>:<col>` annotations (editor-style refs).
///
/// Each attempt is re-validated through [`resolve_path_with_extras`] so the
/// sandbox check is preserved. The first one whose metadata matches `kind`
/// wins.
pub(super) fn try_normalized_variants(
    raw: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
    kind: EntryKind,
) -> Option<PathBuf> {
    let mut variants: Vec<String> = Vec::new();

    let trimmed = raw.trim();
    if trimmed != raw {
        variants.push(trimmed.to_string());
    }

    if let Some(stripped) = trimmed.strip_prefix("./") {
        variants.push(stripped.to_string());
    }

    if let Some(stripped) = trimmed.strip_prefix('/') {
        variants.push(stripped.to_string());
    }

    if let Some(allowed) = allowed_dir {
        if let Some(basename) = allowed.file_name().and_then(|n| n.to_str()) {
            let prefix_slash = format!("{}/", basename);
            for candidate in [trimmed, trimmed.trim_start_matches('/')] {
                if let Some(stripped) = candidate.strip_prefix(&prefix_slash) {
                    variants.push(stripped.to_string());
                }
            }
        }
    }

    // Strip trailing ":<line>" or ":<line>:<col>" editor-style annotations.
    if let Some((prefix, suffix)) = trimmed.rsplit_once(':') {
        if suffix.chars().all(|c| c.is_ascii_digit()) && !suffix.is_empty() {
            let candidate = if let Some((inner_prefix, inner_suffix)) = prefix.rsplit_once(':') {
                if inner_suffix.chars().all(|c| c.is_ascii_digit()) && !inner_suffix.is_empty() {
                    inner_prefix.to_string()
                } else {
                    prefix.to_string()
                }
            } else {
                prefix.to_string()
            };
            if !candidate.is_empty() {
                variants.push(candidate);
            }
        }
    }

    for variant in variants {
        if let Ok(resolved) =
            resolve_path_with_extras(&variant, allowed_dir, additional_allowed_dirs)
        {
            if entry_matches(&resolved, kind) {
                return Some(resolved);
            }
        }
    }

    None
}

/// Test-only convenience wrapper — production callers always pass an
/// explicit `additional_allowed_dirs` slice via `resolve_path_with_extras`.
#[cfg(test)]
pub(super) fn resolve_path(raw: &str, allowed_dir: Option<&Path>) -> Result<PathBuf, String> {
    resolve_path_with_extras(raw, allowed_dir, &[])
}
