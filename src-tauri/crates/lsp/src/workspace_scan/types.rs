//! Shared types for the workspace lint scanner.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// A single diagnostic from a workspace scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiagnostic {
    pub file_path: String,
    pub line: u32,
    pub column: u32,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
    pub severity: String, // "error" | "warning" | "info"
    pub message: String,
    pub source: String,
    pub code: Option<String>,
}

/// Internal return type from tool runners — diagnostics + file count.
pub struct ToolRunOutput {
    pub diagnostics: Vec<WorkspaceDiagnostic>,
    pub files_scanned: u32,
}

impl ToolRunOutput {
    /// Build from diagnostics, counting unique file paths as files_scanned.
    /// Use when the tool only reports files with issues.
    pub fn from_diagnostics(diagnostics: Vec<WorkspaceDiagnostic>) -> Self {
        let files_scanned = diagnostics
            .iter()
            .map(|d| d.file_path.as_str())
            .collect::<HashSet<_>>()
            .len() as u32;
        Self {
            diagnostics,
            files_scanned,
        }
    }

    /// Build with an explicit file count (more accurate — includes clean files).
    pub fn new(diagnostics: Vec<WorkspaceDiagnostic>, files_scanned: u32) -> Self {
        Self {
            diagnostics,
            files_scanned,
        }
    }

    /// Empty result (no files, no diagnostics).
    pub fn empty() -> Self {
        Self {
            diagnostics: vec![],
            files_scanned: 0,
        }
    }
}

/// Result of running a single lint tool (sent to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleToolResult {
    pub tool: String,
    pub diagnostics: Vec<WorkspaceDiagnostic>,
    pub files_scanned: u32,
    pub error: Option<String>,
}

/// Info about an available lint tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableTool {
    pub name: String,
    pub enabled: bool,
    pub installed: bool,
}
