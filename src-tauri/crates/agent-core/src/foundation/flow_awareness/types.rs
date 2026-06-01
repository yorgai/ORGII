//! Flow Awareness type definitions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Maximum characters to store for content previews (clipboard, search query).
pub const MAX_PREVIEW_CHARS: usize = 200;

/// Types of user activities tracked by the flow awareness system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActivityType {
    /// File was edited (created, modified, deleted, renamed).
    FileEdit {
        path: String,
        edit_type: FileEditType,
        /// Lines changed (approximate, for context weight).
        lines_changed: Option<u32>,
    },

    /// User opened or focused a file.
    FileOpen { path: String },

    /// Terminal command was executed.
    TerminalCommand {
        command: String,
        working_dir: Option<String>,
        /// Exit code if completed.
        exit_code: Option<i32>,
    },

    /// Search was performed.
    Search {
        query: String,
        scope: SearchScope,
        /// Number of results found.
        result_count: Option<u32>,
    },

    /// Clipboard activity.
    Clipboard {
        operation: ClipboardOp,
        /// Preview of content (truncated).
        content_preview: Option<String>,
        /// Source file if from editor.
        source_file: Option<String>,
    },

    /// Git operation was performed.
    GitOperation {
        operation: GitOpType,
        /// Branch name, commit message, etc.
        details: Option<String>,
    },

    /// Navigation event (tab switch, panel focus).
    Navigation {
        target: NavigationTarget,
        /// Additional context (file path, panel name).
        details: Option<String>,
    },

    /// Error encountered (build error, test failure, lint error).
    Error {
        error_type: ErrorType,
        message: String,
        /// File associated with error.
        file_path: Option<String>,
        /// Line number if applicable.
        line: Option<u32>,
    },

    /// Debug action (breakpoint set, step, inspect).
    Debug {
        action: DebugAction,
        file_path: Option<String>,
        line: Option<u32>,
    },
}

/// File edit types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileEditType {
    Create,
    Modify,
    Delete,
    Rename,
}

/// Search scope.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchScope {
    /// Global codebase search.
    Codebase,
    /// Search within current file.
    CurrentFile,
    /// Search in file names/paths.
    Files,
}

/// Clipboard operations.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardOp {
    Copy,
    Cut,
    Paste,
}

/// Git operation types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GitOpType {
    Commit,
    Push,
    Pull,
    Fetch,
    BranchSwitch,
    BranchCreate,
    Merge,
    Rebase,
    Stash,
    StashPop,
    Checkout,
    Diff,
    Status,
}

/// Navigation targets.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NavigationTarget {
    File,
    Tab,
    Panel,
    View,
    Definition,
    Reference,
    Symbol,
}

/// Error types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorType {
    Build,
    Test,
    Lint,
    TypeCheck,
    Runtime,
}

/// Debug actions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DebugAction {
    SetBreakpoint,
    RemoveBreakpoint,
    StepOver,
    StepInto,
    StepOut,
    Continue,
    Pause,
    InspectVariable,
}

/// A single recorded activity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    /// When the activity occurred.
    pub timestamp: DateTime<Utc>,
    /// The type and details of the activity.
    pub activity_type: ActivityType,
    /// Session ID if this activity is session-scoped.
    pub session_id: Option<String>,
}

impl Activity {
    /// Create a new activity with the current timestamp.
    pub fn new(activity_type: ActivityType, session_id: Option<String>) -> Self {
        Self {
            timestamp: Utc::now(),
            activity_type,
            session_id,
        }
    }

    // ===== Convenience constructors =====

    /// Record a file edit activity.
    pub fn file_edit(path: impl Into<String>, edit_type: FileEditType) -> Self {
        Self::new(
            ActivityType::FileEdit {
                path: path.into(),
                edit_type,
                lines_changed: None,
            },
            None,
        )
    }

    /// Record a file edit with line count.
    pub fn file_edit_with_lines(
        path: impl Into<String>,
        edit_type: FileEditType,
        lines: u32,
    ) -> Self {
        Self::new(
            ActivityType::FileEdit {
                path: path.into(),
                edit_type,
                lines_changed: Some(lines),
            },
            None,
        )
    }

    /// Record a file open activity.
    pub fn file_open(path: impl Into<String>) -> Self {
        Self::new(ActivityType::FileOpen { path: path.into() }, None)
    }

    /// Record a terminal command.
    pub fn terminal_command(
        command: impl Into<String>,
        working_dir: Option<impl Into<String>>,
        exit_code: Option<i32>,
    ) -> Self {
        Self::new(
            ActivityType::TerminalCommand {
                command: command.into(),
                working_dir: working_dir.map(Into::into),
                exit_code,
            },
            None,
        )
    }

    /// Record a search.
    pub fn search(query: impl Into<String>, scope: SearchScope) -> Self {
        Self::new(
            ActivityType::Search {
                query: query.into(),
                scope,
                result_count: None,
            },
            None,
        )
    }

    /// Record a clipboard operation.
    pub fn clipboard(
        operation: ClipboardOp,
        content_preview: Option<impl Into<String>>,
        source_file: Option<impl Into<String>>,
    ) -> Self {
        let preview = content_preview.map(|s| {
            let s = s.into();
            if s.len() > MAX_PREVIEW_CHARS {
                format!("{}...", &s[..MAX_PREVIEW_CHARS])
            } else {
                s
            }
        });
        Self::new(
            ActivityType::Clipboard {
                operation,
                content_preview: preview,
                source_file: source_file.map(Into::into),
            },
            None,
        )
    }

    /// Record a git operation.
    pub fn git_operation(operation: GitOpType, details: Option<impl Into<String>>) -> Self {
        Self::new(
            ActivityType::GitOperation {
                operation,
                details: details.map(Into::into),
            },
            None,
        )
    }

    /// Record an error.
    pub fn error(
        error_type: ErrorType,
        message: impl Into<String>,
        file_path: Option<impl Into<String>>,
        line: Option<u32>,
    ) -> Self {
        Self::new(
            ActivityType::Error {
                error_type,
                message: message.into(),
                file_path: file_path.map(Into::into),
                line,
            },
            None,
        )
    }

    /// Record a navigation event.
    pub fn navigation(target: NavigationTarget, details: Option<impl Into<String>>) -> Self {
        Self::new(
            ActivityType::Navigation {
                target,
                details: details.map(Into::into),
            },
            None,
        )
    }

    /// Record a debug action.
    pub fn debug(
        action: DebugAction,
        file_path: Option<impl Into<String>>,
        line: Option<u32>,
    ) -> Self {
        Self::new(
            ActivityType::Debug {
                action,
                file_path: file_path.map(Into::into),
                line,
            },
            None,
        )
    }

    /// Associate this activity with a session.
    pub fn with_session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }
}

/// Inferred user intent based on activity patterns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InferredIntent {
    /// User is debugging (breakpoints, errors, stepping).
    Debugging,
    /// User is refactoring (renames, multi-file edits).
    Refactoring,
    /// User is exploring the codebase (searches, navigation).
    Exploring,
    /// User is writing new code (file creates, many edits to few files).
    Writing,
    /// User is reviewing code (many file opens, few edits).
    Reviewing,
    /// User is running tests/builds (terminal commands, error handling).
    Testing,
    /// User is doing git operations (commits, branches).
    VersionControl,
    /// Unknown or mixed activity.
    Unknown,
}

/// Summary of recent user activity for context injection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FlowSummary {
    /// Inferred current intent.
    pub intent: Option<InferredIntent>,
    /// Most recently edited files.
    pub recent_edits: Vec<String>,
    /// Most recently opened files.
    pub recent_opens: Vec<String>,
    /// Recent terminal commands.
    pub recent_commands: Vec<String>,
    /// Recent search queries.
    pub recent_searches: Vec<String>,
    /// Current error context (if debugging).
    pub current_errors: Vec<String>,
    /// Time since last activity (seconds).
    pub idle_seconds: Option<u64>,
}
