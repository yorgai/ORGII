//! Python lint tool runners — Ruff, Pylint, Flake8, and Mypy.

use serde::Deserialize;
use std::path::Path;
use std::process::Command;

use super::process::run_command_with_timeout;
use super::types::{ToolRunOutput, WorkspaceDiagnostic};

/// Python file extensions for scoped filtering.
const PY_EXTENSIONS: &[&str] = &["py", "pyi", "pyw"];

/// Filter file_paths to only Python files. Returns None if no Python files match.
fn filter_python_files(file_paths: Option<&[String]>) -> Option<Vec<String>> {
    let fps = file_paths?;
    let filtered: Vec<String> = fps
        .iter()
        .filter(|fp| {
            Path::new(fp)
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| PY_EXTENSIONS.contains(&ext))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    if filtered.is_empty() {
        None
    } else {
        Some(filtered)
    }
}

// ============================================
// Ruff
// ============================================

/// Run Ruff on the workspace or specific files.
pub fn run_ruff_workspace(
    workspace_path: &str,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let py_files = filter_python_files(file_paths);

    // If scoped but no Python files, return empty
    if file_paths.is_some() && py_files.is_none() {
        return Ok(ToolRunOutput::empty());
    }

    let mut cmd = Command::new("ruff");
    cmd.args(["check", "--output-format", "json"]);

    if let Some(ref files) = py_files {
        log::info!(
            "[WorkspaceScan] Running Ruff on {} specific files",
            files.len()
        );
        cmd.args(files.iter().map(|s| s.as_str()));
    } else {
        log::info!("[WorkspaceScan] Running Ruff on: {}", workspace_path);
        cmd.arg(".");
    }

    cmd.current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let results: Vec<RuffDiagnostic> = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse Ruff output: {}", err))?;

    let diagnostics: Vec<WorkspaceDiagnostic> = results
        .into_iter()
        .map(|ruff_diag| {
            let file_path = if Path::new(&ruff_diag.filename).is_absolute() {
                ruff_diag.filename
            } else {
                Path::new(workspace_path)
                    .join(&ruff_diag.filename)
                    .to_string_lossy()
                    .to_string()
            };

            WorkspaceDiagnostic {
                file_path,
                line: ruff_diag.location.row,
                column: ruff_diag.location.column,
                end_line: Some(ruff_diag.end_location.row),
                end_column: Some(ruff_diag.end_location.column),
                severity: if ruff_diag.code.starts_with('E') || ruff_diag.code.starts_with('F') {
                    "error"
                } else {
                    "warning"
                }
                .to_string(),
                message: ruff_diag.message,
                source: "ruff".to_string(),
                code: Some(ruff_diag.code),
            }
        })
        .collect();

    log::info!(
        "[WorkspaceScan] Ruff found {} diagnostics",
        diagnostics.len()
    );
    Ok(ToolRunOutput::from_diagnostics(diagnostics))
}

#[derive(Debug, Clone, Deserialize)]
struct RuffDiagnostic {
    filename: String,
    code: String,
    message: String,
    location: RuffLocation,
    end_location: RuffLocation,
}

#[derive(Debug, Clone, Deserialize)]
struct RuffLocation {
    row: u32,
    column: u32,
}

// ============================================
// Pylint
// ============================================

/// Run Pylint on the workspace or specific files.
pub fn run_pylint_workspace(
    workspace_path: &str,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let py_files = filter_python_files(file_paths);

    if file_paths.is_some() && py_files.is_none() {
        return Ok(ToolRunOutput::empty());
    }

    let mut cmd = Command::new("pylint");
    cmd.arg("--output-format=json");

    if let Some(ref files) = py_files {
        log::info!(
            "[WorkspaceScan] Running Pylint on {} specific files",
            files.len()
        );
        cmd.args(files.iter().map(|s| s.as_str()));
    } else {
        log::info!("[WorkspaceScan] Running Pylint on: {}", workspace_path);
        cmd.args(["--recursive=y", "."]);
    }

    cmd.current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let results: Vec<PylintDiagnostic> = serde_json::from_str(&stdout)
        .map_err(|err| format!("Failed to parse Pylint output: {}", err))?;

    let diagnostics: Vec<WorkspaceDiagnostic> = results
        .into_iter()
        .map(|pylint_diag| {
            let file_path = if Path::new(&pylint_diag.path).is_absolute() {
                pylint_diag.path
            } else {
                Path::new(workspace_path)
                    .join(&pylint_diag.path)
                    .to_string_lossy()
                    .to_string()
            };

            let severity = match pylint_diag.msg_type.as_str() {
                "error" | "fatal" => "error",
                "warning" => "warning",
                _ => "info",
            };

            WorkspaceDiagnostic {
                file_path,
                line: pylint_diag.line,
                column: pylint_diag.column,
                end_line: pylint_diag.end_line,
                end_column: pylint_diag.end_column,
                severity: severity.to_string(),
                message: pylint_diag.message,
                source: "pylint".to_string(),
                code: Some(pylint_diag.message_id),
            }
        })
        .collect();

    log::info!(
        "[WorkspaceScan] Pylint found {} diagnostics",
        diagnostics.len()
    );
    Ok(ToolRunOutput::from_diagnostics(diagnostics))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct PylintDiagnostic {
    path: String,
    line: u32,
    column: u32,
    #[serde(default)]
    end_line: Option<u32>,
    #[serde(default)]
    end_column: Option<u32>,
    #[serde(rename = "type")]
    msg_type: String,
    message: String,
    #[serde(rename = "message-id")]
    message_id: String,
}

// ============================================
// Flake8
// ============================================

/// Run Flake8 on the workspace or specific files.
pub fn run_flake8_workspace(
    workspace_path: &str,
    file_paths: Option<&[String]>,
) -> Result<ToolRunOutput, String> {
    let py_files = filter_python_files(file_paths);

    if file_paths.is_some() && py_files.is_none() {
        return Ok(ToolRunOutput::empty());
    }

    let mut cmd = Command::new("flake8");
    cmd.arg("--format=%(path)s:%(row)d:%(col)d: %(code)s %(text)s");

    if let Some(ref files) = py_files {
        log::info!(
            "[WorkspaceScan] Running Flake8 on {} specific files",
            files.len()
        );
        cmd.args(files.iter().map(|s| s.as_str()));
    } else {
        log::info!("[WorkspaceScan] Running Flake8 on: {}", workspace_path);
        cmd.arg(".");
    }

    cmd.current_dir(workspace_path);

    let output = run_command_with_timeout(&mut cmd)?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let mut diagnostics = Vec::new();

    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(diag) = parse_flake8_line(line, workspace_path) {
            diagnostics.push(diag);
        }
    }

    log::info!(
        "[WorkspaceScan] Flake8 found {} diagnostics",
        diagnostics.len()
    );
    Ok(ToolRunOutput::from_diagnostics(diagnostics))
}

/// Parse a single Flake8 output line.
fn parse_flake8_line(line: &str, workspace_path: &str) -> Option<WorkspaceDiagnostic> {
    let parts: Vec<&str> = line.splitn(4, ':').collect();
    if parts.len() < 4 {
        return None;
    }

    let file = parts[0].trim();
    let line_num: u32 = parts[1].trim().parse().ok()?;
    let column: u32 = parts[2].trim().parse().ok()?;
    let rest = parts[3].trim();

    let (code, message) = if let Some(space_idx) = rest.find(' ') {
        (
            rest[..space_idx].to_string(),
            rest[space_idx + 1..].to_string(),
        )
    } else {
        (rest.to_string(), rest.to_string())
    };

    let file_path = if Path::new(file).is_absolute() {
        file.to_string()
    } else {
        Path::new(workspace_path)
            .join(file)
            .to_string_lossy()
            .to_string()
    };

    let severity = if code.starts_with('E') || code.starts_with('F') {
        "error"
    } else {
        "warning"
    };

    Some(WorkspaceDiagnostic {
        file_path,
        line: line_num,
        column,
        end_line: None,
        end_column: None,
        severity: severity.to_string(),
        message,
        source: "flake8".to_string(),
        code: Some(code),
    })
}

// ============================================
// Mypy (Python type checker)
// ============================================

/// Run Mypy on the workspace.
pub fn run_mypy_workspace(workspace_path: &str) -> Result<ToolRunOutput, String> {
    log::info!("[WorkspaceScan] Running Mypy on: {}", workspace_path);

    let output = run_command_with_timeout(
        Command::new("mypy")
            .args([".", "--no-error-summary", "--no-color-output"])
            .current_dir(workspace_path),
    )?;

    // Mypy exits non-zero when there are errors — expected
    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Ok(ToolRunOutput::empty());
    }

    let mut diagnostics = Vec::new();

    // Format: file.py:line: error: message  [error-code]
    // Or:     file.py:line:col: error: message  [error-code]
    for line in stdout.lines() {
        if let Some(diag) = parse_mypy_line(line, workspace_path) {
            diagnostics.push(diag);
        }
    }

    log::info!(
        "[WorkspaceScan] Mypy found {} diagnostics",
        diagnostics.len()
    );
    Ok(ToolRunOutput::from_diagnostics(diagnostics))
}

/// Parse a single Mypy output line.
fn parse_mypy_line(line: &str, workspace_path: &str) -> Option<WorkspaceDiagnostic> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("Found ") || line.starts_with("Success") {
        return None;
    }

    // Split on ": " to find the severity marker
    // file.py:10: error: message  [code]
    // file.py:10:5: error: message  [code]
    let parts: Vec<&str> = line.splitn(2, ": error: ").collect();
    let (location, severity, message_part) = if parts.len() == 2 {
        (parts[0], "error", parts[1])
    } else {
        let parts: Vec<&str> = line.splitn(2, ": warning: ").collect();
        if parts.len() == 2 {
            (parts[0], "warning", parts[1])
        } else {
            let parts: Vec<&str> = line.splitn(2, ": note: ").collect();
            if parts.len() == 2 {
                (parts[0], "info", parts[1])
            } else {
                return None;
            }
        }
    };

    // Parse location: file.py:line or file.py:line:col
    let loc_parts: Vec<&str> = location.rsplitn(3, ':').collect();
    let (file, line_num, column) = match loc_parts.len() {
        2 => {
            let line_num: u32 = loc_parts[0].trim().parse().ok()?;
            (loc_parts[1], line_num, 1u32)
        }
        3 => {
            let col: u32 = loc_parts[0].trim().parse().ok()?;
            let line_num: u32 = loc_parts[1].trim().parse().ok()?;
            (loc_parts[2], line_num, col)
        }
        _ => return None,
    };

    // Extract [code] from end of message
    let (message, code) = if let Some(bracket_start) = message_part.rfind("  [") {
        let code_end = message_part.len() - 1; // strip trailing ']'
        if message_part.ends_with(']') {
            (
                message_part[..bracket_start].to_string(),
                Some(message_part[bracket_start + 3..code_end].to_string()),
            )
        } else {
            (message_part.to_string(), None)
        }
    } else {
        (message_part.to_string(), None)
    };

    let file_path = if Path::new(file).is_absolute() {
        file.to_string()
    } else {
        Path::new(workspace_path)
            .join(file)
            .to_string_lossy()
            .to_string()
    };

    Some(WorkspaceDiagnostic {
        file_path,
        line: line_num,
        column,
        end_line: None,
        end_column: None,
        severity: severity.to_string(),
        message,
        source: "mypy".to_string(),
        code,
    })
}
