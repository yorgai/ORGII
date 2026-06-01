/**
 * Internal types for useSearchContent sub-hooks
 */
import type { SearchResultFile as StoreSearchResultFile } from "@src/store/workstation/codeEditor/search";

/**
 * Actions exposed by useSearchResults for consumption by useSearchExecution.
 * Provides the state setters needed to manage search results state.
 */
export interface SearchResultActions {
  setResults: (results: StoreSearchResultFile[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setHasMore: (hasMore: boolean) => void;
  setActualTotalMatches: (count: number) => void;
  setActualTotalFiles: (count: number) => void;
  appendResults: (results: StoreSearchResultFile[]) => void;
  clearAtom: () => void;
}
