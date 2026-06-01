//! ESLint runner and target discovery.

use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::run_command_with_timeout;
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

// ============================================
// Runner
// ============================================

/// Run ESLint on the workspace, a specific subdirectory, or specific files.
pub fn run_eslint_workspace(
    workspace_path: &str,
    target_dir: Option<&str>,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let workspace = Path::new(workspace_path);

    // Find ESLint in node_modules
    let eslint_path = workspace.join("node_modules").join(".bin").join("eslint");

    let eslint_cmd = if eslint_path.exists() {
        eslint_path.to_string_lossy().to_string()
    } else {
        "eslint".to_string()
    };

    // Filter file_paths to JS/TS extensions ESLint handles
    let js_extensions: std::collections::HashSet<&str> = JS_TS_EXTENSIONS.iter().copied().collect();
    let scoped_files: Option<Vec<&str>> = file_paths.map(|fps| {
        fps.iter()
            .filter(|fp| {
                Path::new(fp)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| js_extensions.contains(ext))
                    .unwrap_or(false)
            })
            .map(|s| s.as_str())
            .collect()
    });

    // If scoped but no matching files, return empty
    if let Some(ref files) = scoped_files {
        if files.is_empty() {
            return Ok(ToolRunOutput::empty());
        }
    }

    let mut cmd = Command::new(&eslint_cmd);

    if let Some(ref files) = scoped_files {
        // Scope mode: pass individual files
        log::info!(
            "[WorkspaceScan] Running ESLint on {} specific files",
            files.len()
        );
        cmd.args(files.iter());
    } else {
        // Directory mode: lint a target dir or entire workspace
        let lint_target = target_dir.unwrap_or(".");
        log::info!(
            "[WorkspaceScan] Running ESLint on: {} (target: {})",
            workspace_path,
            lint_target
        );
        cmd.arg(lint_target)
            .args(["--ext", ".js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte"]);
    }

    cmd.args([
        "--format",
        "json",
        "--no-error-on-unmatched-pattern",
        "--cache",
    ])
    .current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    // Parse ESLint JSON output — each element is one file (even with 0 issues)
    let results: Vec<EslintFileResult> = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse ESLint output: {}", err))?;

    let files_scanned = results.len() as u32;
    let mut diagnostics = Vec::new();
    for result in results {
        for msg in result.messages {
            diagnostics.push(WorkspaceDiagnostic {
                file_path: result.file_path.clone(),
                line: msg.line,
                column: msg.column,
                end_line: msg.end_line,
                end_column: msg.end_column,
                severity: if msg.severity >= 2 {
                    "error"
                } else {
                    "warning"
                }
                .to_string(),
                message: msg.message,
                source: "eslint".to_string(),
                code: msg.rule_id,
            });
        }
    }

    log::info!(
        "[WorkspaceScan] ESLint found {} diagnostics in {} files",
        diagnostics.len(),
        files_scanned
    );
    Ok(ToolRunOutput::new(diagnostics, files_scanned))
}

// ============================================
// JSON output structures
// ============================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintFileResult {
    file_path: String,
    messages: Vec<EslintMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EslintMessage {
    line: u32,
    column: u32,
    end_line: Option<u32>,
    end_column: Option<u32>,
    severity: u32,
    message: String,
    rule_id: Option<String>,
}

// ============================================
// Target discovery (per-directory chunking)
// ============================================

/// JS/TS extensions that ESLint would lint.
const JS_TS_EXTENSIONS: &[&str] = &["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte"];

/// Directories to skip when scanning for lintable source files.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__",
    ".venv",
    "vendor",
    "coverage",
    ".cache",
];

/// Return a list of non-overlapping subdirectories to run ESLint on
/// separately, so results stream in per-directory instead of one huge batch.
///
/// Strategy: take the immediate children of the workspace root.
/// For any child that itself has lintable subdirectories (e.g. `src/`),
/// expand one level deeper so `src/components`, `src/hooks`, etc. are
/// separate targets. Any root-level lintable files are covered by a `"."` chunk.
pub fn get_eslint_targets(workspace_path: &str) -> Result<Vec<String>, String> {
    let root = Path::new(workspace_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", workspace_path));
    }

    let skip: std::collections::HashSet<&str> = SKIP_DIRS.iter().copied().collect();
    let mut targets = Vec::new();

    // Check if root itself has lintable files (e.g. eslint.config.mjs)
    if has_js_files_direct(root) {
        targets.push(".".to_string());
    }

    let entries =
        std::fs::read_dir(root).map_err(|err| format!("Cannot read workspace root: {}", err))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if skip.contains(name) || name.starts_with('.') {
            continue;
        }

        let has_js = has_js_files_direct(&path);
        let sub_dirs = lintable_subdirs(&path, &skip);

        if !sub_dirs.is_empty() {
            // Expand: use child subdirectories as individual targets
            for sub in &sub_dirs {
                let rel = sub
                    .strip_prefix(root)
                    .unwrap_or(sub)
                    .to_string_lossy()
                    .to_string();
                targets.push(rel);
            }
            // Also add the directory itself if it has direct JS files
            if has_js {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                if !targets.iter().any(|existing| existing.starts_with(&rel)) {
                    targets.push(rel);
                }
            }
        } else if has_js {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            targets.push(rel);
        }
    }

    log::info!(
        "[WorkspaceScan] ESLint targets ({}): {:?}",
        targets.len(),
        targets
    );

    Ok(targets)
}

// ============================================
// Helpers
// ============================================

/// Check if a directory directly contains at least one JS/TS file (non-recursive).
fn has_js_files_direct(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if JS_TS_EXTENSIONS.contains(&ext) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Return immediate subdirectories that contain JS/TS files (direct or nested).
fn lintable_subdirs(
    parent: &Path,
    skip: &std::collections::HashSet<&str>,
) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if skip.contains(name) || name.starts_with('.') {
                continue;
            }
            if dir_contains_js_recursive(&path, skip, 0, 3) {
                result.push(path);
            }
        }
    }
    result
}

/// Recursively check (up to `max_depth`) if a directory tree has any JS/TS file.
fn dir_contains_js_recursive(
    dir: &Path,
    skip: &std::collections::HashSet<&str>,
    depth: usize,
    max_depth: usize,
) -> bool {
    if depth > max_depth {
        return false;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if JS_TS_EXTENSIONS.contains(&ext) {
                        return true;
                    }
                }
            } else if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !skip.contains(name)
                    && !name.starts_with('.')
                    && dir_contains_js_recursive(&path, skip, depth + 1, max_depth)
                {
                    return true;
                }
            }
        }
    }
    false
}
