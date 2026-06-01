//! Pure leaf enums describing the agent workflow lifecycle.
//!
//! These types belong to the `project_management` domain conceptually
//! but are pulled into `core_types` because `agent_core` reads them
//! during work-item execution. Keeping them here lets both crates
//! reference the same enum without forming a `agent_core ↔
//! project_management` dependency cycle on this axis.
//!
//! Composite structs (`OrchestratorConfig`, `ReviewFeedback`,
//! `ProofOfWork`, …) stay in `project_management::projects::types`
//! because they reach into project-management-specific helpers.

use serde::{Deserialize, Serialize};

// ── Lifecycle phase / outcome ────────────────────────────────────────

/// Phase of the orchestrator state machine. `Idle` is the resting
/// state; the others mark live work.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestratorPhase {
    #[default]
    Idle,
    #[serde(alias = "sde")]
    Coding,
    Review,
    FollowUp,
    Completed,
    Failed,
    AwaitingUser,
}

/// Outcome of the review agent's analysis of a work item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewOutcome {
    Approved,
    ChangesRequested,
    Inconclusive,
}

// ── Agents and sessions ─────────────────────────────────────────────

/// Agent role within the work-item lifecycle. `SubAgent` is reserved
/// for delegated child runs spawned via the unified `agent` tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    #[serde(alias = "sde")]
    Coding,
    Review,
    Orchestrator,
    Custom,
    SubAgent,
}

/// Runtime kind for a session linked to a work item — describes the
/// runtime, not the task.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkedSessionType {
    /// Session running on the Rust-native agent runtime.
    #[serde(alias = "codingagent", alias = "sde", alias = "coding", alias = "os")]
    Native,
    /// Session running via an external CLI agent (Cursor, Claude Code, …).
    Cli,
}

/// Lifecycle status of a linked session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkedSessionStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

// ── Review and PR ────────────────────────────────────────────────────

/// Severity level on a structured review comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewCommentSeverity {
    Error,
    Warning,
    Suggestion,
    Praise,
}

/// Status of a previous review comment's resolution in a later round.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionStatus {
    Fixed,
    NotFixed,
    PartiallyFixed,
}

/// Status of a PR linked to a work item's proof of work.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrStatus {
    Draft,
    Open,
    Merged,
    Closed,
}

/// Status of a file change relative to the base branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

// ── Linked session ──────────────────────────────────────────────────

/// A session linked to a work item.
///
/// One row per launched (sub)agent run. Carries enough metadata for the
/// work-item view to render a timeline of contributions, costs, and
/// tokens without re-loading the full session log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinkedSession {
    pub session_id: String,
    pub session_type: LinkedSessionType,
    pub agent_role: AgentRole,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub status: LinkedSessionStatus,
    #[serde(default)]
    pub cost_usd: f64,
    #[serde(default)]
    pub total_tokens: u64,
    /// Parent session ID — present when this session is a sub-agent run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    /// Display name of the sub-agent (e.g. `"doc writer"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_agent_name: Option<String>,
    /// Instance number within the parent session (e.g. 1, 2, 3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_agent_instance: Option<u32>,
    /// Truncated preview of the sub-agent's final output.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_preview: Option<String>,
}

// ── Review payloads ──────────────────────────────────────────────────
//
// `ReviewComment`, `ResolvedFromPrevious`, and `ReviewFeedback` are the
// pure data shapes the review agent emits. They live here (not in
// `project_management::projects::types`) so `agent_core` can read them
// without depending on `project_management`.

/// A single structured review comment from the review agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewComment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub severity: ReviewCommentSeverity,
    pub message: String,
}

/// Resolution record referencing a comment from a previous review round.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResolvedFromPrevious {
    pub round: u32,
    pub comment_index: u32,
    pub status: ResolutionStatus,
}

/// Structured output from the review agent's `submit_review` tool.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewFeedback {
    pub outcome: ReviewOutcome,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<ReviewComment>,
    pub session_id: String,
    pub reviewed_at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolved_from_previous: Vec<ResolvedFromPrevious>,
}

// ── Diff and test stats ──────────────────────────────────────────────

/// Per-file change stats relative to the base branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileChangeStatus,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

/// Work item diff statistics (aggregate + optional per-file breakdown).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkItemDiffStats {
    #[serde(default)]
    pub files_changed: u32,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<FileChange>,
}

/// Test run results.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TestResults {
    #[serde(default)]
    pub passed: u32,
    #[serde(default)]
    pub failed: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage_delta: Option<String>,
}

// ── Reviewer identity and config ─────────────────────────────────────

/// Who performs the review (identity only, no resource config).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReviewerRef {
    /// A specific agent definition acts as reviewer.
    Agent { id: String },
    /// An org member is selected to review.
    Org { id: String },
    /// Human reviews via the UI.
    Human,
    /// Same agent as the work item owner (optionally with a different model).
    SelfReview,
}

fn default_max_review_rounds() -> u32 {
    3
}

/// Review configuration for a work item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReviewConfig {
    pub reviewer: ReviewerRef,
    #[serde(default = "default_max_review_rounds")]
    pub max_rounds: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

impl Default for ReviewConfig {
    fn default() -> Self {
        Self {
            reviewer: ReviewerRef::SelfReview,
            max_rounds: 3,
            model_id: None,
            account_id: None,
        }
    }
}

// ── Proof of work and failure info ───────────────────────────────────

/// Cumulative proof of work across all linked sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProofOfWork {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_status: Option<PrStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stats: Option<WorkItemDiffStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_results: Option<TestResults>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_outcome: Option<ReviewOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_feedback: Option<ReviewFeedback>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review_history: Vec<ReviewFeedback>,
    #[serde(default)]
    pub total_cost_usd: f64,
    #[serde(default)]
    pub total_tokens: u64,
}

/// Information about the last session failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LastFailure {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

// ── Follow-up and schedule ───────────────────────────────────────────

/// Reference to a follow-up work item created by the review agent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FollowUpRef {
    pub short_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Time-based trigger for a work item (one-shot or recurring).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkItemSchedule {
    /// One-time trigger: ISO 8601 timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// Recurring trigger: cron expression (e.g. "0 18 * * 3" = every Wed 6pm).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    /// Whether this schedule is active.
    #[serde(default)]
    pub enabled: bool,
    /// Last time a cron schedule fired (ISO 8601), used for dedup.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<String>,
}
