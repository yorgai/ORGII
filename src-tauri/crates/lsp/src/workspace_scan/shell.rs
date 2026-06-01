//! ShellCheck runner for Bash / Shell scripts.

use ignore::WalkBuilder;
use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::run_command_with_timeout;
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

/// Run ShellCheck on all `.sh` / `.bash` files in the workspace, or specific files.
pub fn run_shellcheck_workspace(
    workspace_path: &str,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let shell_extensions: std::collections::HashSet<&str> =
        ["sh", "bash", "zsh", "ksh"].iter().copied().collect();

    let shell_files = if let Some(fps) = file_paths {
        // Filter to shell files from the provided list
        let filtered: Vec<String> = fps
            .iter()
            .filter(|fp| {
                Path::new(fp)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| shell_extensions.contains(ext))
                    .unwrap_or(false)
            })
            .cloned()
            .collect();
        filtered
    } else {
        find_shell_files(workspace_path)
    };

    if shell_files.is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    log::info!(
        "[WorkspaceScan] Running ShellCheck on {} files{}",
        shell_files.len(),
        if file_paths.is_some() {
            " (scoped)"
        } else {
            ""
        }
    );

    // ShellCheck accepts multiple files at once
    let mut cmd = Command::new("shellcheck");
    cmd.args(["--format=json1"]);
    for file in &shell_files {
        cmd.arg(file);
    }
    cmd.current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    let files_scanned = shell_files.len() as u32;

    // ShellCheck exits non-zero when there are findings — expected
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(ToolRunOutput::new(vec![], files_scanned));
    }

    let results: Vec<ShellCheckDiagnostic> = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse ShellCheck output: {}", err))?;

    let diagnostics: Vec<WorkspaceDiagnostic> = results
        .into_iter()
        .map(|sc| {
            let file_path = if Path::new(&sc.file).is_absolute() {
                sc.file
            } else {
                Path::new(workspace_path)
                    .join(&sc.file)
                    .to_string_lossy()
                    .to_string()
            };

            let severity = match sc.level.as_str() {
                "error" => "error",
                "warning" => "warning",
                _ => "info",
            };

            WorkspaceDiagnostic {
                file_path,
                line: sc.line,
                column: sc.column,
                end_line: Some(sc.end_line),
                end_column: Some(sc.end_column),
                severity: severity.to_string(),
                message: sc.message,
                source: "shellcheck".to_string(),
                code: Some(format!("SC{}", sc.code)),
            }
        })
        .collect();

    log::info!(
        "[WorkspaceScan] ShellCheck found {} diagnostics in {} files",
        diagnostics.len(),
        files_scanned
    );
    Ok(ToolRunOutput::new(diagnostics, files_scanned))
}

/// Find .sh and .bash files using WalkBuilder (fast, respects .gitignore).
fn find_shell_files(workspace_path: &str) -> Vec<String> {
    let shell_extensions = ["sh", "bash", "zsh", "ksh"];
    let mut files = Vec::new();

    let walker = WalkBuilder::new(workspace_path)
        .hidden(true)
        .max_depth(Some(8))
        .follow_links(false)
        .build();

    for entry in walker.flatten() {
        if entry.file_type().is_none_or(|ft| !ft.is_file()) {
            continue;
        }
        if let Some(ext) = entry.path().extension().and_then(|ext| ext.to_str()) {
            if shell_extensions.contains(&ext) {
                files.push(entry.path().to_string_lossy().to_string());
            }
        }
    }

    files
}

#[derive(Debug, Clone, Deserialize)]
struct ShellCheckDiagnostic {
    file: String,
    line: u32,
    column: u32,
    #[serde(rename = "endLine")]
    end_line: u32,
    #[serde(rename = "endColumn")]
    end_column: u32,
    level: String,
    code: u32,
    message: String,
}
