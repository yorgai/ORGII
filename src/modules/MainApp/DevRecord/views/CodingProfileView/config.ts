/**
 * CodingProfileView — Configuration, Constants & Helpers
 *
 * Shared across CodingProfileView and CodingActivityView.
 */
import {
  CHART_AXIS_TICK,
  CHART_MARGIN,
  CHART_TOOLTIP,
} from "@src/components/Chart";

// ============================================
// Date Ranges
// ============================================

export const DATE_RANGE_OPTIONS = [
  { key: "24h", label: "24h", days: 1 },
  { key: "3d", label: "3d", days: 3 },
  { key: "1w", label: "1w", days: 7 },
  { key: "1m", label: "1m", days: 30 },
  { key: "3m", label: "3m", days: 90 },
  { key: "6m", label: "6m", days: 180 },
  { key: "1y", label: "1y", days: 365 },
  { key: "custom", label: "Custom", days: 0 },
] as const;

export type ProfileDateRange = (typeof DATE_RANGE_OPTIONS)[number]["key"];

export const DEFAULT_RANGE: ProfileDateRange = "24h";

// ============================================
// Chart Colors & Styles
// ============================================

export const IDE_COLORS = [
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
  "#facc15",
  "#94a3b8",
  "#f87171",
  "#2dd4bf",
  "#818cf8",
  "#fbbf24",
] as const;

export const HEATMAP_COLORS = [
  "var(--color-fill-3)",
  "var(--color-primary-3)",
  "var(--color-primary-4)",
  "var(--color-primary-5)",
  "var(--color-primary-6)",
] as const;

export { CHART_AXIS_TICK, CHART_MARGIN };
export const AXIS_TICK_STYLE = CHART_AXIS_TICK;
export const TOOLTIP_CONTENT_STYLE = CHART_TOOLTIP.content;
export const TOOLTIP_LABEL_STYLE = CHART_TOOLTIP.label;
export const TOOLTIP_ITEM_STYLE = CHART_TOOLTIP.item;

// ============================================
// Heatmap Labels
// ============================================

export const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const HOUR_LABELS = [
  "12am",
  "4am",
  "8am",
  "12pm",
  "4pm",
  "8pm",
] as const;

// ============================================
// Content Tabs
// ============================================

export const PROFILE_TABS = [
  { key: "activity", labelKey: "devActivity.tabs.activity" },
  { key: "focus", labelKey: "devActivity.tabs.focus" },
  { key: "languages", labelKey: "devActivity.tabs.languages" },
  { key: "heatmap", labelKey: "devActivity.tabs.heatmap" },
  { key: "ide", labelKey: "devActivity.tabs.ide" },
] as const;

export type ProfileTabKey = (typeof PROFILE_TABS)[number]["key"];

export const DEFAULT_TAB: ProfileTabKey = "activity";

// ============================================
// Fetch Result (shared by self-fetching tab components)
// ============================================

export interface FetchResult<T> {
  key: string;
  data: T;
  error: string | null;
}

// ============================================
// Helpers
// ============================================

export const ACTIVITY_SOURCES = {
  orgii_editor: "orgii_editor",
  vscode: "vscode",
  cursor: "cursor",
  jetbrains: "jetbrains",
  vim: "vim",
  sublime: "sublime",
  zed: "zed",
  xcode: "xcode",
  emacs: "emacs",
  trae: "trae",
  windsurf: "windsurf",
  fleet: "fleet",
  nova: "nova",
  lapce: "lapce",
  helix: "helix",
  kakoune: "kakoune",
  terminal: "terminal",
  agent: "agent",
  ai_cli: "ai_cli",
  unknown: "unknown",
} as const;

export type ActivitySource =
  (typeof ACTIVITY_SOURCES)[keyof typeof ACTIVITY_SOURCES];

const SOURCE_LABELS: Record<ActivitySource, string> = {
  orgii_editor: "ORGII Editor",
  vscode: "VS Code",
  cursor: "Cursor",
  jetbrains: "JetBrains",
  vim: "Vim / Neovim",
  sublime: "Sublime Text",
  zed: "Zed",
  xcode: "Xcode",
  emacs: "Emacs",
  trae: "Trae",
  windsurf: "Windsurf",
  fleet: "Fleet",
  nova: "Nova",
  lapce: "Lapce",
  helix: "Helix",
  kakoune: "Kakoune",
  terminal: "Terminal",
  agent: "Agent",
  ai_cli: "AI CLI",
  unknown: "Unknown",
};

/** CLI tool identifiers used in the unified CLI sessions view */
export const CLI_TOOL_IDS = [
  "claude_code",
  "codex",
  "gemini",
  "kiro",
  "aider",
  "cursor_cli",
] as const;

export type CliToolId = (typeof CLI_TOOL_IDS)[number];

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes < 1) return "<1m";
  return `${minutes}m`;
}

export function getHeatmapColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return HEATMAP_COLORS[0];
  const ratio = count / maxCount;
  if (ratio <= 0.25) return HEATMAP_COLORS[1];
  if (ratio <= 0.5) return HEATMAP_COLORS[2];
  if (ratio <= 0.75) return HEATMAP_COLORS[3];
  return HEATMAP_COLORS[4];
}

export function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source as ActivitySource] ?? source;
}

export {
  formatModelName,
  formatModelNameFull,
} from "@src/util/formatModelName";

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString();
}

export interface DateRangeResult {
  startDate: string;
  endDate: string;
}

export function computeDateRange(
  rangeKey: ProfileDateRange,
  customRange?: DateRangeResult
): DateRangeResult {
  if (rangeKey === "custom" && customRange) {
    return customRange;
  }
  const rangeDef = DATE_RANGE_OPTIONS.find((opt) => opt.key === rangeKey);
  const rangeDays = rangeDef?.days ?? 30;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - rangeDays);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function computePreviousDateRange(
  rangeKey: ProfileDateRange,
  customRange?: DateRangeResult
): DateRangeResult {
  if (rangeKey === "custom" && customRange) {
    const startMs = new Date(customRange.startDate).getTime();
    const endMs = new Date(customRange.endDate).getTime();
    const spanMs = endMs - startMs;
    const prevEnd = new Date(startMs);
    const prevStart = new Date(startMs - spanMs);
    const fmt = (date: Date) => date.toISOString().slice(0, 10);
    return { startDate: fmt(prevStart), endDate: fmt(prevEnd) };
  }
  const rangeDef = DATE_RANGE_OPTIONS.find((opt) => opt.key === rangeKey);
  const rangeDays = rangeDef?.days ?? 30;
  const end = new Date();
  end.setDate(end.getDate() - rangeDays);
  const start = new Date(end);
  start.setDate(start.getDate() - rangeDays);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export function computeDeltaPercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// ============================================
// Deep Work Thresholds (seconds)
// ============================================

export const DEEP_WORK_THRESHOLD = 1800;
export const MEDIUM_FOCUS_THRESHOLD = 600;
