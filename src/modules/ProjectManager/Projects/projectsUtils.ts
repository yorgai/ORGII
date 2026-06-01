/**
 * Utility types, constants, and helpers for the Projects page.
 */
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@src/types/core/project";

// ============================================================================
// Types
// ============================================================================

export type ProjectsGroupMode = "status" | "priority" | "targetDate";
export type WorkspaceSourceMode = "local_only" | "include_external";

export const TARGET_DATE_GROUPS = [
  "overdue",
  "thisWeek",
  "thisMonth",
  "later",
  "noTargetDate",
] as const;

export type TargetDateGroup = (typeof TARGET_DATE_GROUPS)[number];

export const STORY_PRIORITY_ORDER: ProjectPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

// ============================================================================
// Label helpers
// ============================================================================

export function getProjectStatusLabelKey(status: ProjectStatus): string {
  if (status === "in_progress") return "properties.statusOptions.inProgress";
  return `properties.statusOptions.${status}`;
}

// ============================================================================
// Date helpers
// ============================================================================

function getStartOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getTargetDateGroup(project: Project): TargetDateGroup {
  if (!project.targetDate) return "noTargetDate";

  const targetDate = new Date(project.targetDate);
  if (Number.isNaN(targetDate.getTime())) return "noTargetDate";

  const today = getStartOfToday();
  const weekEnd = addDays(today, 7);
  const monthEnd = addDays(today, 30);

  if (targetDate < today) return "overdue";
  if (targetDate <= weekEnd) return "thisWeek";
  if (targetDate <= monthEnd) return "thisMonth";
  return "later";
}
