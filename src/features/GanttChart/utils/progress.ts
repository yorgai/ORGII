/**
 * Progress Calculation Utilities
 *
 * Calculate expected progress vs actual progress for visual indicators.
 */

/**
 * Calculate expected progress percentage based on time elapsed
 */
export function calculateExpectedProgress(
  startDate: Date | string,
  endDate: Date | string,
  currentDate: Date = new Date()
): number {
  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  const now = currentDate;

  // If not started yet
  if (now < start) return 0;

  // If already ended
  if (now > end) return 100;

  // Calculate percentage of time elapsed
  const totalDuration = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();

  return Math.round((elapsed / totalDuration) * 100);
}

/**
 * Calculate progress health (on track, at risk, behind)
 */
export type ProgressHealth = "on-track" | "at-risk" | "behind" | "ahead";

export function calculateProgressHealth(
  actualProgress: number,
  expectedProgress: number
): ProgressHealth {
  const difference = actualProgress - expectedProgress;

  if (difference >= 0) {
    return "ahead";
  } else if (difference >= -10) {
    return "on-track";
  } else if (difference >= -25) {
    return "at-risk";
  } else {
    return "behind";
  }
}

/**
 * Get color for progress health
 */
export function getProgressHealthColor(health: ProgressHealth): string {
  switch (health) {
    case "ahead":
      return "#10b981"; // Green
    case "on-track":
      return "#3b82f6"; // Blue
    case "at-risk":
      return "#f59e0b"; // Orange
    case "behind":
      return "#ef4444"; // Red
  }
}

/**
 * Get gradient colors for progress bar based on health
 */
export function getProgressGradient(
  actualProgress: number,
  expectedProgress: number
): { start: string; end: string } {
  const health = calculateProgressHealth(actualProgress, expectedProgress);

  switch (health) {
    case "ahead":
      return { start: "#10b981", end: "#059669" }; // Green gradient
    case "on-track":
      return { start: "#3b82f6", end: "#2563eb" }; // Blue gradient
    case "at-risk":
      return { start: "#f59e0b", end: "#d97706" }; // Orange gradient
    case "behind":
      return { start: "#ef4444", end: "#dc2626" }; // Red gradient
  }
}
