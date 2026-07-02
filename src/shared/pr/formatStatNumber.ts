/**
 * Format an additions / deletions / files count for display.
 *
 * - Truncates to an integer and inserts thousands separators.
 * - Negative inputs keep their sign (callers add the leading +/- glyph).
 * - Non-finite / NaN inputs collapse to "0" so the UI never shows "NaN".
 *
 * Shared across PR surfaces (WorkStation PR card, WorkItems diff summary, the
 * chat SessionLinkCard) so diff stats read consistently everywhere.
 */
export function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.trunc(value);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded).toString();
  return sign + abs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Compact formatter for tight UI slots (dropdown rows, pills).
 * Use {@link formatStatNumber} in tooltips when the full count matters.
 */
export function formatCompactStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";

  const rounded = Math.trunc(Math.abs(value));
  if (rounded >= 1_000_000) {
    const millions = rounded / 1_000_000;
    if (millions >= 100) return `${Math.round(millions)}M`;
    const formatted = (Math.round(millions * 10) / 10).toFixed(1);
    return `${formatted.replace(/\.0$/, "")}M`;
  }

  if (rounded >= 10_000) {
    return `${Math.round(rounded / 1_000)}K`;
  }

  if (rounded >= 1_000) {
    const thousands = rounded / 1_000;
    const formatted = (Math.round(thousands * 10) / 10).toFixed(1);
    return `${formatted.replace(/\.0$/, "")}K`;
  }

  return String(rounded);
}

/** Tooltip label for a +/- diff stat pair. */
export function formatDiffStatsLabel(
  additions: number,
  deletions: number
): string {
  const parts: string[] = [];
  if (additions > 0) parts.push(`+${formatStatNumber(additions)}`);
  if (deletions > 0) parts.push(`-${formatStatNumber(deletions)}`);
  return parts.join(" ");
}
