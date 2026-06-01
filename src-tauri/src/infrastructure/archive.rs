//! Folder Archive Module
//!
//! Provides Tauri commands for creating ZIP archives from local folders.
//! Used for uploading local projects to cloud market sessions.

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

// ============================================
// Types
// ============================================

/// Result of folder archive operation
#[derive(Debug, Serialize, Deserialize)]
pub struct ArchiveResult {
    /// Base64-encoded ZIP data
    pub data: String,
    /// Size of the archive in bytes
    pub size: u64,
    /// Number of files archived
    pub files_count: usize,
    /// Original folder name
    pub folder_name: String,
}

/// Progress information during archiving
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveProgress {
    pub current: usize,
    pub total: usize,
    pub current_file: String,
}

// ============================================
// Constants
// ============================================

/// Maximum archive size (100MB)
const MAX_ARCHIVE_SIZE: u64 = 100 * 1024 * 1024;

/// Directories to exclude from archive
const EXCLUDED_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    ".env",
    ".cargo",
    ".cache",
    ".idea",
    ".vscode",
    "coverage",
    ".nyc_output",
];

/// Files to exclude from archive
const EXCLUDED_FILES: &[&str] = &[".DS_Store", "Thumbs.db", ".gitignore", ".gitattributes"];

// ============================================
// Helper Functions
// ============================================

/// Check if a path should be excluded from archiving
pub(crate) fn should_exclude(path: &Path) -> bool {
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    if EXCLUDED_DIRS.contains(&file_name) || EXCLUDED_FILES.contains(&file_name) {
        return true;
    }

    // Exclude hidden files/folders (starting with .)
    if file_name.starts_with('.') && file_name != "." && file_name != ".." {
        return true;
    }

    false
}

/// Collect all files to archive (respecting exclusions)
fn collect_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_files_recursive(root, root, &mut files);
    files
}

#[allow(clippy::only_used_in_recursion)]
fn collect_files_recursive(root: &Path, current: &Path, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(current) {
        for entry in entries.flatten() {
            let path = entry.path();

            if should_exclude(&path) {
                continue;
            }

            if path.is_dir() {
                collect_files_recursive(root, &path, files);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
}

/// Calculate the relative path for ZIP entry
pub(crate) fn get_relative_path(root: &Path, file: &Path) -> String {
    file.strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| {
            file.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

// ============================================
// Tauri Commands
// ============================================

/// Create a ZIP archive from a folder path
///
/// # Arguments
/// * `folder_path` - Absolute path to the folder to archive
///
/// # Returns
/// * `ArchiveResult` containing base64-encoded ZIP data
#[tauri::command(rename_all = "camelCase")]
pub fn create_folder_archive(
    folder_path: String,
    window: tauri::Window,
) -> Result<ArchiveResult, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = PathBuf::from(&folder_path);

    // Validate folder exists
    if !root.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }

    let folder_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    println!("📦 [FolderArchive] Creating archive for: {}", folder_path);

    // Collect files to archive
    let files = collect_files(&root);
    let total_files = files.len();

    println!("📦 [FolderArchive] Found {} files to archive", total_files);

    if total_files == 0 {
        return Err("No files found to archive".to_string());
    }

    // Create ZIP in memory
    let mut buffer = Vec::new();
    {
        let mut zip = ZipWriter::new(std::io::Cursor::new(&mut buffer));
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        for (index, file_path) in files.iter().enumerate() {
            let relative_path = get_relative_path(&root, file_path);

            // Emit progress event
            let _ = window.emit(
                "archive-progress",
                serde_json::json!({
                    "current": index + 1,
                    "total": total_files,
                    "current_file": relative_path,
                }),
            );

            // Read file contents
            let mut file = File::open(file_path)
                .map_err(|e| format!("Failed to open file {}: {}", relative_path, e))?;

            let mut contents = Vec::new();
            file.read_to_end(&mut contents)
                .map_err(|e| format!("Failed to read file {}: {}", relative_path, e))?;

            // Add to ZIP
            zip.start_file(&relative_path, options)
                .map_err(|e| format!("Failed to add file {}: {}", relative_path, e))?;

            zip.write_all(&contents)
                .map_err(|e| format!("Failed to write file {}: {}", relative_path, e))?;
        }

        zip.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;
    }

    let archive_size = buffer.len() as u64;

    // Check size limit
    if archive_size > MAX_ARCHIVE_SIZE {
        return Err(format!(
            "Archive too large: {} MB (max: {} MB)",
            archive_size / 1024 / 1024,
            MAX_ARCHIVE_SIZE / 1024 / 1024
        ));
    }

    // Encode to base64
    let base64_data = STANDARD.encode(&buffer);

    println!(
        "✅ [FolderArchive] Created archive: {} files, {} bytes",
        total_files, archive_size
    );

    // Emit completion event
    let _ = window.emit(
        "archive-complete",
        serde_json::json!({
            "folder_name": folder_name,
            "files_count": total_files,
            "size": archive_size,
        }),
    );

    Ok(ArchiveResult {
        data: base64_data,
        size: archive_size,
        files_count: total_files,
        folder_name,
    })
}

/// Get information about a folder without creating archive
/// Useful for showing preview before archiving
#[tauri::command(rename_all = "camelCase")]
pub fn get_folder_info(folder_path: String) -> Result<FolderInfo, String> {
    let root = PathBuf::from(&folder_path);

    if !root.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }

    let folder_name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("project")
        .to_string();

    let files = collect_files(&root);
    let total_size: u64 = files
        .iter()
        .filter_map(|f| fs::metadata(f).ok())
        .map(|m| m.len())
        .sum();

    Ok(FolderInfo {
        folder_name,
        files_count: files.len(),
        total_size,
        estimated_archive_size: total_size / 3, // Rough estimate after compression
    })
}

/// Folder information for preview
#[derive(Debug, Serialize, Deserialize)]
pub struct FolderInfo {
    pub folder_name: String,
    pub files_count: usize,
    pub total_size: u64,
    pub estimated_archive_size: u64,
}

// ============================================
// Tests
// ============================================

#[cfg(test)]
#[path = "tests/archive_tests.rs"]
mod tests;
