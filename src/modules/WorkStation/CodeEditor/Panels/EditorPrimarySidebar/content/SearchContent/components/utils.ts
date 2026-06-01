/**
 * Search Result Utilities
 */
import type { SearchMatch } from "./types";

/**
 * Truncate and highlight search match in context
 * Shows ...before [match] after... with smart truncation
 *
 * The backend sends same-line context (content before/after the match on the same line).
 * This function handles truncation for display, ensuring the match stays visible.
 *
 * @param maxLength - Target max characters. Default 50 fits ~250px at 12px font.
 *                    CSS truncate handles any overflow as a safeguard.
 */
export function formatMatchLine(
  contextBefore: string,
  matchText: string,
  contextAfter: string,
  maxLength: number = 50
): { before: string; match: string; after: string; truncated: boolean } {
  // Trim leading whitespace from before context (indentation)
  const trimmedBefore = contextBefore.trimStart();
  const hadLeadingWhitespace = trimmedBefore.length < contextBefore.length;

  const totalLength =
    trimmedBefore.length + matchText.length + contextAfter.length;

  // If fits within max length, return (with ellipsis if whitespace was trimmed)
  if (totalLength <= maxLength) {
    return {
      before: (hadLeadingWhitespace ? "..." : "") + trimmedBefore,
      match: matchText,
      after: contextAfter,
      truncated: hadLeadingWhitespace,
    };
  }

  // Calculate available space for context (reserve space for match and ellipsis)
  const matchLength = matchText.length;
  const ellipsisLength = 3; // "..."
  const availableForContext = Math.max(
    0,
    maxLength - matchLength - ellipsisLength * 2
  );

  // Split: 60% before, 40% after (we read left-to-right, before context helps identify location)
  const contextBeforeTarget = Math.floor(availableForContext * 0.6);
  const contextAfterTarget = availableForContext - contextBeforeTarget;

  // Truncate context before (from the left, keep the part closest to match)
  let truncatedBefore = trimmedBefore;
  let needsEllipsisBefore = hadLeadingWhitespace;
  if (trimmedBefore.length > contextBeforeTarget) {
    truncatedBefore = trimmedBefore.slice(-contextBeforeTarget);
    needsEllipsisBefore = true;
  }

  // Truncate context after (from the right, keep the part closest to match)
  let truncatedAfter = contextAfter;
  let needsEllipsisAfter = false;
  if (contextAfter.length > contextAfterTarget) {
    truncatedAfter = contextAfter.slice(0, contextAfterTarget);
    needsEllipsisAfter = true;
  }

  return {
    before: (needsEllipsisBefore ? "..." : "") + truncatedBefore,
    match: matchText,
    after: truncatedAfter + (needsEllipsisAfter ? "..." : ""),
    truncated: needsEllipsisBefore || needsEllipsisAfter,
  };
}

/**
 * Format a SearchMatch for display with robust highlight extraction.
 *
 * Some backends return `match.text` as the full source line, while others return only
 * the matched fragment. Prefer context_before/context_after when present; otherwise
 * derive before/match/after from 1-indexed column/end_column ranges.
 */
export function formatSearchMatch(
  searchMatch: SearchMatch,
  maxLength: number = 50
): { before: string; match: string; after: string; truncated: boolean } {
  const hasExplicitContext =
    searchMatch.context_before.length > 0 ||
    searchMatch.context_after.length > 0;
  if (hasExplicitContext) {
    return formatMatchLine(
      searchMatch.context_before,
      searchMatch.text,
      searchMatch.context_after,
      maxLength
    );
  }

  const fullLineText = searchMatch.text;
  const startIndex = Math.max(0, searchMatch.column - 1);
  const endCol =
    searchMatch.end_column ?? searchMatch.column + fullLineText.length;
  const endIndex = Math.max(startIndex, endCol - 1);

  // If ranges are valid against the line, split line into before/match/after.
  if (endIndex <= fullLineText.length && endIndex > startIndex) {
    const before = fullLineText.slice(0, startIndex);
    const match = fullLineText.slice(startIndex, endIndex);
    const after = fullLineText.slice(endIndex);
    return formatMatchLine(before, match, after, maxLength);
  }

  // Fallback: highlight the provided text as-is.
  return formatMatchLine("", fullLineText, "", maxLength);
}
