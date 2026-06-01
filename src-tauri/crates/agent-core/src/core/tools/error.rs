//! Tool execution error type.

use std::fmt;

/// Error type for tool execution.
#[derive(Debug)]
pub enum ToolError {
    /// Invalid parameters provided to the tool.
    InvalidParams(String),
    /// Tool execution failed.
    ExecutionFailed(String),
    /// Permission denied (e.g., workspace restriction).
    PermissionDenied(String),
    /// Operation timed out.
    Timeout(String),
}

impl fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ToolError::InvalidParams(msg) => write!(formatter, "Invalid parameters: {}", msg),
            ToolError::ExecutionFailed(msg) => write!(formatter, "Execution failed: {}", msg),
            ToolError::PermissionDenied(msg) => write!(formatter, "Permission denied: {}", msg),
            ToolError::Timeout(msg) => write!(formatter, "Timeout: {}", msg),
        }
    }
}

impl std::error::Error for ToolError {}
