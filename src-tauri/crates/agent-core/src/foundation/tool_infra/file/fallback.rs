//! "Did you mean…?" fallback chain for file/directory not-found errors.
//!
//! When [`super::path_resolution::resolve_path_with_extras`] succeeds in
//! turning a raw model path into a `PathBuf` but the entry doesn't exist (or
//! is the wrong kind), we don't bail immediately — instead we run the
//! fallback chain in [`resolve_existing_entry`]:
//!
//! 1. Trim whitespace, drop `./` / `/` / `<repo>/` / `:line:col` (handled by
//!    [`super::path_resolution::try_normalized_variants`]).
//! 2. Walk the workspace (`.gitignore`-aware, max depth 12) for an exact
//!    basename match — auto-resolved if exactly one hit.
//! 3. Walk again for fuzzy (Levenshtein) matches — used **only** as
//!    suggestions in [`not_found_error`], never auto-resolved.
//!
//! All walks honor the sandbox `allowed_dir`. Fuzzy matches are intentionally
//! not auto-resolved (per the workspace `No fallback` rule) — they're hints,
//! not silent recoveries.

use std::path::{Path, PathBuf};

use super::path_resolution::{
    entry_matches, resolve_path_with_extras, try_normalized_variants, EntryKind,
};

/// Maximum number of candidates to collect during a basename walk.
const MAX_BASENAME_CANDIDATES: usize = 8;

/// Walk the workspace (respecting `.gitignore`) and collect entries whose
/// basename matches `target_basename` exactly.
///
/// Returns paths canonicalized to the first `MAX_BASENAME_CANDIDATES` hits.
/// Used both for auto-resolution (when exactly one candidate exists) and
/// for rich error messages (when 0 or 2+ candidates exist).
pub(crate) fn find_basename_matches(
    workspace_root: &Path,
    target_basename: &str,
    kind: EntryKind,
) -> Vec<PathBuf> {
    if target_basename.is_empty() {
        return Vec::new();
    }

    let mut builder = ignore::WalkBuilder::new(workspace_root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .max_depth(Some(12));

    let mut matches = Vec::new();
    for entry in builder.build().flatten() {
        let path = entry.path();
        if path == workspace_root {
            continue;
        }
        let is_right_kind = match kind {
            EntryKind::File => entry.file_type().map(|t| t.is_file()).unwrap_or(false),
            EntryKind::Directory => entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        };
        if !is_right_kind {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some(target_basename) {
            matches.push(path.to_path_buf());
            if matches.len() >= MAX_BASENAME_CANDIDATES {
                break;
            }
        }
    }

    matches
}

/// Format a path relative to `root` for display; falls back to absolute.
fn display_relative(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| rel.display().to_string())
        .unwrap_or_else(|_| path.display().to_string())
}

/// Classic Levenshtein edit distance on character sequences.
///
/// Used by [`find_fuzzy_basename_matches`] to surface typo suggestions when
/// no exact basename match exists. Kept generic over `char` (not bytes) so
/// that UTF-8 filenames degrade gracefully.
fn levenshtein_distance(source: &str, target: &str) -> usize {
    let source_chars: Vec<char> = source.chars().collect();
    let target_chars: Vec<char> = target.chars().collect();
    let source_len = source_chars.len();
    let target_len = target_chars.len();
    if source_len == 0 {
        return target_len;
    }
    if target_len == 0 {
        return source_len;
    }

    let mut prev_row: Vec<usize> = (0..=target_len).collect();
    let mut curr_row = vec![0_usize; target_len + 1];

    for (idx, source_char) in source_chars.iter().enumerate() {
        curr_row[0] = idx + 1;
        for (jdx, target_char) in target_chars.iter().enumerate() {
            let cost = if source_char == target_char { 0 } else { 1 };
            curr_row[jdx + 1] = (prev_row[jdx + 1] + 1)
                .min(curr_row[jdx] + 1)
                .min(prev_row[jdx] + cost);
        }
        std::mem::swap(&mut prev_row, &mut curr_row);
    }
    prev_row[target_len]
}

/// Pick an edit-distance cutoff for typo suggestions based on how long the
/// target basename is. Short names (≤3 chars) allow at most 1 edit so that
/// `a.rs` doesn't "match" `b.rs`; longer names allow 2 edits so that
/// `READEM.md` can find `README.md`.
fn fuzzy_distance_threshold(target_basename: &str) -> usize {
    match target_basename.chars().count() {
        0..=3 => 1,
        _ => 2,
    }
}

/// Walk the workspace and collect entries whose basename is *similar* to
/// `target_basename` (Levenshtein distance within
/// [`fuzzy_distance_threshold`], excluding exact matches).
///
/// Returns up to [`MAX_BASENAME_CANDIDATES`] entries, sorted by edit
/// distance ascending so the closest typo appears first. Used **only** to
/// build "Did you mean" hints in [`not_found_error`] — fuzzy hits are never
/// auto-resolved because they're too risky (violates the `No fallback` rule).
pub(crate) fn find_fuzzy_basename_matches(
    workspace_root: &Path,
    target_basename: &str,
    kind: EntryKind,
) -> Vec<PathBuf> {
    if target_basename.is_empty() {
        return Vec::new();
    }
    let threshold = fuzzy_distance_threshold(target_basename);
    let target_lower = target_basename.to_lowercase();

    let mut builder = ignore::WalkBuilder::new(workspace_root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .max_depth(Some(12));

    let mut scored: Vec<(usize, PathBuf)> = Vec::new();
    for entry in builder.build().flatten() {
        let path = entry.path();
        if path == workspace_root {
            continue;
        }
        let is_right_kind = match kind {
            EntryKind::File => entry.file_type().map(|t| t.is_file()).unwrap_or(false),
            EntryKind::Directory => entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        };
        if !is_right_kind {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name == target_basename {
            continue;
        }
        let dist = levenshtein_distance(&target_lower, &name.to_lowercase());
        if dist == 0 || dist > threshold {
            continue;
        }
        scored.push((dist, path.to_path_buf()));
    }

    scored.sort_by(|lhs, rhs| lhs.0.cmp(&rhs.0).then_with(|| lhs.1.cmp(&rhs.1)));
    scored.truncate(MAX_BASENAME_CANDIDATES);
    scored.into_iter().map(|(_, path)| path).collect()
}

/// Resolve `raw` to an existing entry (file or directory), applying every
/// fallback strategy we have. Returns a rich error message on failure.
///
/// This is the entry point every file tool should use instead of
/// [`super::path_resolution::resolve_path_with_extras`] + a manual metadata check. It:
/// 1. Runs the strict sandbox-aware resolver.
/// 2. If that succeeds and the target is the right kind, returns it.
/// 3. Otherwise runs the fallback chain (normalize variants + basename walk).
/// 4. Otherwise produces a detailed [`not_found_error`].
///
/// Synchronous because every fallback is a cheap `Path::is_*` check or an
/// `ignore::Walk`, both non-async; the caller is responsible for wrapping
/// this in `super::FILE_IO_TIMEOUT` when network filesystems are a concern.
pub(crate) fn resolve_existing_entry(
    raw: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
    kind: EntryKind,
) -> Result<PathBuf, String> {
    if let Ok(resolved) = resolve_path_with_extras(raw, allowed_dir, additional_allowed_dirs) {
        if entry_matches(&resolved, kind) {
            return Ok(resolved);
        }
        if resolved.exists() {
            let label = match kind {
                EntryKind::File => "Not a file",
                EntryKind::Directory => "Not a directory",
            };
            return Err(format!("{}: {}", label, raw));
        }
    }

    match resolve_path_with_fallbacks(raw, allowed_dir, additional_allowed_dirs, kind) {
        Some(path) => Ok(path),
        None => Err(not_found_error(raw, allowed_dir, kind)),
    }
}

fn resolve_path_with_fallbacks(
    raw: &str,
    allowed_dir: Option<&Path>,
    additional_allowed_dirs: &[PathBuf],
    kind: EntryKind,
) -> Option<PathBuf> {
    if let Some(path) = try_normalized_variants(raw, allowed_dir, additional_allowed_dirs, kind) {
        return Some(path);
    }

    let allowed = allowed_dir?;
    let target_basename = Path::new(raw).file_name()?.to_str()?;
    let matches = find_basename_matches(allowed, target_basename, kind);

    if matches.len() == 1 {
        let path = matches.into_iter().next().unwrap();
        let canonical = path.canonicalize().ok()?;
        let canonical_allowed = allowed.canonicalize().ok()?;
        if canonical.starts_with(&canonical_allowed) {
            return Some(canonical);
        }
    }

    None
}

/// Build a rich "file not found" error after every fallback has failed.
///
/// Includes:
/// - The original path the LLM sent.
/// - The workspace root the agent is sandboxed to.
/// - Any basename matches we found inside the workspace (at most 5).
/// - A fallback note pointing at `search` / `list_dir` when we have nothing.
fn not_found_error(raw: &str, allowed_dir: Option<&Path>, kind: EntryKind) -> String {
    let label = match kind {
        EntryKind::File => "File",
        EntryKind::Directory => "Directory",
    };

    let Some(allowed) = allowed_dir else {
        return format!("{} not found: {}", label, raw);
    };

    let target_basename = Path::new(raw)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let mut msg = format!(
        "{} not found: {} (workspace root: {})",
        label,
        raw,
        allowed.display()
    );

    if !target_basename.is_empty() {
        let matches = find_basename_matches(allowed, target_basename, kind);
        if !matches.is_empty() {
            let rendered: Vec<String> = matches
                .iter()
                .take(5)
                .map(|path| display_relative(path, allowed))
                .collect();
            msg.push_str(&format!(
                ". Workspace contains {} with matching name: {}. \
                 Retry using one of these relative paths.",
                if matches.len() == 1 {
                    "1 entry".to_string()
                } else {
                    format!("{} entries", matches.len())
                },
                rendered.join(", ")
            ));
            return msg;
        }

        // No exact basename anywhere — try a fuzzy (Levenshtein) pass so the
        // model can recover from simple typos like `READEM.md` → `README.md`.
        let fuzzy = find_fuzzy_basename_matches(allowed, target_basename, kind);
        if !fuzzy.is_empty() {
            let rendered: Vec<String> = fuzzy
                .iter()
                .take(5)
                .map(|path| display_relative(path, allowed))
                .collect();
            msg.push_str(&format!(". Did you mean: {}?", rendered.join(", ")));
            return msg;
        }
    }

    msg.push_str(". Use `search` (action: find_files) or `list_dir` to locate it before retrying.");
    msg
}
