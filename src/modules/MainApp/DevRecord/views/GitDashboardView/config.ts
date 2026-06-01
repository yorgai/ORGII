/**
 * Git Dashboard Configuration
 *
 * Colors, constants, and helpers for the commit analytics dashboard.
 */

const CONTRIBUTOR_COLORS = [
  "var(--color-primary-6)",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#38bdf8",
  "#fb923c",
  "#4ade80",
  "#e879f9",
  "#22d3ee",
] as const;

const MAX_CONTRIBUTOR_COLORS = CONTRIBUTOR_COLORS.length;

export function getContributorColor(index: number): string {
  return CONTRIBUTOR_COLORS[index % MAX_CONTRIBUTOR_COLORS];
}

export const CHART_HEIGHT = 260;

export const MAX_CHART_AUTHORS = 20;
export const AUTHOR_BREAKDOWN_THRESHOLD = 100;
export const OTHER_CHART_COLOR = "#94a3b8";

export const DATE_RANGE_OPTIONS = [
  { key: "24h", label: "24h" },
  { key: "3d", label: "3d" },
  { key: "1w", label: "1w" },
  { key: "1m", label: "1m" },
  { key: "3m", label: "3m" },
  { key: "6m", label: "6m" },
  { key: "1y", label: "1y" },
  { key: "custom", label: "Custom" },
] as const;

export const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
// Time labels for intraday views (every 4 hours: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
export const HOUR_LABELS = [
  "12am",
  "4am",
  "8am",
  "12pm",
  "4pm",
  "8pm",
] as const;
