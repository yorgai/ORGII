//! Global state, cancellation registry, and file collection helpers.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use super::super::intelligence::ALL_LANGUAGES;
use super::types::SearchFilters;

// ── Global State ────────────────────────────────────────────────────────

/// Map of active search IDs to their cancellation flags.
static ACTIVE_SEARCHES: std::sync::LazyLock<RwLock<HashMap<String, Arc<AtomicBool>>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashMap::new()));

// ── Cancellation Registry ───────────────────────────────────────────────

/// Register a new search and return its cancellation flag.
pub(super) fn register_search(search_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    ACTIVE_SEARCHES
        .write()
        .unwrap()
        .insert(search_id.to_string(), flag.clone());
    flag
}

/// Unregister a search when it completes.
pub(super) fn unregister_search(search_id: &str) {
    ACTIVE_SEARCHES.write().unwrap().remove(search_id);
}

/// Cancel a search by setting its cancellation flag.
#[tauri::command]
pub fn cancel_search(search_id: String) -> bool {
    if let Some(flag) = ACTIVE_SEARCHES.read().unwrap().get(&search_id) {
        flag.store(true, Ordering::Relaxed);
        println!("🛑 [Search] Cancelled search: {}", search_id);
        true
    } else {
        false
    }
}

// ── File Helpers ────────────────────────────────────────────────────────

/// Read file content safely.
pub(super) fn read_file_content(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Get context on the SAME LINE around a match.
/// Returns (before_on_line, after_on_line).
pub(super) fn get_same_line_context(
    line: &str,
    match_start: usize,
    match_end: usize,
) -> (String, String) {
    let before = if match_start > 0 {
        line[..match_start].to_string()
    } else {
        String::new()
    };

    let after = if match_end < line.len() {
        line[match_end..].to_string()
    } else {
        String::new()
    };

    (before, after)
}

/// Walk directory and collect supported files using parallel `ignore` crate.
/// This is the same library that ripgrep uses internally.
pub(super) fn collect_files(root: &Path, filters: &SearchFilters) -> Vec<PathBuf> {
    use ignore::WalkBuilder;
    use std::sync::Mutex;

    let files = Mutex::new(Vec::new());

    let exclude_dirs = filters.exclude_dirs.clone().unwrap_or_else(|| {
        vec![
            "node_modules".into(),
            ".git".into(),
            "target".into(),
            "dist".into(),
            "build".into(),
            ".next".into(),
            "__pycache__".into(),
            ".venv".into(),
            "venv".into(),
        ]
    });

    let extensions: Option<Vec<String>> = filters
        .file_extensions
        .as_ref()
        .map(|exts| exts.iter().map(|s| s.to_string()).collect());

    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .threads(
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(1)
                .min(8),
        );

    builder.build_parallel().run(|| {
        let files = &files;
        let exclude_dirs = &exclude_dirs;
        let extensions = &extensions;

        Box::new(move |entry| {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => return ignore::WalkState::Continue,
            };

            let path = entry.path();

            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if exclude_dirs.iter().any(|e| e == name) {
                        return ignore::WalkState::Skip;
                    }
                }
                return ignore::WalkState::Continue;
            }

            if !path.is_file() {
                return ignore::WalkState::Continue;
            }

            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let should_include = extensions
                    .as_ref()
                    .map(|exts| exts.iter().any(|e| e == ext || e == &format!(".{}", ext)))
                    .unwrap_or_else(|| {
                        ALL_LANGUAGES
                            .iter()
                            .any(|l| l.file_extensions.contains(&ext))
                    });

                if should_include {
                    files.lock().unwrap().push(path.to_path_buf());
                }
            }

            ignore::WalkState::Continue
        })
    });

    files.into_inner().unwrap()
}
