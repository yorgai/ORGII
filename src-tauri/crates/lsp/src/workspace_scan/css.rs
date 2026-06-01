//! Stylelint runner for CSS / SCSS / Less.

use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::run_command_with_timeout;
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

const CSS_EXTENSIONS: &[&str] = &["css", "scss", "less", "sass"];

/// Run Stylelint on the workspace or specific files.
pub fn run_stylelint_workspace(
    workspace_path: &str,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let workspace = Path::new(workspace_path);

    // Prefer local stylelint
    let bin = workspace
        .join("node_modules")
        .join(".bin")
        .join("stylelint");
    let stylelint_cmd = if bin.exists() {
        bin.to_string_lossy().to_string()
    } else {
        "stylelint".to_string()
    };

    // Filter to CSS files if scoped
    let css_files: Option<Vec<&str>> = file_paths.map(|fps| {
        fps.iter()
            .filter(|fp| {
                Path::new(fp)
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| CSS_EXTENSIONS.contains(&ext))
                    .unwrap_or(false)
            })
            .map(|s| s.as_str())
            .collect()
    });

    if let Some(ref files) = css_files {
        if files.is_empty() {
            return Ok(ToolRunOutput::empty());
        }
    }

    let mut cmd = Command::new(&stylelint_cmd);

    if let Some(ref files) = css_files {
        log::info!(
            "[WorkspaceScan] Running Stylelint on {} specific files",
            files.len()
        );
        cmd.args(files.iter());
    } else {
        log::info!("[WorkspaceScan] Running Stylelint on: {}", workspace_path);
        cmd.arg("**/*.{css,scss,less}");
    }

    cmd.args(["--formatter", "json", "--allow-empty-input"])
        .current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    // Stylelint exits non-zero when there are warnings/errors — expected
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() || stdout.trim() == "[]" {
        return Ok(ToolRunOutput::empty());
    }

    let results: Vec<StylelintResult> = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse Stylelint output: {}", err))?;

    let files_scanned = results.len() as u32;
    let mut diagnostics = Vec::new();
    for result in results {
        for warning in result.warnings {
            let file_path = if Path::new(&result.source).is_absolute() {
                result.source.clone()
            } else {
                Path::new(workspace_path)
                    .join(&result.source)
                    .to_string_lossy()
                    .to_string()
            };

            diagnostics.push(WorkspaceDiagnostic {
                file_path,
                line: warning.line,
                column: warning.column,
                end_line: None,
                end_column: None,
                severity: warning.severity.clone(),
                message: warning.text.clone(),
                source: "stylelint".to_string(),
                code: Some(warning.rule),
            });
        }
    }

    log::info!(
        "[WorkspaceScan] Stylelint found {} diagnostics in {} files",
        diagnostics.len(),
        files_scanned
    );
    Ok(ToolRunOutput::new(diagnostics, files_scanned))
}

#[derive(Debug, Clone, Deserialize)]
struct StylelintResult {
    source: String,
    warnings: Vec<StylelintWarning>,
}

#[derive(Debug, Clone, Deserialize)]
struct StylelintWarning {
    line: u32,
    column: u32,
    rule: String,
    severity: String,
    text: String,
}
