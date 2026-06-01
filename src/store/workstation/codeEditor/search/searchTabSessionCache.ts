import type { SearchOptions, SearchResultFile } from "./types";

export interface SearchTabSessionState {
  query: string;
  options: SearchOptions;
  results: SearchResultFile[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  actualTotalMatches: number;
  actualTotalFiles: number;
}

const MAX_SEARCH_TAB_SESSIONS = 20;

const DEFAULT_EXCLUDE_DIRS = ["node_modules", ".git", "dist", "build"];

export const DEFAULT_SEARCH_TAB_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  fileExtensions: [],
  excludeDirs: DEFAULT_EXCLUDE_DIRS,
  filesToInclude: "",
  filesToExclude: "",
  onlyOpenFiles: false,
};

const searchTabSessionCache = new Map<string, SearchTabSessionState>();

export function createDefaultSearchTabSessionState(): SearchTabSessionState {
  return {
    query: "",
    options: { ...DEFAULT_SEARCH_TAB_OPTIONS },
    results: [],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    actualTotalMatches: 0,
    actualTotalFiles: 0,
  };
}

export function getSearchTabSessionState(
  sessionId: string
): SearchTabSessionState | undefined {
  return searchTabSessionCache.get(sessionId);
}

export function setSearchTabSessionState(
  sessionId: string,
  state: SearchTabSessionState
): void {
  if (!searchTabSessionCache.has(sessionId)) {
    if (searchTabSessionCache.size >= MAX_SEARCH_TAB_SESSIONS) {
      const oldestSessionId = searchTabSessionCache.keys().next().value;
      if (oldestSessionId) {
        searchTabSessionCache.delete(oldestSessionId);
      }
    }
  }

  searchTabSessionCache.set(sessionId, state);
}

export function deleteSearchTabSessionState(sessionId: string): void {
  searchTabSessionCache.delete(sessionId);
}

export function clearSearchTabSessionStates(): void {
  searchTabSessionCache.clear();
}
