/**
 * KanbanBoard Configuration
 *
 * Defines task statuses, column settings, and icons for the Kanban board.
 */
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  Layers,
  XCircle,
} from "lucide-react";

import type { KanbanColumnConfig, TaskStatus } from "./types";

// ============================================
// Default Column Configuration
// ============================================

// `title` is an i18n key (with optional namespace prefix). `KanbanColumn`
// passes it through `t()`, so it resolves at render time and respects the
// user's locale.
export const DEFAULT_KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    id: "backlog",
    title: "projects:workItems.statusLabels.backlog",
    icon: CircleDashed,
    color: "var(--color-neutral-6)",
    bgColor: "color-mix(in srgb, var(--color-neutral-6) 10%, transparent)",
    dotColor: "var(--color-neutral-6)",
    headerBgColor: "color-mix(in srgb, var(--color-neutral-6) 8%, transparent)",
  },
  {
    id: "planned",
    title: "projects:workItems.statusLabels.planned",
    icon: Circle,
    color: "var(--color-neutral-6)",
    bgColor: "color-mix(in srgb, var(--color-neutral-6) 10%, transparent)",
    dotColor: "var(--color-neutral-6)",
    headerBgColor: "color-mix(in srgb, var(--color-neutral-6) 8%, transparent)",
  },
  {
    id: "in_progress",
    title: "projects:workItems.statusLabels.in_progress",
    icon: Clock,
    color: "var(--color-primary-6)",
    bgColor: "color-mix(in srgb, var(--color-primary-6) 10%, transparent)",
    dotColor: "var(--color-primary-6)",
    headerBgColor: "color-mix(in srgb, var(--color-primary-6) 8%, transparent)",
  },
  {
    id: "in_review",
    title: "projects:workItems.statusLabels.in_review",
    icon: Layers,
    color: "var(--color-warning-6)",
    bgColor: "color-mix(in srgb, var(--color-warning-6) 10%, transparent)",
    dotColor: "var(--color-warning-6)",
    headerBgColor: "color-mix(in srgb, var(--color-warning-6) 8%, transparent)",
  },
  {
    id: "completed",
    title: "projects:workItems.statusLabels.completed",
    icon: CheckCircle2,
    color: "var(--color-success-6)",
    bgColor: "color-mix(in srgb, var(--color-success-6) 10%, transparent)",
    dotColor: "var(--color-success-6)",
    headerBgColor: "color-mix(in srgb, var(--color-success-6) 8%, transparent)",
  },
  {
    id: "cancelled",
    title: "projects:workItems.statusLabels.cancelled",
    icon: XCircle,
    color: "var(--color-danger-6)",
    bgColor: "color-mix(in srgb, var(--color-danger-6) 10%, transparent)",
    dotColor: "var(--color-danger-6)",
    headerBgColor: "color-mix(in srgb, var(--color-danger-6) 8%, transparent)",
  },
  {
    id: "duplicate",
    title: "projects:workItems.statusLabels.duplicate",
    icon: XCircle,
    color: "var(--color-text-3)",
    bgColor: "color-mix(in srgb, var(--color-text-3) 10%, transparent)",
    dotColor: "var(--color-text-3)",
    headerBgColor: "color-mix(in srgb, var(--color-text-3) 8%, transparent)",
  },
];

// ============================================
// Helper Functions
// ============================================

export function getColumnConfig(
  status: TaskStatus,
  columns: KanbanColumnConfig[] = DEFAULT_KANBAN_COLUMNS
): KanbanColumnConfig {
  return columns.find((col) => col.id === status) || columns[0];
}
