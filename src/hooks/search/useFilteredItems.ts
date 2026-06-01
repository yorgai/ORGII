/**
 * useFilteredItems Hook
 *
 * Generic filtering hook for any list-based UI.
 * Filters items based on search query using simple string matching.
 *
 * @example
 * const { filteredItems, isFiltering } = useFilteredItems({
 *   items: repos,
 *   searchQuery: query,
 *   getSearchText: (repo) => repo.name,
 * });
 */
import { useMemo } from "react";

import { normalizedIncludes } from "@src/util/search/fuzzy";

// ============ TYPES ============

export interface UseFilteredItemsOptions<T> {
  /** Items to filter */
  items: T[];
  /** Search query */
  searchQuery: string;
  /** Function to get searchable text from item */
  getSearchText: (item: T) => string;
  /** Minimum score threshold (default: 0) */
  minScore?: number;
}

export interface UseFilteredItemsReturn<T> {
  /** Filtered items sorted by relevance */
  filteredItems: T[];
  /** Whether filtering is active */
  isFiltering: boolean;
}

// ============ HELPERS ============

const SEPARATOR_RE = /[\s\-_.]+/g;

function normalizeSeparators(text: string): string {
  return text.replace(SEPARATOR_RE, " ");
}

function scoreMatch(text: string, query: string): number {
  if (text === query) return 1;
  if (text.startsWith(query)) return 0.8;
  if (text.includes(query)) return 0.5;

  if (normalizedIncludes(text, query)) {
    const normText = normalizeSeparators(text);
    const normQuery = normalizeSeparators(query);
    if (normText === normQuery) return 0.95;
    if (normText.startsWith(normQuery)) return 0.75;
    return 0.45;
  }

  const normQuery = normalizeSeparators(query);
  const normText = normalizeSeparators(text);
  const queryTokens = normQuery.split(" ").filter(Boolean);
  if (
    queryTokens.length > 1 &&
    queryTokens.every((tok) => normText.includes(tok))
  ) {
    return 0.35;
  }

  return 0;
}

// ============ HOOK IMPLEMENTATION ============

/**
 * Filters items based on search query with separator-aware matching.
 *
 * Treats spaces, dashes, dots, and underscores as equivalent separators
 * so "gpt 5.2" matches "gpt-5.2-pro", "claude 3" matches "claude-3-opus", etc.
 *
 * Scoring:
 * - Exact match: 1.0
 * - Exact match (normalized): 0.95
 * - Starts with query: 0.8
 * - Starts with (normalized): 0.75
 * - Contains query: 0.5
 * - Contains (normalized): 0.45
 * - All query tokens present: 0.35
 * - No match: 0 (filtered out)
 */
export function useFilteredItems<T>(
  options: UseFilteredItemsOptions<T>
): UseFilteredItemsReturn<T> {
  const { items, searchQuery, getSearchText, minScore = 0 } = options;

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;

    const queryLower = searchQuery.toLowerCase();
    const scored = items
      .map((item) => {
        const text = getSearchText(item).toLowerCase();
        const score = scoreMatch(text, queryLower);
        return { item, score };
      })
      .filter((scored) => scored.score > minScore);

    scored.sort((a, b) => b.score - a.score);

    return scored.map((scored) => scored.item);
  }, [items, searchQuery, getSearchText, minScore]);

  return {
    filteredItems,
    isFiltering: !!searchQuery,
  };
}

export default useFilteredItems;
