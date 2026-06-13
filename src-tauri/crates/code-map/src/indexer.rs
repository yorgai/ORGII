use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use ignore::WalkBuilder;

use crate::db::FreshnessScan;
use crate::extract::{content_hash, extract_file};
use crate::paths::relative_path;
use crate::resolver::resolve_files;
use crate::types::{CodeMapIndexPhase, CodeMapIndexProgress, CodeMapLanguage, ExtractedFile};
use crate::{CodeMapError, Result};

const EXCLUDED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".turbo",
];

#[derive(Debug, Clone)]
pub struct IndexWorkspaceResult {
    pub extracted_files: Vec<ExtractedFile>,
    pub deleted_files: Vec<String>,
    pub added_files: u32,
    pub modified_files: u32,
}

pub fn scan_freshness(
    workspace_root: &Path,
    stored_files: &HashMap<String, (String, i64)>,
    requires_full_rebuild: bool,
) -> FreshnessScan {
    let files = collect_supported_files(workspace_root);
    let mut current_paths = std::collections::HashSet::new();
    let mut added = Vec::new();
    let mut modified = Vec::new();
    for path in files {
        let relative = relative_path(workspace_root, &path);
        current_paths.insert(relative.clone());
        let current_hash = match std::fs::read(&path) {
            Ok(content) => content_hash(&content),
            Err(_) => {
                modified.push(path);
                continue;
            }
        };
        match stored_files.get(&relative) {
            Some((stored_hash, _)) if stored_hash == &current_hash && !requires_full_rebuild => {}
            Some(_) => modified.push(path),
            None => added.push(path),
        }
    }

    let deleted = stored_files
        .keys()
        .filter(|path| !current_paths.contains(*path))
        .cloned()
        .collect();

    FreshnessScan {
        added,
        modified,
        deleted,
        requires_full_rebuild,
    }
}

pub fn index_workspace<F>(
    workspace_root: PathBuf,
    files_to_index: Vec<PathBuf>,
    deleted_files: Vec<String>,
    added_files: u32,
    modified_files: u32,
    cancellation: Arc<AtomicBool>,
    mut emit_progress: F,
) -> Result<IndexWorkspaceResult>
where
    F: FnMut(CodeMapIndexProgress),
{
    let workspace_path = workspace_root.to_string_lossy().to_string();
    let total = files_to_index.len() as u32;
    let mut extracted = Vec::new();

    emit_progress(CodeMapIndexProgress {
        workspace_path: workspace_path.clone(),
        phase: CodeMapIndexPhase::Extracting,
        files_processed: 0,
        files_total: total,
        current_file: None,
        added_files,
        modified_files,
        deleted_files: deleted_files.len() as u32,
        error: None,
    });

    for (index, file) in files_to_index.iter().enumerate() {
        if cancellation.load(Ordering::Relaxed) {
            return Err(CodeMapError::Cancelled(workspace_path));
        }
        emit_progress(CodeMapIndexProgress {
            workspace_path: workspace_path.clone(),
            phase: CodeMapIndexPhase::Extracting,
            files_processed: index as u32,
            files_total: total,
            current_file: Some(file.to_string_lossy().to_string()),
            added_files,
            modified_files,
            deleted_files: deleted_files.len() as u32,
            error: None,
        });
        if let Some(record) = extract_file(&workspace_root, file) {
            extracted.push(record);
        }
    }

    emit_progress(CodeMapIndexProgress {
        workspace_path: workspace_path.clone(),
        phase: CodeMapIndexPhase::Resolving,
        files_processed: total,
        files_total: total,
        current_file: None,
        added_files,
        modified_files,
        deleted_files: deleted_files.len() as u32,
        error: None,
    });
    resolve_files(&mut extracted);

    emit_progress(CodeMapIndexProgress {
        workspace_path,
        phase: CodeMapIndexPhase::Storing,
        files_processed: total,
        files_total: total,
        current_file: None,
        added_files,
        modified_files,
        deleted_files: deleted_files.len() as u32,
        error: None,
    });

    Ok(IndexWorkspaceResult {
        extracted_files: extracted,
        deleted_files,
        added_files,
        modified_files,
    })
}

pub fn collect_supported_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(
            std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1)
                .min(8),
        );

    for entry in builder.build().filter_map(std::result::Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        if path
            .components()
            .filter_map(|component| component.as_os_str().to_str())
            .any(|part| EXCLUDED_DIRS.contains(&part))
        {
            continue;
        }
        if CodeMapLanguage::from_path(path).is_some() {
            files.push(path.to_path_buf());
        }
    }
    files
}
