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

use super::repo_db::{self, RepoKind, RepoRecord};
use super::{register_workspace_with_watcher, unregister_workspace_from_watcher};
use crate::util::tokio_git_command;

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
pub async fn clone_github(
    url: String,
    target_dir: String,
    name: Option<String>,
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
    let output = tokio_git_command()?
        .args(["clone", &url, &clone_path])
        .output()
        .await
        .map_err(|err| format!("Failed to run git clone: {}", err))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git clone failed: {}", stderr.trim()));
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
