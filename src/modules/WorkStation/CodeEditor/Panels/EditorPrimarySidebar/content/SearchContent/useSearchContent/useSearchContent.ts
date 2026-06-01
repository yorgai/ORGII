/**
 * useSearchContent Hook
 *
 * Main orchestrator hook for repository search.
 * Composes useSearchQuery, useSearchResults, and useSearchExecution.
 *
 * Performance optimizations (Jan 2025):
 * - Uses streaming search for progressive results
 * - Parallel file walking via `ignore` crate
 * - Reduced debounce and batch sizes
 */
import { useCallback } from "react";

import type { SearchMode, SearchOptions, SearchResultFile } from "../types";
import { useSearchExecution } from "./useSearchExecution";
import { useSearchQuery } from "./useSearchQuery";
import { useSearchResults } from "./useSearchResults";

export interface UseRepoSearchPanelOptions {
  /** Repository path to search in */
  repoPath: string;
  /** List of open file paths (for "Only search in open files" feature) */
  openFiles?: string[];
  /** Search mode - determines which backend to use */
  searchMode?: SearchMode;
}

export interface UseRepoSearchPanelReturn {
  /** Search query */
  query: string;
  /** Set search query */
  setQuery: (query: string) => void;
  /** Search options */
  options: SearchOptions;
  /** Update search options */
  setOptions: (options: Partial<SearchOptions>) => void;
  /** Search results */
  results: SearchResultFile[];
  /** Loading state */
  loading: boolean;
  /** Loading more results */
  loadingMore: boolean;
  /** Error message */
  error: string | null;
  /** Perform search */
  search: () => Promise<void>;
  /** Load more results */
  loadMore: () => Promise<void>;
  /** Clear results */
  clearResults: () => void;
  /** Total number of matches across all files */
  totalMatches: number;
  /** Total number of files with matches */
  totalFiles: number;
  /** Actual total results available (may be more than loaded) */
  actualTotalMatches: number;
  /** Actual total files available (may be more than loaded) */
  actualTotalFiles: number;
  /** Whether there are more results to load */
  hasMore: boolean;
  /** Whether results were truncated */
  isTruncated: boolean;
}

export function useSearchContent(
  opts: UseRepoSearchPanelOptions
): UseRepoSearchPanelReturn {
  // Default to regex mode (fast ripgrep search) if not specified
  const searchMode = opts.searchMode ?? "regex";

  // Query + options state
  const { query, setQuery, options, setOptions, storeOptions } =
    useSearchQuery();

  // Results state + load more + clear
  const {
    results,
    loading,
    loadingMore,
    error,
    hasMore,
    totalMatches,
    totalFiles,
    actualTotalMatches,
    actualTotalFiles,
    isTruncated,
    clearResults,
    loadMore: loadMoreInternal,
    actions,
  } = useSearchResults();

  // Search execution + debounced trigger + cleanup
  const { search } = useSearchExecution({
    query,
    searchMode,
    repoPath: opts.repoPath,
    openFiles: opts.openFiles,
    storeOptions,
    resultActions: actions,
  });

  // Wrap loadMore to bind required params from query state
  const loadMore = useCallback(async () => {
    await loadMoreInternal(query, opts.repoPath, storeOptions);
  }, [loadMoreInternal, query, opts.repoPath, storeOptions]);

  return {
    query,
    setQuery,
    options,
    setOptions,
    results,
    loading,
    loadingMore,
    error,
    search,
    loadMore,
    clearResults,
    totalMatches,
    totalFiles,
    actualTotalMatches,
    actualTotalFiles,
    hasMore,
    isTruncated,
  };
}
