//! Disk-usage and storage-management Tauri commands.
//!
//! Composes `~/.orgii/` path helpers from the `app_paths` workspace crate
//! into a single per-category storage report consumed by the Settings →
//! Disk Usage UI, plus a one-shot "clear category" command.
//!
//! Path helpers themselves live in `app_paths`. Callers that just need a
//! single path (e.g. `app_paths::logs_dir()`) should import from there
//! directly instead of going through this module.

use std::path::{Path, PathBuf};

use app_paths::{
    agent_worktrees_root, claude_code_cli_profile_root, codex_cli_profile_root, cursor_config_root,
    extensions_dir, file_history_root, gemini_cli_home_root, logs_dir, lsp_bin_dir, orgii_root,
    partials_dir, personal_workspace, screenshots_dir, session_images_dir, sessions_db,
};

/// Tauri command: path where agent memory (KG) is stored: `~/.orgii/sessions.db`.
#[tauri::command]
pub fn get_memory_storage_path() -> String {
    sessions_db().to_string_lossy().to_string()
}

/// Tauri command: cross-platform system temp directory.
#[tauri::command]
pub fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// A single storage category for the disk-usage report.
#[derive(serde::Serialize, Clone, Debug)]
pub struct StorageCategory {
    pub key: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
    pub exists: bool,
    /// True if the path is a directory (open folder); false if a file (reveal in explorer).
    pub is_folder: bool,
}

/// Full disk-usage report returned to the frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DiskUsageReport {
    pub root_path: String,
    pub categories: Vec<StorageCategory>,
    pub total_bytes: u64,
}

/// Recursively compute the size of a directory (or single file) in bytes.
fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_file() {
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            } else if ft.is_dir() {
                stack.push(entry.path());
            }
        }
    }
    total
}

/// Tauri command: compute disk usage for all known storage locations.
#[tauri::command]
pub fn get_disk_usage() -> DiskUsageReport {
    let categories_spec: Vec<(&str, &str, PathBuf)> = vec![
        ("sessionsDb", "Sessions Database", sessions_db()),
        ("logs", "Logs", logs_dir()),
        ("fileHistory", "Session File History", file_history_root()),
        (
            "personalWorkspace",
            "OS Agent Workspace",
            personal_workspace(),
        ),
        ("partials", "Session Partials", partials_dir()),
        ("cursorConfig", "Session CLI Configs", cursor_config_root()),
        (
            "claudeCodeCliProfiles",
            "Claude Code CLI Profiles",
            claude_code_cli_profile_root(),
        ),
        (
            "codexCliProfiles",
            "Codex CLI Profiles",
            codex_cli_profile_root(),
        ),
        ("geminiCliHome", "Gemini CLI Homes", gemini_cli_home_root()),
        ("extensions", "Extensions", extensions_dir()),
        ("sessionImages", "Chat Images", session_images_dir()),
        ("screenshots", "Browser Screenshots", screenshots_dir()),
        (
            "agentWorktrees",
            "Agent Session Worktrees",
            agent_worktrees_root(),
        ),
        ("lspBin", "LSP Server Binaries", lsp_bin_dir()),
    ];

    let categories: Vec<StorageCategory> = categories_spec
        .into_iter()
        .map(|(key, label, path)| {
            let size_bytes = dir_size(&path);
            let is_folder = path.exists() && path.is_dir();
            StorageCategory {
                key: key.to_string(),
                label: label.to_string(),
                path: path.to_string_lossy().to_string(),
                size_bytes,
                exists: path.exists(),
                is_folder,
            }
        })
        .collect();

    let total_bytes = categories.iter().map(|c| c.size_bytes).sum();

    DiskUsageReport {
        root_path: orgii_root().to_string_lossy().to_string(),
        categories,
        total_bytes,
    }
}

/// Map a category key back to its filesystem path.
fn category_path(key: &str) -> Option<PathBuf> {
    match key {
        "logs" => Some(logs_dir()),
        "fileHistory" => Some(file_history_root()),
        "personalWorkspace" => Some(personal_workspace()),
        "partials" => Some(partials_dir()),
        "cursorConfig" => Some(cursor_config_root()),
        "claudeCodeCliProfiles" => Some(claude_code_cli_profile_root()),
        "codexCliProfiles" => Some(codex_cli_profile_root()),
        "geminiCliHome" => Some(gemini_cli_home_root()),
        "extensions" => Some(extensions_dir()),
        "agentWorktrees" => Some(agent_worktrees_root()),
        "screenshots" => Some(screenshots_dir()),
        "lspBin" => Some(lsp_bin_dir()),
        _ => None,
    }
}

/// Categories that must NOT be cleared from the UI.
const PROTECTED_CATEGORIES: &[&str] = &["sessionsDb"];

/// Tauri command: clear (delete contents of) a storage category.
///
/// Returns the number of bytes freed. Protected categories (e.g. sessionsDb)
/// are rejected with an error.
#[tauri::command]
pub fn clear_storage_category(key: String) -> Result<u64, String> {
    if PROTECTED_CATEGORIES.contains(&key.as_str()) {
        return Err(format!("Category '{}' cannot be cleared", key));
    }

    let path = category_path(&key).ok_or_else(|| format!("Unknown storage category: {}", key))?;

    if !path.exists() {
        return Ok(0);
    }

    let freed = dir_size(&path);

    if path.is_file() {
        std::fs::remove_file(&path)
            .map_err(|err| format!("Failed to remove {}: {}", path.display(), err))?;
    } else {
        std::fs::remove_dir_all(&path)
            .map_err(|err| format!("Failed to remove {}: {}", path.display(), err))?;
        // Recreate the empty directory so future writes don't fail.
        std::fs::create_dir_all(&path)
            .map_err(|err| format!("Failed to recreate {}: {}", path.display(), err))?;
    }

    Ok(freed)
}
