/**
 * useFileSearch - File search sub-hook
 *
 * Handles searching files within a repository using native Tauri search.
 * Provides deferred search results for smoother UI during rapid typing.
 */
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useDeferredValue, useRef } from "react";

import type { FileSearchResult } from "@src/store/workstation/codeEditor/file";
import {
  fileClearSearchAtom,
  fileSearchErrorAtom,
  fileSearchLoadingAtom,
  fileSearchQueryAtom,
  fileSearchResultsAtom,
} from "@src/store/workstation/codeEditor/file";
import { searchFilesNative } from "@src/util/platform/tauri/fileSearch";

import { DEFAULT_EXCLUDE_DIRS } from "./helpers";

// ============================================
// Types
// ============================================

export interface UseFileSearchReturn {
  searchQuery: string;
  searchResults: FileSearchResult[];
  searchLoading: boolean;
  searchError: string | null;
  searchFiles: (query: string) => Promise<void>;
  clearSearch: () => void;
}

// ============================================
// Hook
// ============================================

export function useFileSearch(repoPath: string): UseFileSearchReturn {
  // State
  const [searchQuery, setSearchQuery] = useAtom(fileSearchQueryAtom);
  const [searchResults, setSearchResults] = useAtom(fileSearchResultsAtom);
  const [searchLoading, setSearchLoading] = useAtom(fileSearchLoadingAtom);
  const [searchError, setSearchError] = useAtom(fileSearchErrorAtom);
  const clearSearchAtom = useSetAtom(fileClearSearchAtom);

  // Deferred search results for smoother UI during rapid typing
  const deferredSearchResults = useDeferredValue(searchResults);

  // Debounce timer ref to prevent firing IPC on every keystroke
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the first search in a burst has fired (leading edge)
  const hasFiredLeadingRef = useRef(false);

  // ============================================
  // Search files (leading + debounced trailing IPC)
  // ============================================

  /** Debounce delay for subsequent file search IPC calls (ms) */
  const SEARCH_DEBOUNCE_MS = 150;

  /** Execute the actual search IPC call */
  const executeSearch = useCallback(
    async (query: string) => {
      try {
        const results = await searchFilesNative({
          root_path: repoPath,
          query: query.trim(),
          exclude_dirs: DEFAULT_EXCLUDE_DIRS,
        });

        // Combine files and folders
        const allResults: FileSearchResult[] = [
          ...results.files.map((file) => ({
            path: file.path,
            type: "file" as const,
            score: file.score,
            filename: file.filename,
          })),
          ...results.folders.map((folder) => ({
            path: folder.path,
            type: "folder" as const,
            score: folder.score,
            filename: folder.filename,
          })),
        ];

        // Sort by score (highest first)
        allResults.sort((resultA, resultB) => resultB.score - resultA.score);

        setSearchResults(allResults);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to search files";
        setSearchError(errorMessage);
        console.error("[useCodeEditor] Error searching files:", err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [repoPath, setSearchResults, setSearchError, setSearchLoading]
  );

  const searchFiles = useCallback(
    async (query: string) => {
      // Cancel any pending debounced search
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (!query.trim()) {
        setSearchResults([]);
        setSearchQuery("");
        setSearchLoading(false);
        hasFiredLeadingRef.current = false;
        return;
      }

      // Update query immediately for responsive UI
      setSearchQuery(query);
      setSearchLoading(true);
      setSearchError(null);

      // Leading edge: fire first search immediately for instant results
      if (!hasFiredLeadingRef.current) {
        hasFiredLeadingRef.current = true;
        executeSearch(query);
        return;
      }

      // Trailing edge: debounce subsequent searches to avoid IPC spam
      debounceTimerRef.current = setTimeout(() => {
        executeSearch(query);
      }, SEARCH_DEBOUNCE_MS);
    },
    [
      executeSearch,
      setSearchQuery,
      setSearchLoading,
      setSearchError,
      setSearchResults,
    ]
  );

  // ============================================
  // Clear search
  // ============================================

  const clearSearch = useCallback(() => {
    clearSearchAtom();
  }, [clearSearchAtom]);

  return {
    searchQuery,
    searchResults: deferredSearchResults,
    searchLoading,
    searchError,
    searchFiles,
    clearSearch,
  };
}
