/**
 * Shared chart styling tokens.
 *
 * Replaces the per-view AXIS_TICK_STYLE / TOOLTIP_*_STYLE constants that were
 * duplicated across GitDashboardView, CodingProfileView, UsageHistory, and
 * MarketTrendsChart.
 */

export const CHART_AXIS_TICK = {
  fill: "var(--color-text-2)",
  fontSize: 11,
} as const;

export const CHART_AXIS_TICK_BOLD = {
  fill: "var(--color-text-1)",
  fontSize: 11,
  fontWeight: 600,
} as const;

export const CHART_TOOLTIP = {
  content: {
    background: "var(--color-bg-2)",
    border: "1px solid var(--color-border-2)",
    borderRadius: "8px",
    padding: "8px 12px",
  } as const,
  label: {
    color: "var(--color-text-1)",
    marginBottom: "4px",
  } as const,
  item: {
    color: "var(--color-text-2)",
    fontSize: "12px",
  } as const,
} as const;

export const CHART_MARGIN = {
  top: 5,
  right: 5,
  left: 0,
  bottom: 5,
} as const;

export const CHART_GRID_STROKE = "var(--color-border-1)";
