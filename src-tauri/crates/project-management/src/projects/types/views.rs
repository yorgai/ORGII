//! View-ready types for Kanban, Gantt, and Calendar.

use serde::{Deserialize, Serialize};

use super::enriched::{EnrichedWorkItem, ResolvedLabel, ResolvedPerson};

// ============================================
// View-Ready Types (for Kanban, Gantt, Calendar)
// ============================================

/// Kanban task status (maps from WorkItemStatus)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KanbanStatus {
    Backlog,
    Planned,
    InProgress,
    InReview,
    Completed,
    Cancelled,
    Duplicate,
}

/// Kanban task for board view
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanTask {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: KanbanStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    pub labels: Vec<ResolvedLabel>,
}

/// Gantt task status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GanttStatus {
    NotStarted,
    InProgress,
    Completed,
    Overdue,
    Cancelled,
}

/// Gantt task for timeline view
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttTask {
    pub id: String,
    pub title: String,
    /// ISO 8601 date string
    pub start_date: String,
    /// ISO 8601 date string
    pub end_date: String,
    pub status: GanttStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    pub labels: Vec<ResolvedLabel>,
}

/// Calendar event for calendar view
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    /// ISO 8601 date string
    pub start_date: String,
    /// ISO 8601 date string
    pub end_date: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<ResolvedPerson>,
    pub labels: Vec<ResolvedLabel>,
    pub all_day: bool,
}

/// Status counts for filter badges
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusCounts {
    pub all: usize,
    pub backlog: usize,
    pub planned: usize,
    pub in_progress: usize,
    pub in_review: usize,
    pub completed: usize,
    pub cancelled: usize,
    pub duplicate: usize,
}

/// Work items grouped by status (for Kanban)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupedWorkItems {
    pub backlog: Vec<EnrichedWorkItem>,
    pub planned: Vec<EnrichedWorkItem>,
    pub in_progress: Vec<EnrichedWorkItem>,
    pub in_review: Vec<EnrichedWorkItem>,
    pub completed: Vec<EnrichedWorkItem>,
    pub cancelled: Vec<EnrichedWorkItem>,
    pub duplicate: Vec<EnrichedWorkItem>,
}

/// Complete work items response with all pre-computed views
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemsViewData {
    /// All work items (enriched)
    pub items: Vec<EnrichedWorkItem>,
    /// Status filter counts
    pub counts: StatusCounts,
    /// Kanban-ready tasks
    pub kanban_tasks: Vec<KanbanTask>,
    /// Gantt-ready tasks
    pub gantt_tasks: Vec<GanttTask>,
    /// Calendar-ready events
    pub calendar_events: Vec<CalendarEvent>,
    /// Items grouped by status
    pub grouped: GroupedWorkItems,
}
