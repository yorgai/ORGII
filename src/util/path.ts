/**
 * Cross-platform path utilities for display use.
 * These functions are for UI labelling only — not for fs operations.
 */

/**
 * Returns the last path segment, stripping any trailing slashes.
 * Works for both POSIX and Windows paths.
 */
export function basename(path: string | undefined): string {
  if (!path) return "";
  const trimmed = path.replace(/[\\/]+$/u, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
