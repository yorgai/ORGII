//! Flow Awareness Tauri commands — lives in agent_core so ALL agent types can use it.
//!
//! - `flow_record_activity` — record a user activity from the frontend
//! - `flow_record_activities` — batch record multiple activities
//! - `flow_get_context` — get formatted flow context for a session
//! - `flow_get_summary` — get structured flow summary
//! - `flow_clear_session` — clear activities for a session

use serde::{Deserialize, Serialize};
use tracing::debug;

use super::types::{
    Activity, ActivityType, ClipboardOp, DebugAction, ErrorType, FileEditType, FlowSummary,
    GitOpType, NavigationTarget, SearchScope,
};
use super::FlowStore;

// ── Input Types ──

/// Activity input from frontend (JSON-friendly).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInput {
    /// Activity type tag.
    #[serde(rename = "type")]
    pub activity_type: String,
    /// Session ID (optional, for session-scoped activities).
    pub session_id: Option<String>,
    /// File path (for file events).
    pub path: Option<String>,
    /// Edit type (create, modify, delete, rename).
    pub edit_type: Option<String>,
    /// Lines changed.
    pub lines_changed: Option<u32>,
    /// Command string (for terminal events).
    pub command: Option<String>,
    /// Working directory.
    pub working_dir: Option<String>,
    /// Exit code.
    pub exit_code: Option<i32>,
    /// Search query.
    pub query: Option<String>,
    /// Search scope.
    pub scope: Option<String>,
    /// Result count.
    pub result_count: Option<u32>,
    /// Clipboard operation.
    pub operation: Option<String>,
    /// Content preview.
    pub content_preview: Option<String>,
    /// Source file.
    pub source_file: Option<String>,
    /// Git operation type.
    pub git_op: Option<String>,
    /// Details string.
    pub details: Option<String>,
    /// Navigation target.
    pub target: Option<String>,
    /// Error type.
    pub error_type: Option<String>,
    /// Error message.
    pub message: Option<String>,
    /// Line number.
    pub line: Option<u32>,
    /// Debug action.
    pub action: Option<String>,
}

impl ActivityInput {
    /// Convert to Activity type.
    fn into_activity(self) -> Result<Activity, String> {
        let activity_type = match self.activity_type.as_str() {
            "file_edit" => {
                let path = self.path.ok_or("file_edit requires path")?;
                let edit_type = parse_edit_type(self.edit_type.as_deref())?;
                ActivityType::FileEdit {
                    path,
                    edit_type,
                    lines_changed: self.lines_changed,
                }
            }
            "file_open" => {
                let path = self.path.ok_or("file_open requires path")?;
                ActivityType::FileOpen { path }
            }
            "terminal_command" => {
                let command = self.command.ok_or("terminal_command requires command")?;
                ActivityType::TerminalCommand {
                    command,
                    working_dir: self.working_dir,
                    exit_code: self.exit_code,
                }
            }
            "search" => {
                let query = self.query.ok_or("search requires query")?;
                let scope = parse_search_scope(self.scope.as_deref())?;
                ActivityType::Search {
                    query,
                    scope,
                    result_count: self.result_count,
                }
            }
            "clipboard" => {
                let operation = parse_clipboard_op(self.operation.as_deref())?;
                ActivityType::Clipboard {
                    operation,
                    content_preview: self.content_preview,
                    source_file: self.source_file,
                }
            }
            "git_operation" => {
                let operation = parse_git_op(self.git_op.as_deref())?;
                ActivityType::GitOperation {
                    operation,
                    details: self.details,
                }
            }
            "navigation" => {
                let target = parse_nav_target(self.target.as_deref())?;
                ActivityType::Navigation {
                    target,
                    details: self.details,
                }
            }
            "error" => {
                let error_type = parse_error_type(self.error_type.as_deref())?;
                let message = self.message.ok_or("error requires message")?;
                ActivityType::Error {
                    error_type,
                    message,
                    file_path: self.path,
                    line: self.line,
                }
            }
            "debug" => {
                let action = parse_debug_action(self.action.as_deref())?;
                ActivityType::Debug {
                    action,
                    file_path: self.path,
                    line: self.line,
                }
            }
            other => return Err(format!("Unknown activity type: {}", other)),
        };

        let mut activity = Activity::new(activity_type, None);
        if let Some(session_id) = self.session_id {
            activity = activity.with_session(session_id);
        }
        Ok(activity)
    }
}

// ── Output Types ──

/// Flow summary output (JSON-friendly).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSummaryOutput {
    pub intent: Option<String>,
    pub recent_edits: Vec<String>,
    pub recent_opens: Vec<String>,
    pub recent_commands: Vec<String>,
    pub recent_searches: Vec<String>,
    pub current_errors: Vec<String>,
    pub idle_seconds: Option<u64>,
}

impl From<FlowSummary> for FlowSummaryOutput {
    fn from(summary: FlowSummary) -> Self {
        Self {
            intent: summary.intent.map(|i| format!("{:?}", i).to_lowercase()),
            recent_edits: summary.recent_edits,
            recent_opens: summary.recent_opens,
            recent_commands: summary.recent_commands,
            recent_searches: summary.recent_searches,
            current_errors: summary.current_errors,
            idle_seconds: summary.idle_seconds,
        }
    }
}

// ── Commands ──

/// Record a single user activity.
#[tauri::command]
pub async fn flow_record_activity(activity: ActivityInput) -> Result<(), String> {
    let activity = activity.into_activity()?;
    debug!("[flow] Recording activity: {:?}", activity.activity_type);
    FlowStore::global().record(activity);
    Ok(())
}

/// Batch record multiple activities.
#[tauri::command]
pub async fn flow_record_activities(activities: Vec<ActivityInput>) -> Result<u32, String> {
    let store = FlowStore::global();
    let mut count = 0u32;
    for input in activities {
        match input.into_activity() {
            Ok(activity) => {
                store.record(activity);
                count += 1;
            }
            Err(err) => {
                debug!("[flow] Skipping invalid activity: {}", err);
            }
        }
    }
    debug!("[flow] Recorded {} activities", count);
    Ok(count)
}

/// Get formatted flow context for system prompt injection.
#[tauri::command]
pub async fn flow_get_context(
    session_id: Option<String>,
    max_activities: Option<usize>,
) -> Result<String, String> {
    let max = max_activities.unwrap_or(50);
    let context = FlowStore::global().format_context(session_id.as_deref(), max);
    Ok(context)
}

/// Get structured flow summary.
#[tauri::command]
pub async fn flow_get_summary(
    session_id: Option<String>,
    max_activities: Option<usize>,
) -> Result<FlowSummaryOutput, String> {
    let max = max_activities.unwrap_or(50);
    let summary = FlowStore::global().summarize(session_id.as_deref(), max);
    Ok(FlowSummaryOutput::from(summary))
}

/// Clear all activities for a session.
#[tauri::command]
pub async fn flow_clear_session(session_id: String) -> Result<(), String> {
    debug!("[flow] Clearing activities for session: {}", session_id);
    FlowStore::global().clear_session(&session_id);
    Ok(())
}

// ── Parsers ──

fn parse_edit_type(s: Option<&str>) -> Result<FileEditType, String> {
    match s {
        Some("create") => Ok(FileEditType::Create),
        Some("modify") | None => Ok(FileEditType::Modify),
        Some("delete") => Ok(FileEditType::Delete),
        Some("rename") => Ok(FileEditType::Rename),
        Some(other) => Err(format!("Unknown edit_type: {}", other)),
    }
}

fn parse_search_scope(s: Option<&str>) -> Result<SearchScope, String> {
    match s {
        Some("codebase") | None => Ok(SearchScope::Codebase),
        Some("current_file") => Ok(SearchScope::CurrentFile),
        Some("files") => Ok(SearchScope::Files),
        Some(other) => Err(format!("Unknown search scope: {}", other)),
    }
}

fn parse_clipboard_op(s: Option<&str>) -> Result<ClipboardOp, String> {
    match s {
        Some("copy") | None => Ok(ClipboardOp::Copy),
        Some("cut") => Ok(ClipboardOp::Cut),
        Some("paste") => Ok(ClipboardOp::Paste),
        Some(other) => Err(format!("Unknown clipboard operation: {}", other)),
    }
}

fn parse_git_op(s: Option<&str>) -> Result<GitOpType, String> {
    match s {
        Some("commit") => Ok(GitOpType::Commit),
        Some("push") => Ok(GitOpType::Push),
        Some("pull") => Ok(GitOpType::Pull),
        Some("fetch") => Ok(GitOpType::Fetch),
        Some("branch_switch") => Ok(GitOpType::BranchSwitch),
        Some("branch_create") => Ok(GitOpType::BranchCreate),
        Some("merge") => Ok(GitOpType::Merge),
        Some("rebase") => Ok(GitOpType::Rebase),
        Some("stash") => Ok(GitOpType::Stash),
        Some("stash_pop") => Ok(GitOpType::StashPop),
        Some("checkout") => Ok(GitOpType::Checkout),
        Some("diff") => Ok(GitOpType::Diff),
        Some("status") | None => Ok(GitOpType::Status),
        Some(other) => Err(format!("Unknown git operation: {}", other)),
    }
}

fn parse_nav_target(s: Option<&str>) -> Result<NavigationTarget, String> {
    match s {
        Some("file") | None => Ok(NavigationTarget::File),
        Some("tab") => Ok(NavigationTarget::Tab),
        Some("panel") => Ok(NavigationTarget::Panel),
        Some("view") => Ok(NavigationTarget::View),
        Some("definition") => Ok(NavigationTarget::Definition),
        Some("reference") => Ok(NavigationTarget::Reference),
        Some("symbol") => Ok(NavigationTarget::Symbol),
        Some(other) => Err(format!("Unknown navigation target: {}", other)),
    }
}

fn parse_error_type(s: Option<&str>) -> Result<ErrorType, String> {
    match s {
        Some("build") | None => Ok(ErrorType::Build),
        Some("test") => Ok(ErrorType::Test),
        Some("lint") => Ok(ErrorType::Lint),
        Some("type_check") => Ok(ErrorType::TypeCheck),
        Some("runtime") => Ok(ErrorType::Runtime),
        Some(other) => Err(format!("Unknown error type: {}", other)),
    }
}

fn parse_debug_action(s: Option<&str>) -> Result<DebugAction, String> {
    match s {
        Some("set_breakpoint") | None => Ok(DebugAction::SetBreakpoint),
        Some("remove_breakpoint") => Ok(DebugAction::RemoveBreakpoint),
        Some("step_over") => Ok(DebugAction::StepOver),
        Some("step_into") => Ok(DebugAction::StepInto),
        Some("step_out") => Ok(DebugAction::StepOut),
        Some("continue") => Ok(DebugAction::Continue),
        Some("pause") => Ok(DebugAction::Pause),
        Some("inspect_variable") => Ok(DebugAction::InspectVariable),
        Some(other) => Err(format!("Unknown debug action: {}", other)),
    }
}
