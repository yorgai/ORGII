/**
 * CalendarView Types
 *
 * Shared types for the reusable CalendarView component.
 */
import type { Label, Person } from "@src/types/core/shared";
import type { WorkItemStatus } from "@src/types/core/workItem";

// ============================================
// View Mode Types
// ============================================

export type CalendarViewMode = "day" | "week" | "month";

// ============================================
// Event Types
// ============================================

/** Calendar event - can represent work items, tasks, or standalone events */
export interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date | string;
  endDate: Date | string;
  /** If true, event spans full day(s) without specific times */
  allDay?: boolean;
  /** Optional color override (CSS variable or hex) */
  color?: string;
  /** Status maps to WorkItemStatus for consistency */
  status?: WorkItemStatus;
  assignee?: Person;
  labels?: Label[];
  description?: string;
}

// ============================================
// Positioned Event (for rendering with overlap handling)
// ============================================

export interface PositionedEvent extends CalendarEvent {
  /** Column index when events overlap (0-based) */
  column: number;
  /** Total columns in this time slot for width calculation */
  totalColumns: number;
  /** Top position as percentage (for day/week view) */
  top: number;
  /** Height as percentage (for day/week view) */
  height: number;
}

// ============================================
// Config Types
// ============================================

export interface CalendarConfig {
  /** Week starts on: 0 = Sunday, 1 = Monday */
  weekStartsOn: 0 | 1;
  /** Start hour for day/week view (0-23) */
  dayStartHour: number;
  /** End hour for day/week view (0-24) */
  dayEndHour: number;
  /** Minutes per time slot */
  slotDuration: number;
  /** Show weekend columns in week view */
  showWeekends: boolean;
}

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  weekStartsOn: 1, // Monday
  dayStartHour: 0,
  dayEndHour: 24,
  slotDuration: 60,
  showWeekends: true,
};

// ============================================
// Re-export shared types for convenience
// ============================================

export type { Label, Person };
export type { WorkItemStatus };
