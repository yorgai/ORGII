/**
 * useFilterState Hook
 *
 * Manages filter state for different EditorPrimarySidebar tabs.
 *
 * Hybrid search approach
 * - Instant: Client-side tree filtering provides immediate feedback
 * - Comprehensive: Server search (debounced) finds files in unexpanded directories
 * - Unified: Uses same searchFilesNative as Spotlight for consistent results
 *
 * Results are displayed as a tree (not flat list) via buildTreeFromSearchResults.
 */
import { useCallback, useState } from "react";

import {
  DEBOUNCE_DELAYS,
  useDebouncedCallback,
} from "@src/hooks/perf/useDebouncedCallback";

import type { ExplorerViewMode, FilterState } from "../types";

export interface UseFilterStateOptions {
  viewMode: ExplorerViewMode;
  /** Called to clear server search results */
  onClearSearch?: () => void;
  /** Called to trigger server search (comprehensive, finds unexpanded files) */
  onFilterSearch?: (query: string) => void;
}

export function useFilterState({
  viewMode,
  onClearSearch,
  onFilterSearch,
}: UseFilterStateOptions): FilterState {
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilterFiles, setShowFilterFiles] = useState(false);
  const [showFilterSourceControl, setShowFilterSourceControl] = useState(false);

  // Debounced server search — client-side filter shows instantly
  const debouncedServerSearch = useDebouncedCallback((query: string) => {
    onFilterSearch?.(query);
  }, DEBOUNCE_DELAYS.SEARCH);

  // Handle filter toggle for Files tab
  const handleToggleFilterFiles = useCallback(() => {
    setShowFilterFiles((prev) => {
      if (prev) {
        // Clear filter when hiding
        setFilterQuery("");
        onClearSearch?.();
      }
      return !prev;
    });
  }, [onClearSearch]);

  // Handle filter toggle for Source Control tab
  const handleToggleFilterSourceControl = useCallback(() => {
    setShowFilterSourceControl((prev) => !prev);
  }, []);

  // Handle filter change - hybrid approach:
  // 1. Update state immediately (client-side filter is instant)
  // 2. Debounce server search for comprehensive results
  const handleFilterChange = useCallback(
    (query: string) => {
      // Update UI immediately for responsive input
      setFilterQuery(query);

      if (viewMode === "files") {
        if (query.trim().length === 0) {
          // Clear search immediately when input is empty
          debouncedServerSearch.cancel();
          onClearSearch?.();
        } else {
          // Debounce server search - client-side filter shows instantly
          debouncedServerSearch(query);
        }
      }
    },
    [viewMode, onClearSearch, debouncedServerSearch]
  );

  return {
    filterQuery,
    showFilterFiles,
    showFilterSourceControl,
    handleToggleFilterFiles,
    handleToggleFilterSourceControl,
    handleFilterChange,
  };
}
