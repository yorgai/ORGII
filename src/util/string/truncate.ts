/**
 * Truncate a string to at most `max` visible characters, appending an ellipsis
 * when the string is longer.
 *
 * The total length of the returned string is at most `max` characters
 * (the ellipsis takes the place of the last character when truncation occurs).
 *
 * @param text  The string to truncate.
 * @param max   Maximum length (including the ellipsis). Must be ≥ 1.
 * @param opts.ellipsis  Override the ellipsis character (default: `"…"` U+2026).
 * @param opts.collapseNewlines  When `true`, newlines are replaced with spaces
 *   and the result is trimmed before measuring. Useful for single-line previews
 *   of multi-line content (e.g. tool-call summaries). Default: `false`.
 */
export function truncate(
  text: string,
  max: number,
  opts: {
    ellipsis?: string;
    collapseNewlines?: boolean;
  } = {}
): string {
  const { ellipsis = "…", collapseNewlines = false } = opts;

  const normalized = collapseNewlines ? text.replace(/\n/g, " ").trim() : text;

  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - ellipsis.length) + ellipsis;
}
