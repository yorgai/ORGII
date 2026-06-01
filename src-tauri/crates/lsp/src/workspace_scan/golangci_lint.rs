//! golangci-lint runner for Go projects.

use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::run_command_with_timeout;
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

/// Run golangci-lint on the workspace.
/// Only runs if `go.mod` exists in the workspace root.
pub fn run_golangci_lint_workspace(workspace_path: &str) -> Result<ToolRunOutput, String> {
    let workspace = Path::new(workspace_path);

    if !workspace.join("go.mod").exists() {
        return Ok(ToolRunOutput::empty());
    }

    log::info!(
        "[WorkspaceScan] Running golangci-lint on: {}",
        workspace_path
    );

    let output = run_command_with_timeout(
        Command::new("golangci-lint")
            .args(["run", "--out-format", "json", "./..."])
            .current_dir(workspace_path),
    )?;

    // golangci-lint exits non-zero when there are issues — expected
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let result: GolangCIResult = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse golangci-lint output: {}", err))?;

    let issues = result.issues.unwrap_or_default();
    let diagnostics: Vec<WorkspaceDiagnostic> = issues
        .into_iter()
        .map(|issue| {
            let file_path = if Path::new(&issue.pos.filename).is_absolute() {
                issue.pos.filename
            } else {
                Path::new(workspace_path)
                    .join(&issue.pos.filename)
                    .to_string_lossy()
                    .to_string()
            };

            let severity = match issue.severity.as_deref() {
                Some("error") => "error",
                _ => "warning",
            };

            WorkspaceDiagnostic {
                file_path,
                line: issue.pos.line,
                column: issue.pos.column.unwrap_or(1),
                end_line: None,
                end_column: None,
                severity: severity.to_string(),
                message: issue.text,
                source: "golangci-lint".to_string(),
                code: Some(issue.from_linter),
            }
        })
        .collect();

    log::info!(
        "[WorkspaceScan] golangci-lint found {} diagnostics",
        diagnostics.len()
    );
    Ok(ToolRunOutput::from_diagnostics(diagnostics))
}

#[derive(Debug, Clone, Deserialize)]
struct GolangCIResult {
    #[serde(rename = "Issues")]
    issues: Option<Vec<GolangCIIssue>>,
}

#[derive(Debug, Clone, Deserialize)]
struct GolangCIIssue {
    #[serde(rename = "FromLinter")]
    from_linter: String,
    #[serde(rename = "Text")]
    text: String,
    #[serde(rename = "Severity")]
    severity: Option<String>,
    #[serde(rename = "Pos")]
    pos: GolangCIPos,
}

#[derive(Debug, Clone, Deserialize)]
struct GolangCIPos {
    #[serde(rename = "Filename")]
    filename: String,
    #[serde(rename = "Line")]
    line: u32,
    #[serde(rename = "Column")]
    column: Option<u32>,
}
