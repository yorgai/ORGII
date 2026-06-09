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
