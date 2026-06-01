//! Rust runners — `cargo check` (fast) and `cargo clippy` (thorough).
//!
//! `run_cargo_check_workspace` is the fast path used by the "rust-analyzer"
//! tool when the LSP cache misses.  It runs `cargo check` which only does
//! type-checking (seconds, not minutes).
//!
//! `run_clippy_workspace` is the thorough path that also catches lint
//! warnings from Clippy.

use ignore::WalkBuilder;
use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::{run_command_with_custom_timeout, COMPILE_TIMEOUT_SECS};
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

// ============================================
// Runners
// ============================================

/// Run `cargo check` on every Rust project found in the workspace.
/// Much faster than Clippy — only type-checks, no lint warnings.
/// Used as fallback when rust-analyzer LSP cache is unavailable.
pub fn run_cargo_check_workspace(workspace_path: &str) -> Result<ToolRunOutput, String> {
    run_cargo_tool(workspace_path, "check", "rust-analyzer")
}

/// Run `cargo clippy` on every Rust project found in the workspace.
/// Thorough but slow — includes type errors AND lint warnings.
pub fn run_clippy_workspace(workspace_path: &str) -> Result<ToolRunOutput, String> {
    run_cargo_tool(workspace_path, "clippy", "clippy")
}

/// Shared runner: executes `cargo <subcommand>` with JSON message output
/// on every Cargo project in the workspace.
fn run_cargo_tool(
    workspace_path: &str,
    subcommand: &str,
    source_label: &str,
) -> Result<ToolRunOutput, String> {
    let cargo_dirs = find_cargo_dirs(workspace_path);
    if cargo_dirs.is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let mut all_diagnostics = Vec::new();

    for cargo_dir in &cargo_dirs {
        let dir_str = cargo_dir.to_string_lossy();
        log::info!(
            "[WorkspaceScan] Running cargo {} on: {}",
            subcommand,
            dir_str
        );

        let output = run_command_with_custom_timeout(
            Command::new("cargo")
                .args([subcommand, "--message-format", "json", "--quiet"])
                .current_dir(cargo_dir),
            COMPILE_TIMEOUT_SECS,
        )
        .map_err(|err| format!("cargo {} in {}: {}", subcommand, dir_str, err))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        for line in stdout.lines() {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(msg) = serde_json::from_str::<CargoMessage>(line) {
                if msg.reason == "compiler-message" {
                    if let Some(compiler_msg) = msg.message {
                        let severity = match compiler_msg.level.as_str() {
                            "error" => "error",
                            "warning" => "warning",
                            _ => continue,
                        };

                        if let Some(spans) = compiler_msg.spans {
                            for span in &spans {
                                if !span.is_primary {
                                    continue;
                                }
                                let file_path = if Path::new(&span.file_name).is_absolute() {
                                    span.file_name.clone()
                                } else {
                                    cargo_dir
                                        .join(&span.file_name)
                                        .to_string_lossy()
                                        .to_string()
                                };

                                all_diagnostics.push(WorkspaceDiagnostic {
                                    file_path,
                                    line: span.line_start,
                                    column: span.column_start,
                                    end_line: Some(span.line_end),
                                    end_column: Some(span.column_end),
                                    severity: severity.to_string(),
                                    message: compiler_msg.message.clone(),
                                    source: source_label.to_string(),
                                    code: compiler_msg.code.as_ref().map(|code| code.code.clone()),
                                });
                            }
                        }
                    }
                }
            }
        }

        log::info!(
            "[WorkspaceScan] cargo {} found {} diagnostics in {}",
            subcommand,
            all_diagnostics.len(),
            dir_str
        );
    }

    Ok(ToolRunOutput::from_diagnostics(all_diagnostics))
}

// ============================================
// Cargo.toml discovery
// ============================================

/// Find directories containing Cargo.toml using the `ignore` crate's WalkBuilder
/// (same fast walker used by our file search API — respects .gitignore, skips
/// target/node_modules automatically).
///
/// Deduplicates: if a parent dir has Cargo.toml, its children are skipped
/// because `cargo clippy` at a workspace root already covers members.
fn find_cargo_dirs(workspace_path: &str) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();

    let walker = WalkBuilder::new(workspace_path)
        .hidden(true) // skip dotfiles/dirs
        .max_depth(Some(6))
        .follow_links(false)
        .build();

    for entry in walker.flatten() {
        if entry.file_type().is_none_or(|ft| !ft.is_file()) {
            continue;
        }
        if entry.file_name() == "Cargo.toml" {
            if let Some(parent) = entry.path().parent() {
                dirs.push(parent.to_path_buf());
            }
        }
    }

    // Deduplicate: keep only root-level Cargo dirs
    dirs.sort();
    dirs.iter()
        .filter(|dir| {
            !dirs
                .iter()
                .any(|other| other != *dir && dir.starts_with(other))
        })
        .cloned()
        .collect()
}

// ============================================
// Cargo JSON output structures
// ============================================

#[derive(Debug, Clone, Deserialize)]
struct CargoMessage {
    reason: String,
    message: Option<CompilerMessage>,
}

#[derive(Debug, Clone, Deserialize)]
struct CompilerMessage {
    message: String,
    level: String,
    code: Option<DiagnosticCode>,
    spans: Option<Vec<CompilerSpan>>,
}

#[derive(Debug, Clone, Deserialize)]
struct DiagnosticCode {
    code: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CompilerSpan {
    file_name: String,
    line_start: u32,
    line_end: u32,
    column_start: u32,
    column_end: u32,
    is_primary: bool,
}
