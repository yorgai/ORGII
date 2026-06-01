/**
 * Connectivity Page Utilities
 */

/** Split comma-separated string into trimmed, non-empty array */
export const parseCommaSeparated = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
