/**
 * SearchService - Singleton Search Operations Service
 *
 * Provides codebase search capabilities shared by both AI and UI.
 * Uses shared Jotai atoms so both AI commands and UI see the same state.
 *
 * Usage:
 *   import { SearchService } from "@src/services/search";
 *   await SearchService.searchCodebase("TODO", { caseSensitive: true });
 */
import { invoke } from "@tauri-apps/api/core";

import { createLogger } from "@src/hooks/logger";
import { PanelService } from "@src/services/panel";
import {
  type SearchOptions,
  type SearchResultFile,
  searchActualTotalFilesAtom,
  searchActualTotalMatchesAtom,
  searchClearAtom,
  searchErrorAtom,
  searchHasMoreAtom,
  searchLoadingAtom,
  searchOptionsAtom,
  searchQueryAtom,
  searchResultsAtom,
  searchSetOptionsAtom,
} from "@src/store/workstation/codeEditor/search";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const log = createLogger("SearchService");

// ============================================
// Jotai Store Access (uses app's instrumented store)
// ============================================

const getStore = () => getInstrumentedStore();

// ============================================
// SearchService - Singleton API
// ============================================

export const SearchService = {
  /**
   * Search the codebase for text/pattern
   */
  async searchCodebase(
    query: string,
    repoPath: string,
    options?: Partial<SearchOptions>
  ): Promise<SearchResultFile[]> {
    const store = getStore();
    if (!query.trim()) {
      store.set(searchClearAtom);
      return [];
    }

    // Update state
    store.set(searchQueryAtom, query);
    if (options) {
      store.set(searchSetOptionsAtom, options);
    }
    store.set(searchLoadingAtom, true);
    store.set(searchErrorAtom, null);
    store.set(searchResultsAtom, []);

    // Show search panel
    PanelService.showPrimarySidebar("search");

    const currentOptions = store.get(searchOptionsAtom);

    try {
      const results = await invoke<SearchResultFile[]>("search_code_regex", {
        query,
        repoPaths: [repoPath],
        filters: {
          case_sensitive: currentOptions.caseSensitive,
          whole_word: currentOptions.wholeWord,
          use_regex: currentOptions.useRegex,
          file_extensions:
            currentOptions.fileExtensions.length > 0
              ? currentOptions.fileExtensions
              : undefined,
          exclude_dirs: currentOptions.excludeDirs,
          max_results: 1000,
        },
      });

      // Results are already in correct format (file_path, snake_case matches)
      store.set(searchResultsAtom, results);
      store.set(searchHasMoreAtom, false); // Full search, no pagination
      store.set(searchActualTotalFilesAtom, results.length);
      store.set(
        searchActualTotalMatchesAtom,
        results.reduce((sum, f) => sum + f.matches.length, 0)
      );
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed";
      store.set(searchErrorAtom, message);
      log.error("[SearchService] Search failed:", error);
      return [];
    } finally {
      store.set(searchLoadingAtom, false);
    }
  },

  /**
   * Search for files by name
   * TODO: Implement quick file search (Cmd+P style)
   */
  async searchFiles(_query: string): Promise<string[]> {
    return [];
  },

  /**
   * Search for symbols (functions, classes, etc.)
   * TODO: Implement symbol search
   */
  async searchSymbols(_query: string): Promise<unknown[]> {
    return [];
  },

  /**
   * Set search query (updates UI)
   */
  setQuery(query: string): void {
    getStore().set(searchQueryAtom, query);
  },

  /**
   * Set search options
   */
  setOptions(options: Partial<SearchOptions>): void {
    getStore().set(searchSetOptionsAtom, options);
  },

  /**
   * Clear search results
   */
  clear(): void {
    getStore().set(searchClearAtom);
  },

  /**
   * Get current query
   */
  getQuery(): string {
    return getStore().get(searchQueryAtom);
  },

  /**
   * Get current results
   */
  getResults(): SearchResultFile[] {
    return getStore().get(searchResultsAtom);
  },
};
