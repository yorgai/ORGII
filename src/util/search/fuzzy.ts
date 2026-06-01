/**
 * Fuzzy Matching Utilities
 *
 * Extracted for reuse across Spotlight, ContextMenu, and agent input autocomplete.
 * Matches substrings in order (e.g., "orgii" matches "orgii_frontend").
 */

/** Normalize separators (space, dash, dot, underscore) so they match interchangeably */
const SEPARATOR_RE = /[\s\-_.]+/g;

export function normalizedIncludes(text: string, query: string): boolean {
  return text
    .replace(SEPARATOR_RE, " ")
    .includes(query.replace(SEPARATOR_RE, " "));
}

/** Simple fuzzy match - checks if all characters in query appear in name in order */
export function fuzzyMatch(query: string, name: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  const lowerName = name.toLowerCase();

  let queryIdx = 0;
  for (let nameIdx = 0; nameIdx < lowerName.length; nameIdx++) {
    if (lowerName[nameIdx] === lowerQuery[queryIdx]) {
      queryIdx++;
      if (queryIdx === lowerQuery.length) return true;
    }
  }
  return false;
}

/** Score a fuzzy match - higher is better */
export function fuzzyScore(query: string, name: string): number {
  if (!query) return 0;
  const lowerQuery = query.toLowerCase();
  const lowerName = name.toLowerCase();

  // Exact match gets highest score
  if (lowerName === lowerQuery) return 1000;

  // Starts with gets high score
  if (lowerName.startsWith(lowerQuery)) return 500;

  // Contains gets medium score
  if (lowerName.includes(lowerQuery)) return 200;

  // Fuzzy match scoring based on character positions
  let score = 0;
  let queryIdx = 0;
  let prevMatchIdx = -2;

  for (let nameIdx = 0; nameIdx < lowerName.length; nameIdx++) {
    if (
      queryIdx < lowerQuery.length &&
      lowerName[nameIdx] === lowerQuery[queryIdx]
    ) {
      score += 10;
      // Consecutive matches get bonus
      if (nameIdx === prevMatchIdx + 1) {
        score += 5;
      }
      // Start-of-word matches get bonus (after _, -, or uppercase boundary)
      if (
        nameIdx === 0 ||
        name[nameIdx - 1] === "_" ||
        name[nameIdx - 1] === "-" ||
        (name[nameIdx] === name[nameIdx].toUpperCase() &&
          name[nameIdx - 1] === name[nameIdx - 1].toLowerCase())
      ) {
        score += 3;
      }
      prevMatchIdx = nameIdx;
      queryIdx++;
    }
  }

  return score;
}
