/**
 * KanbanBoard Types
 *
 * Shared types for the reusable KanbanBoard component.
 */
import type { LucideIcon } from "lucide-react";

import type { CliAgentType } from "@src/api/types/keys";
import type { Label } from "@src/types/core/shared";

// ============================================
// Task Types
// ============================================

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled"
  | "duplicate";

export const KANBAN_RESULT_STATUS = {
  Failed: "failed",
  Archived: "archived",
} as const;

export type KanbanResultStatus =
  (typeof KANBAN_RESULT_STATUS)[keyof typeof KANBAN_RESULT_STATUS];

export interface KanbanTaskOrgtrackMetadata {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  relatedCommits: number;
  committedFiles: number;
  committedRatePercent: number;
  touchedFiles?: string[];
}

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  tags?: string[];
  labels?: Label[];
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  session_id?: string;
  attempt_count?: number;
  /**
   * True when this task represents a session the user has not yet opened
   * since it reached a terminal state. Drives unread visual emphasis and
   * intra-column "unread first" sorting in terminal result columns.
   */
  isUnread?: boolean;
  /** Terminal result shown as a small badge inside consolidated result columns. */
  resultStatus?: KanbanResultStatus;
  /** Display label for the agent runtime / agent type that owns the task. */
  agentLabel?: string;
  /** Rust-resolved Lucide icon id for Rust-native agents. */
  agentIconId?: string;
  /** CLI agent type for branded CLI icons. */
  cliAgentType?: CliAgentType;
  /** Raw LLM model id used by the session. */
  modelName?: string;
  /** Repo-shareable orgtrack metadata for session file/commit attribution. */
  orgtrackMetadata?: KanbanTaskOrgtrackMetadata;
  /** True when source impact metadata is known to be unavailable for this task. */
  orgtrackMetadataUnavailable?: boolean;
  /** True while explicit Orgtrack / AI Blame analysis is running for this session. */
  orgtrackMetadataLoading?: boolean;
  /** Explicitly rebuilds Rust-side Orgtrack / AI Blame analysis for this session. */
  onUpdateGitBlame?: (task: KanbanTask) => void | Promise<void>;
  /** Queues Rust-side Orgtrack / AI Blame analysis without rebuilding current artifacts. */
  onAnalyzeGitBlame?: (task: KanbanTask) => void | Promise<void>;
  /** Display label for the workspace root associated with the session. */
  workspaceName?: string;
  /**
   * Owning Agent Org's display name when the session was launched as
   * part of an Agent Org run (Inbox or any other entry point). Left
   * unset for org-scoped Kanban embeds (e.g. the Inbox per-org Kanban)
   * since every card there belongs to the same org anyway.
   */
  orgName?: string;
  /**
   * Auxiliary metadata pills rendered inline in the footer-left strip
   * (next to priority / agent / model). Each entry can optionally
   * include a small Lucide icon for quick scan and a CSS color string
   * applied to both the icon and the text (e.g. `var(--color-success-6)`
   * for completed-todo timestamps). Used for low-importance metadata
   * that should sit at the same visual layer as the other footer pills
   * — distinct from `description` (above the footer divider).
   */
  metaLines?: Array<{ icon?: LucideIcon; text: string; color?: string }>;
}

// ============================================
// Column Types
// ============================================

export interface KanbanColumnConfig {
  id: TaskStatus;
  title: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  dotColor: string;
  headerBgColor: string;
  /** Override the board-level showAddButton for this specific column. */
  showAddButton?: boolean;
}

export interface KanbanColumnData {
  id: TaskStatus;
  tasks: KanbanTask[];
}
