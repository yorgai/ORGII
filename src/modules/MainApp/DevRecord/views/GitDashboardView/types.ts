/**
 * Git Dashboard Types
 *
 * Type definitions for commit analytics and contributor stats.
 */

export interface ChangeMetrics {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface ContributorStats {
  name: string;
  email: string;
  commitCount: number;
  all: ChangeMetrics;
  contentOnly: ChangeMetrics;
  lastCommitDate: string;
}

export interface CommitFileChange {
  path: string;
  insertions: number;
  deletions: number;
  status: string;
}

export interface CommitStatsEntry {
  filesChanged: number;
  insertions: number;
  deletions: number;
  fileChanges: CommitFileChange[];
}

export interface DailyCommitData {
  date: string;
  /** For hourly multi-day charts: date label (e.g. "3/5") shown only at midnight. */
  dayLabel?: string;
  total: number;
  [author: string]: number | string | undefined;
}

export type DateRange =
  | "24h"
  | "3d"
  | "1w"
  | "1m"
  | "3m"
  | "6m"
  | "1y"
  | "custom";

export const DATE_RANGE_DAYS: Record<DateRange, number> = {
  "24h": 1,
  "3d": 3,
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  custom: 0,
} as const;

export type DashboardViewMode = "line" | "chart" | "dots";

export type DashboardTab = "statistics" | "activities";

export interface DotGraphCell {
  dateKey: string; // Can be "YYYY-MM-DD" or "YYYY-MM-DD HH:00"
  count: number;
  xIndex: number; // e.g. weekIndex or hourOfDay
  yIndex: number; // e.g. dayOfWeek or dayIndex (0 for today, 1 for yesterday)
}
