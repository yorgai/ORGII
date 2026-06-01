/**
 * Flexible matching for settings-table toolbar search.
 * Handles spaces vs underscores in identifiers (e.g. "await output" → await_output).
 */
export function matchesTableSearchText(
  haystack: string,
  query: string
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const normalizedHaystack = haystack.toLowerCase();
  if (normalizedHaystack.includes(normalizedQuery)) return true;

  const queryAsIdentifier = normalizedQuery.replace(/\s+/g, "_");
  if (normalizedHaystack.includes(queryAsIdentifier)) return true;

  const haystackAsWords = normalizedHaystack.replace(/_/g, " ");
  if (haystackAsWords.includes(normalizedQuery)) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    return tokens.every(
      (token) =>
        normalizedHaystack.includes(token) ||
        normalizedHaystack.includes(token.replace(/\s+/g, "_"))
    );
  }

  return false;
}
