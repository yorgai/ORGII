//! ESLint Integration
//!
//! Runs ESLint on files and parses the JSON output to provide diagnostics.
//! This supplements the TypeScript LSP which doesn't report ESLint/Prettier errors.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// ESLint diagnostic from JSON output
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintMessage {
    pub line: u32,
    pub column: u32,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
    pub severity: u32, // 1 = warning, 2 = error
    pub message: String,
    pub rule_id: Option<String>,
}

/// ESLint file result from JSON output
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintFileResult {
    pub file_path: String,
    pub messages: Vec<EslintMessage>,
    pub error_count: u32,
    pub warning_count: u32,
}

/// Converted diagnostic for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EslintDiagnostic {
    pub line: u32,
    pub column: u32,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
    pub severity: String, // "error" | "warning"
    pub message: String,
    pub source: String,
    pub code: Option<String>,
}

/// Run ESLint on a file and return diagnostics
pub fn run_eslint(file_path: &str) -> Result<Vec<EslintDiagnostic>, String> {
    let path = Path::new(file_path);

    // Check if file exists
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Try to find ESLint in common locations
    let eslint_cmd = find_eslint(path)?;

    log::info!("[ESLint] Running on: {}", file_path);

    // Run ESLint with JSON format
    let mut command = Command::new(&eslint_cmd);
    command
        .args([
            "--format",
            "json",
            "--no-error-on-unmatched-pattern",
            file_path,
        ])
        .current_dir(path.parent().unwrap_or(Path::new("/")));
    // Suppress console window on Windows.
    app_platform::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|e| format!("Failed to run ESLint: {}", e))?;

    // ESLint returns exit code 1 for lint errors, which is expected
    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.trim().is_empty() {
        // No output means no ESLint config or issues
        log::debug!("[ESLint] No output for: {}", file_path);
        return Ok(vec![]);
    }

    // Parse JSON output
    let results: Vec<EslintFileResult> = serde_json::from_str(&stdout).map_err(|e| {
        log::warn!(
            "[ESLint] Failed to parse output: {} - stdout: {}",
            e,
            stdout
        );
        format!("Failed to parse ESLint output: {}", e)
    })?;

    // Convert to our diagnostic format
    let diagnostics: Vec<EslintDiagnostic> = results
        .into_iter()
        .flat_map(|result| {
            result.messages.into_iter().map(|msg| EslintDiagnostic {
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
            })
        })
        .collect();

    log::info!(
        "[ESLint] Found {} diagnostics for: {}",
        diagnostics.len(),
        file_path
    );
    Ok(diagnostics)
}

/// Run ESLint on content (via stdin) - useful for unsaved files
pub fn run_eslint_on_content(
    content: &str,
    file_path: &str,
) -> Result<Vec<EslintDiagnostic>, String> {
    let path = Path::new(file_path);

    // Find the workspace root (where node_modules/.bin/eslint is)
    let (eslint_path, workspace_root) = find_eslint_with_root(path)?;

    log::info!(
        "[ESLint] Running on content for: {} (cwd: {:?})",
        file_path,
        workspace_root
    );
    log::debug!("[ESLint] Using eslint at: {}", eslint_path);

    // Run ESLint with stdin and filename hint
    let mut command = Command::new(&eslint_path);
    command
        .args([
            "--format",
            "json",
            "--stdin",
            "--stdin-filename",
            file_path,
            "--no-error-on-unmatched-pattern",
        ])
        .current_dir(&workspace_root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Suppress console window on Windows.
    app_platform::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn ESLint: {}", e))?;

    // Write content to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write to ESLint stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for ESLint: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Log stderr if there's any error output
    if !stderr.trim().is_empty() {
        log::warn!("[ESLint] stderr: {}", stderr);
    }

    log::debug!("[ESLint] stdout: {}", stdout);

    if stdout.trim().is_empty() {
        log::debug!("[ESLint] No output - file might be clean or no ESLint config");
        return Ok(vec![]);
    }

    // Parse JSON output
    let results: Vec<EslintFileResult> = serde_json::from_str(&stdout).map_err(|e| {
        log::error!("[ESLint] Failed to parse JSON: {} - stdout: {}", e, stdout);
        format!("Failed to parse ESLint output: {}", e)
    })?;

    let diagnostics: Vec<EslintDiagnostic> = results
        .into_iter()
        .flat_map(|result| {
            result.messages.into_iter().map(|msg| EslintDiagnostic {
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
            })
        })
        .collect();

    log::info!(
        "[ESLint] Found {} diagnostics for content",
        diagnostics.len()
    );
    Ok(diagnostics)
}

/// Check if ESLint is available
pub fn is_eslint_available(workspace_path: &str) -> bool {
    find_eslint(Path::new(workspace_path)).is_ok()
}

/// Find ESLint executable - checks local node_modules first, then global
fn find_eslint(file_path: &Path) -> Result<String, String> {
    let (eslint_path, _) = find_eslint_with_root(file_path)?;
    Ok(eslint_path)
}

/// Find ESLint executable and return both the path and the workspace root directory
fn find_eslint_with_root(file_path: &Path) -> Result<(String, std::path::PathBuf), String> {
    // Start from file's directory and walk up looking for node_modules/.bin/eslint
    let mut current = file_path.parent();

    while let Some(dir) = current {
        let local_eslint = dir.join("node_modules").join(".bin").join("eslint");
        log::debug!("[ESLint] Checking for: {:?}", local_eslint);
        if local_eslint.exists() {
            log::info!(
                "[ESLint] Found local: {:?} (workspace root: {:?})",
                local_eslint,
                dir
            );
            return Ok((
                local_eslint.to_string_lossy().to_string(),
                dir.to_path_buf(),
            ));
        }
        current = dir.parent();
    }

    // Try global eslint - use current directory as workspace root
    log::debug!("[ESLint] Checking for global eslint...");
    let mut version_check = Command::new("eslint");
    version_check.arg("--version");
    // Suppress console window on Windows.
    app_platform::hide_console(&mut version_check);
    if let Ok(output) = version_check.output() {
        if output.status.success() {
            log::info!("[ESLint] Found global eslint");
            // For global eslint, use file's parent or current dir
            let root = file_path.parent().unwrap_or(Path::new(".")).to_path_buf();
            return Ok(("eslint".to_string(), root));
        }
    }

    // Note: We don't use npx because it requires special handling
    // and is much slower than direct eslint

    log::warn!("[ESLint] ESLint not found in node_modules or globally");
    Err("ESLint not found. Install with: npm install -D eslint".to_string())
}

/// Get ESLint version info
pub fn get_eslint_version(workspace_path: &str) -> Option<String> {
    let eslint_cmd = find_eslint(Path::new(workspace_path)).ok()?;

    let mut command = Command::new(&eslint_cmd);
    command.arg("--version");
    // Suppress console window on Windows.
    app_platform::hide_console(&mut command);
    let output = command.output().ok()?;

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
#[path = "tests/eslint_tests.rs"]
mod tests;
