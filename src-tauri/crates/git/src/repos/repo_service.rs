//! Repository service layer.
//!
//! Pure async functions that implement repository CRUD operations (list,
//! import, clone, create, remove, visibility). Both the Tauri commands in
//! `mod.rs` and the agent-side `manage_workspace` tool call into this module
//! so human UI and agent share exactly one code path.
//!
//! Each function:
//! - Returns `Result<T, String>` for a plain, serializable error.
//! - Handles DB persistence via `repo_db::*`.
//! - Registers / unregisters the git watcher where appropriate.
//! - Runs blocking work inside `spawn_blocking` so callers can `.await` safely.

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

use super::repo_db::{self, RepoKind, RepoRecord};
use super::{register_workspace_with_watcher, unregister_workspace_from_watcher};
use crate::util::tokio_git_command;

/// One progress update emitted while `git clone --progress` runs.
///
/// `phase` is the human-readable phase reported by git on stderr (e.g.
/// `"Receiving objects"`, `"Resolving deltas"`, `"Counting objects"`).
/// `percent` is `0..=100` when git supplied one, `None` for status lines
/// without a percentage (so the UI can decide whether to render an
/// indeterminate state vs. update the bar).
#[derive(Debug, Clone)]
pub struct CloneProgress {
    pub phase: String,
    pub percent: Option<u8>,
    /// Raw status line (trimmed). Useful for logging / debugging or when
    /// callers want to surface the exact git wording.
    pub raw: String,
}

/// Type-erased async-safe progress callback.
pub type CloneProgressCallback = Arc<dyn Fn(CloneProgress) + Send + Sync + 'static>;

// ============================================
// Helpers
// ============================================

fn canonical_string(path: &std::path::Path) -> Result<String, String> {
    path.canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to canonicalize '{}': {}", path.display(), e))
}

fn basename_or(default: &str, path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| default.to_string())
}

fn ensure_existing_dir(path: &str) -> Result<std::path::PathBuf, String> {
    let workspace_path = std::path::Path::new(path);
    if !workspace_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !workspace_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }
    Ok(workspace_path.to_path_buf())
}

async fn run_blocking<F, T>(op: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(op)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

// ============================================
// Read operations
// ============================================

/// List all tracked repositories (git + work folders), most recent first.
pub async fn list() -> Result<Vec<RepoRecord>, String> {
    run_blocking(repo_db::list_repos).await
}

/// Look up a single repository by id (usually a canonical path).
pub async fn get(repo_id: String) -> Result<Option<RepoRecord>, String> {
    run_blocking(move || repo_db::get_repo(&repo_id)).await
}

// ============================================
// Import (existing path)
// ============================================

/// Import an existing local directory as a git workspace.
///
/// If the directory does not already contain a `.git` folder, `git init` is
/// run so the workspace is immediately usable by git-based tools. Registers
/// with the git watcher.
pub async fn import_repo(path: String, name: Option<String>) -> Result<RepoRecord, String> {
    let workspace_path = ensure_existing_dir(&path)?;
    let canonical = canonical_string(&workspace_path)?;

    let repo_name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => basename_or("project", &canonical),
    };

    let git_dir = std::path::Path::new(&canonical).join(".git");
    if !git_dir.exists() {
        let output = tokio_git_command()?
            .args(["init", "-b", "main"])
            .current_dir(&canonical)
            .output()
            .await
            .map_err(|e| format!("Failed to run git init: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Directory is not a git repository and git init failed: {}",
                stderr.trim()
            ));
        }

        // Create an initial empty commit so "main" is a real branch (not unborn).
        let commit_output = tokio_git_command()?
            .args([
                "commit",
                "--allow-empty",
                "-m",
                "Initial commit",
                "--author=Orgii <orgii@local>",
            ])
            .current_dir(&canonical)
            .output()
            .await
            .map_err(|e| format!("Failed to create initial commit: {}", e))?;

        if !commit_output.status.success() {
            let stderr = String::from_utf8_lossy(&commit_output.stderr);
            log::warn!("Initial commit failed (non-fatal): {}", stderr.trim());
        }
    }

    let repo_id = canonical.clone();
    let persisted = {
        let id = repo_id.clone();
        let n = repo_name.clone();
        let p = canonical.clone();
        run_blocking(move || repo_db::ensure_repo(&id, &n, &p, RepoKind::Git)).await?
    };

    register_workspace_with_watcher(&persisted.repo_id, &persisted.path, &persisted.name);
    Ok(persisted)
}

/// Import an existing local directory as a plain work folder (no git init,
/// no watcher registration).
pub async fn import_folder(path: String, name: Option<String>) -> Result<RepoRecord, String> {
    let workspace_path = ensure_existing_dir(&path)?;
    let canonical = canonical_string(&workspace_path)?;

    let folder_name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => basename_or("folder", &canonical),
    };

    let folder_id = canonical.clone();
    let persisted = {
        let id = folder_id.clone();
        let n = folder_name.clone();
        let p = canonical.clone();
        run_blocking(move || repo_db::ensure_repo(&id, &n, &p, RepoKind::Folder)).await?
    };
    Ok(persisted)
}

/// Auto-detect whether `path` is a git repository (by `.git` presence) and
/// dispatch to the right importer. Used by agent tooling so the LLM does not
/// have to guess.
pub async fn import_auto(path: String, name: Option<String>) -> Result<RepoRecord, String> {
    let workspace_path = ensure_existing_dir(&path)?;
    let canonical = canonical_string(&workspace_path)?;

    if std::path::Path::new(&canonical).join(".git").exists() {
        import_repo(canonical, name).await
    } else {
        import_folder(canonical, name).await
    }
}

// ============================================
// Clone (from remote URL)
// ============================================

/// Clone a remote git repository into `target_dir/<name>` and register it.
///
/// Thin wrapper around [`clone_github_with_progress`] for callers that
/// don't care about live progress updates (e.g. the Tauri server command).
pub async fn clone_github(
    url: String,
    target_dir: String,
    name: Option<String>,
) -> Result<RepoRecord, String> {
    clone_github_with_progress(url, target_dir, name, None).await
}

/// Clone variant that streams `git clone --progress` stderr and forwards
/// parsed [`CloneProgress`] updates to `on_progress` if supplied.
///
/// The callback is invoked synchronously from a tokio task — keep it
/// cheap (a channel send or `bus::broadcast_event` is fine). It is never
/// invoked after this function returns.
pub async fn clone_github_with_progress(
    url: String,
    target_dir: String,
    name: Option<String>,
    on_progress: Option<CloneProgressCallback>,
) -> Result<RepoRecord, String> {
    let repo_name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            let trimmed = url.trim_end_matches('/');
            trimmed
                .rsplit('/')
                .next()
                .unwrap_or("repo")
                .trim_end_matches(".git")
                .to_string()
        }
    };

    if repo_name.is_empty() {
        return Err(
            "Could not extract repository name from URL. Please provide a name.".to_string(),
        );
    }

    let clone_path = format!("{}/{}", target_dir.trim_end_matches('/'), repo_name);

    let mut child = tokio_git_command()?
        .args(["clone", "--progress", &url, &clone_path])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run git clone: {}", e))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture git clone stderr".to_string())?;

    // git progress lines on stderr are separated by `\r` (carriage return)
    // for in-place updates; the final line for each phase ends in `\n`.
    // `read_until` with `b'\r'` gives us each intermediate update too.
    let progress_cb = on_progress.clone();
    let mut collected_stderr = String::new();
    let drain = async {
        let mut reader = BufReader::new(stderr);
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        loop {
            buf.clear();
            // Read up to the next `\r` *or* `\n`; both signal an update.
            // We can't pass two delimiters to `read_until`, so we read
            // until `\n` and split on `\r` ourselves.
            let n = reader
                .read_until(b'\n', &mut buf)
                .await
                .map_err(|e| format!("Failed to read git stderr: {}", e))?;
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf);
            collected_stderr.push_str(&chunk);
            for line in chunk.split(['\r', '\n']) {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Some(cb) = progress_cb.as_ref() {
                    if let Some(update) = parse_clone_progress_line(line) {
                        cb(update);
                    }
                }
            }
        }
        Ok::<_, String>(())
    };

    drain.await?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for git clone: {}", e))?;

    if !status.success() {
        return Err(format!("Git clone failed: {}", collected_stderr.trim()));
    }

    let canonical_path = std::path::Path::new(&clone_path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| clone_path.clone());

    let persisted = {
        let id = canonical_path.clone();
        let n = repo_name.clone();
        let p = canonical_path.clone();
        run_blocking(move || repo_db::ensure_repo(&id, &n, &p, RepoKind::Git)).await?
    };

    register_workspace_with_watcher(&persisted.repo_id, &persisted.path, &persisted.name);
    Ok(persisted)
}

/// Parse a single `git clone --progress` stderr status line into a
/// [`CloneProgress`].
///
/// Git progress lines look like:
///   `Receiving objects:  42% (1234/2940), 1.23 MiB | 5.00 MiB/s`
///   `Resolving deltas: 100% (1234/1234), done.`
///   `Counting objects: 2940, done.`
///   `remote: Enumerating objects: 2940, done.`
///
/// We extract the phase (substring before the first `:`) and the percent
/// if present. Lines we can't parse return `None` (the caller skips them).
fn parse_clone_progress_line(line: &str) -> Option<CloneProgress> {
    let trimmed = line.trim_start_matches("remote: ").trim();
    let colon = trimmed.find(':')?;
    let phase = trimmed[..colon].trim().to_string();
    if phase.is_empty() {
        return None;
    }
    let rest = trimmed[colon + 1..].trim();

    // Find a `<digits>%` token anywhere in `rest`.
    let percent = rest.split_whitespace().find_map(|tok| {
        let tok = tok.trim_end_matches(',');
        let digits = tok.strip_suffix('%')?;
        digits.parse::<u8>().ok()
    });

    Some(CloneProgress {
        phase,
        percent,
        raw: trimmed.to_string(),
    })
}

// ============================================
// Create (new empty workspace)
// ============================================

/// Create a new empty directory and register it as a git workspace (runs
/// `git init`). Fails if `path` cannot be created.
pub async fn create_empty_repo(path: String, name: Option<String>) -> Result<RepoRecord, String> {
    let dir_path = path.clone();
    run_blocking(move || {
        std::fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
    })
    .await?;

    // Use -b main so the default branch is "main" regardless of system git config.
    let output = tokio_git_command()?
        .args(["init", "-b", "main"])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| format!("Failed to run git init: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git init failed: {}", stderr.trim()));
    }

    // Create an initial empty commit so "main" is a real branch (not unborn).
    // Without this, `git branch` returns nothing and the UI shows no branches.
    let commit_output = tokio_git_command()?
        .args([
            "commit",
            "--allow-empty",
            "-m",
            "Initial commit",
            "--author=Orgii <orgii@local>",
        ])
        .current_dir(&path)
        .output()
        .await
        .map_err(|e| format!("Failed to create initial commit: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        log::warn!("Initial commit failed (non-fatal): {}", stderr.trim());
    }

    let canonical_path = std::path::Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());

    let repo_name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => basename_or("project", &canonical_path),
    };

    let persisted = {
        let id = canonical_path.clone();
        let n = repo_name.clone();
        let p = canonical_path.clone();
        run_blocking(move || repo_db::ensure_repo(&id, &n, &p, RepoKind::Git)).await?
    };

    register_workspace_with_watcher(&persisted.repo_id, &persisted.path, &persisted.name);
    Ok(persisted)
}

/// Create a new empty directory as a plain work folder (no git init).
pub async fn create_folder(path: String, name: Option<String>) -> Result<RepoRecord, String> {
    let dir_path = path.clone();
    run_blocking(move || {
        std::fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))
    })
    .await?;

    let canonical_path = std::path::Path::new(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.clone());

    let folder_name = match name {
        Some(n) if !n.trim().is_empty() => n,
        _ => basename_or("folder", &canonical_path),
    };

    let persisted = {
        let id = canonical_path.clone();
        let n = folder_name.clone();
        let p = canonical_path.clone();
        run_blocking(move || repo_db::ensure_repo(&id, &n, &p, RepoKind::Folder)).await?
    };
    Ok(persisted)
}

// ============================================
// Mutate / Remove
// ============================================

/// Update a repository's visibility (public / private). Fails if the value is
/// not one of those two strings.
pub async fn update_visibility(path: String, visibility: String) -> Result<(), String> {
    match visibility.as_str() {
        "public" | "private" => {}
        other => {
            return Err(format!(
                "Invalid visibility '{}', expected 'public' or 'private'",
                other
            ))
        }
    }
    run_blocking(move || repo_db::update_repo_visibility(&path, &visibility)).await
}

/// Remove a workspace from the tracked list. Files on disk are not touched.
/// Returns the deleted record (useful for UI feedback) or `None` if nothing
/// matched.
pub async fn remove(repo_id: String) -> Result<Option<RepoRecord>, String> {
    let lookup_id = repo_id.clone();
    let existing = run_blocking(move || repo_db::get_repo(&lookup_id)).await?;

    let Some(record) = existing else {
        return Ok(None);
    };

    let delete_id = record.repo_id.clone();
    let deleted = run_blocking(move || repo_db::delete_repo(&delete_id)).await?;
    if !deleted {
        return Err(format!(
            "Workspace '{}' exists but could not be deleted.",
            record.repo_id
        ));
    }

    unregister_workspace_from_watcher(&record.repo_id);
    Ok(Some(record))
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn parses_receiving_objects() {
        let p =
            parse_clone_progress_line("Receiving objects:  42% (1234/2940), 1.23 MiB | 5.00 MiB/s")
                .unwrap();
        assert_eq!(p.phase, "Receiving objects");
        assert_eq!(p.percent, Some(42));
    }

    #[test]
    fn parses_resolving_deltas_complete() {
        let p = parse_clone_progress_line("Resolving deltas: 100% (1234/1234), done.").unwrap();
        assert_eq!(p.phase, "Resolving deltas");
        assert_eq!(p.percent, Some(100));
    }

    #[test]
    fn parses_counting_objects_no_percent() {
        let p = parse_clone_progress_line("Counting objects: 2940, done.").unwrap();
        assert_eq!(p.phase, "Counting objects");
        assert_eq!(p.percent, None);
    }

    #[test]
    fn strips_remote_prefix() {
        let p = parse_clone_progress_line("remote: Enumerating objects: 2940, done.").unwrap();
        assert_eq!(p.phase, "Enumerating objects");
    }

    #[test]
    fn rejects_lines_without_colon() {
        assert!(parse_clone_progress_line("Cloning into 'foo'...").is_none());
    }
}
