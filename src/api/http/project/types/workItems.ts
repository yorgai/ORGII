import type {
  FollowUpRef,
  LinkedSession,
  OrchestratorConfig,
  OrchestratorState,
  ProofOfWork,
} from "./agentWorkflow";
import type { CommentEntry, TodoEntry } from "./common";
import type { WorkItemRoutineSource, WorkItemSchedule } from "./routines";

export const WORK_ITEM_HISTORY_ACTION = {
  CREATED: "created",
  UPDATED: "updated",
  COMMENTED: "commented",
  DELETED: "deleted",
  RESTORED: "restored",
  MOVED: "moved",
} as const;

export type WorkItemHistoryAction =
  (typeof WORK_ITEM_HISTORY_ACTION)[keyof typeof WORK_ITEM_HISTORY_ACTION];

export interface WorkItemHistoryChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface WorkItemHistoryEvent {
  id: string;
  action: WorkItemHistoryAction;
  timestamp: string;
  actorId?: string;
  actorName?: string;
  changes?: WorkItemHistoryChange[];
  summary?: string;
}

export interface WorkItemFrontmatter {
  id: string;
  short_id: string;
  title: string;
  project?: string;
  status: string;
  priority: string;
  assignee?: string;
  assignee_type?: string;
  labels: string[];
  milestone?: string;
  parent?: string;
  start_date?: string;
  target_date?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  starred: boolean;
  todos: TodoEntry[];
  comments?: CommentEntry[];
  history?: WorkItemHistoryEvent[];
  linked_sessions?: LinkedSession[];
  proof_of_work?: ProofOfWork;
  orchestrator_config?: OrchestratorConfig;
  orchestrator_state?: OrchestratorState;
  follow_up_items?: FollowUpRef[];
  schedule?: WorkItemSchedule;
  routine_source?: WorkItemRoutineSource;
}

export interface WorkItemData {
  frontmatter: WorkItemFrontmatter;
  body: string;
  filename: string;
}

/**
 * Partial update payload for work items.
 *
 * All fields are optional — only provided fields are updated. The Rust
 * backend runs the read-modify-write inside an `IMMEDIATE` transaction
 * so concurrent partial updates serialize safely.
 */
export interface WorkItemPartialUpdate {
  title?: string;
  body?: string;
  status?: string;
  priority?: string;
  project?: string | null;
  starred?: boolean;
  assignee?: string | null;
  assigneeType?: string | null;
  labels?: string[];
  milestone?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  todos?: TodoEntry[];
  comments?: CommentEntry[];
  linkedSessions?: LinkedSession[];
  orchestratorConfig?: OrchestratorConfig;
  orchestratorState?: OrchestratorState;
  schedule?: WorkItemSchedule | null;
}

export interface ResolvedPerson {
  id: string;
  name: string;
  color: string;
}

export interface ResolvedLabel {
  id: string;
  name: string;
  color: string;
}

export interface ResolvedProject {
  id: string;
  name: string;
}

export interface ResolvedMilestone {
  id: string;
  name: string;
}

/**
 * Work item with pre-resolved labels, members, and computed fields.
 * Field names are camelCase (Rust uses `serde(rename_all = "camelCase")`).
 */
export interface EnrichedWorkItem {
  id: string;
  shortId: string;
  title: string;
  body: string;
  filename: string;

  status: string;
  priority: string;
  starred: boolean;

  assignee?: ResolvedPerson;
  assigneeType?: string;
  labels: ResolvedLabel[];
  project?: ResolvedProject;
  milestone?: ResolvedMilestone;

  startDate?: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  createdBy?: string;

  todos: TodoEntry[];
  comments: CommentEntry[];
  history: WorkItemHistoryEvent[];

  linkedSessions: LinkedSession[];
  proofOfWork?: ProofOfWork;
  orchestratorConfig?: OrchestratorConfig;
  orchestratorState?: OrchestratorState;
  followUpItems: FollowUpRef[];
  schedule?: WorkItemSchedule;
  routineSource?: WorkItemRoutineSource;
}

export type RustKanbanStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled"
  | "duplicate";

export interface RustKanbanTask {
  id: string;
  title: string;
  description?: string;
  status: RustKanbanStatus;
  priority?: string;
  assignee?: string;
  labels: ResolvedLabel[];
}

export type RustGanttStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "overdue"
  | "cancelled";

export interface RustGanttTask {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: RustGanttStatus;
  assignee?: string;
  labels: ResolvedLabel[];
}

export interface RustCalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  assignee?: ResolvedPerson;
  labels: ResolvedLabel[];
  allDay: boolean;
}

export interface StatusCounts {
  all: number;
  backlog: number;
  planned: number;
  inProgress: number;
  inReview: number;
  completed: number;
  cancelled: number;
  duplicate: number;
}

export interface GroupedWorkItems {
  backlog: EnrichedWorkItem[];
  planned: EnrichedWorkItem[];
  inProgress: EnrichedWorkItem[];
  inReview: EnrichedWorkItem[];
  completed: EnrichedWorkItem[];
  cancelled: EnrichedWorkItem[];
  duplicate: EnrichedWorkItem[];
}

/**
 * Complete work items response with all pre-computed views.
 * Single IPC call returns everything needed for display.
 */
export interface WorkItemsViewData {
  items: EnrichedWorkItem[];
  counts: StatusCounts;
  kanbanTasks: RustKanbanTask[];
  ganttTasks: RustGanttTask[];
  calendarEvents: RustCalendarEvent[];
  grouped: GroupedWorkItems;
}

export interface BatchItemError {
  shortId: string;
  error: string;
}

export interface BatchDeleteResult {
  deleted: string[];
  errors: BatchItemError[];
}

export interface BatchUpdateResult {
  updated: EnrichedWorkItem[];
  errors: BatchItemError[];
}
