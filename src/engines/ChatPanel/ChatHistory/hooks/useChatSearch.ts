/**
 * useChatSearch Hook
 *
 * Full-text search across chat history using the Rust EventStore.
 * The heavy search computation (text extraction, matching, snippet creation)
 * runs in Rust via Tauri IPC, avoiding O(N) JS string scanning.
 *
 * Features:
 * - Debounced search input
 * - Highlighted snippets (from Rust)
 * - Navigation to matched events
 * - Case-sensitive / regex / whole-word modes
 *
 * Usage:
 * ```tsx
 * const {
 *   query, setQuery,
 *   results,
 *   isSearching,
 *   currentResultIndex,
 *   navigateToResult,
 *   nextResult, prevResult,
 *   clearSearch
 * } = useChatSearch({ chatHistory, onNavigateToEvent });
 * ```
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { useDebouncedCallback } from "@src/hooks/perf";

// ============================================
// Types
// ============================================

export interface SearchResult {
  /** The matched event */
  item: SessionEvent;
  /** Index in the original chatHistory array */
  index: number;
  /** Search relevance score (lower = better match) */
  score: number;
  /** Text snippet with match highlighted */
  snippet: string;
}

interface RustSearchResult {
  eventId: string;
  chatIndex: number;
  score: number;
  snippet: string;
}

export interface UseChatSearchOptions {
  /** Chat events to search within */
  chatHistory: SessionEvent[];
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Max results to return (default: 100) */
  maxResults?: number;
  /** Callback when navigating to a result (includes search query for fallback navigation) */
  onNavigateToEvent?: (
    eventId: string,
    index: number,
    searchQuery: string
  ) => void;
}

export interface UseChatSearchReturn {
  /** Current search query */
  query: string;
  /** Set search query */
  setQuery: (query: string) => void;
  /** Search results */
  results: SearchResult[];
  /** Whether search is in progress */
  isSearching: boolean;
  /** Whether search is active (has query) */
  isSearchActive: boolean;
  /** Current highlighted result index */
  currentResultIndex: number;
  /** Total result count */
  resultCount: number;
  /** Navigate to a specific result */
  navigateToResult: (index: number) => void;
  /** Navigate to next result */
  nextResult: () => void;
  /** Navigate to previous result */
  prevResult: () => void;
  /** Clear search and results */
  clearSearch: () => void;
  /** Get the event ID for a result index */
  getResultEventId: (index: number) => string | null;
  /** Whether case-sensitive matching is enabled */
  caseSensitive: boolean;
  /** Toggle case-sensitive matching */
  toggleCaseSensitive: () => void;
  /** Whether regex matching is enabled */
  useRegex: boolean;
  /** Toggle regex matching */
  toggleRegex: () => void;
  /** Whether whole-word matching is enabled */
  wholeWord: boolean;
  /** Toggle whole-word matching */
  toggleWholeWord: () => void;
}

// ============================================
// SessionEvent index by event id (for Rust → TS mapping)
// ============================================

function buildChunkIdIndex(chatHistory: SessionEvent[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let idx = 0; idx < chatHistory.length; idx++) {
    const eventId = chatHistory[idx].id;
    if (eventId) {
      index.set(eventId, idx);
    }
  }
  return index;
}

// ============================================
// Hook Implementation
// ============================================

export function useChatSearch(
  options: UseChatSearchOptions
): UseChatSearchReturn {
  const {
    chatHistory,
    debounceMs = 150,
    maxResults = 100,
    onNavigateToEvent,
  } = options;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const searchIdRef = useRef(0);

  const performSearch = useCallback(
    async (
      searchQuery: string,
      isCaseSensitive: boolean = caseSensitive,
      isRegex: boolean = useRegex,
      isWholeWord: boolean = wholeWord
    ) => {
      const trimmedQuery = searchQuery.trim();

      if (!trimmedQuery || chatHistory.length === 0) {
        setResults([]);
        setCurrentResultIndex(0);
        return;
      }

      setIsSearching(true);
      const currentSearchId = ++searchIdRef.current;

      try {
        const rustResults = await invoke<RustSearchResult[]>(
          "es_search_chat_events",
          {
            options: {
              query: trimmedQuery,
              caseSensitive: isCaseSensitive,
              useRegex: isRegex,
              wholeWord: isWholeWord,
              maxResults,
            },
          }
        );

        if (currentSearchId !== searchIdRef.current) return;

        const chunkIndex = buildChunkIdIndex(chatHistory);
        const searchResults: SearchResult[] = [];

        for (const rustResult of rustResults) {
          const historyIndex = chunkIndex.get(rustResult.eventId);
          if (historyIndex !== undefined) {
            searchResults.push({
              item: chatHistory[historyIndex],
              index: historyIndex,
              score: rustResult.score,
              snippet: rustResult.snippet,
            });
          }
        }

        if (currentSearchId !== searchIdRef.current) return;

        setResults(searchResults);
        setCurrentResultIndex(0);
        setIsSearching(false);

        if (searchResults.length > 0 && onNavigateToEvent) {
          const firstResult = searchResults[0];
          onNavigateToEvent(
            firstResult.item.id || "",
            firstResult.index,
            trimmedQuery
          );
        }
      } catch {
        if (currentSearchId !== searchIdRef.current) return;
        setResults([]);
        setCurrentResultIndex(0);
        setIsSearching(false);
      }
    },
    [
      chatHistory,
      maxResults,
      onNavigateToEvent,
      caseSensitive,
      useRegex,
      wholeWord,
    ]
  );

  const debouncedPerformSearch = useDebouncedCallback(
    (q: string) => performSearch(q),
    debounceMs
  );

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      if (!newQuery.trim()) {
        debouncedPerformSearch.cancel();
        setResults([]);
        setCurrentResultIndex(0);
        return;
      }

      debouncedPerformSearch(newQuery);
    },
    [debouncedPerformSearch]
  );

  const navigateToResult = useCallback(
    (resultIndex: number) => {
      if (resultIndex < 0 || resultIndex >= results.length) return;

      setCurrentResultIndex(resultIndex);
      const result = results[resultIndex];
      if (result && onNavigateToEvent) {
        onNavigateToEvent(
          result.item.id || "",
          result.index,
          query.trim().toLowerCase()
        );
      }
    },
    [results, onNavigateToEvent, query]
  );

  const nextResult = useCallback(() => {
    if (results.length === 0) return;
    const nextIndex = (currentResultIndex + 1) % results.length;
    navigateToResult(nextIndex);
  }, [currentResultIndex, results.length, navigateToResult]);

  const prevResult = useCallback(() => {
    if (results.length === 0) return;
    const prevIndex =
      currentResultIndex === 0 ? results.length - 1 : currentResultIndex - 1;
    navigateToResult(prevIndex);
  }, [currentResultIndex, results.length, navigateToResult]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setCurrentResultIndex(0);
    searchIdRef.current++;
    debouncedPerformSearch.cancel();
  }, [debouncedPerformSearch]);

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => {
      const next = !prev;
      if (query.trim()) performSearch(query, next, useRegex, wholeWord);
      return next;
    });
  }, [query, performSearch, useRegex, wholeWord]);

  const toggleRegex = useCallback(() => {
    setUseRegex((prev) => {
      const next = !prev;
      if (query.trim()) performSearch(query, caseSensitive, next, wholeWord);
      return next;
    });
  }, [query, performSearch, caseSensitive, wholeWord]);

  const toggleWholeWord = useCallback(() => {
    setWholeWord((prev) => {
      const next = !prev;
      if (query.trim()) performSearch(query, caseSensitive, useRegex, next);
      return next;
    });
  }, [query, performSearch, caseSensitive, useRegex]);

  const getResultEventId = useCallback(
    (index: number): string | null => {
      if (index < 0 || index >= results.length) return null;
      return results[index].item.id || null;
    },
    [results]
  );

  return {
    query,
    setQuery: handleQueryChange,
    results,
    isSearching,
    isSearchActive: query.trim().length > 0,
    currentResultIndex,
    resultCount: results.length,
    navigateToResult,
    nextResult,
    prevResult,
    clearSearch,
    getResultEventId,
    caseSensitive,
    toggleCaseSensitive,
    useRegex,
    toggleRegex,
    wholeWord,
    toggleWholeWord,
  };
}

export default useChatSearch;
