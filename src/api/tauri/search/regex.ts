/**
 * Regex Search API
 *
 * Regex-based code search: batch, streaming, and fast (ripgrep-core) variants.
 */
import { rpc } from "@src/api/tauri/rpc";

import type { CodeSearchResult, SearchFilters } from "./types";

export async function searchCodeRegex(
  query: string,
  repoPaths: string[],
  filters?: SearchFilters
): Promise<CodeSearchResult[]> {
  return rpc.searchRegex.search({
    query,
    repoPaths,
    filters,
  }) as Promise<CodeSearchResult[]>;
}

/**
 * Start streaming code search - results are emitted via Tauri events.
 * Listen for 'search-result' and 'search-complete' events.
 */
export async function searchCodeStreaming(
  searchId: string,
  query: string,
  repoPath: string,
  filters?: SearchFilters
): Promise<void> {
  return rpc.searchRegex.startStreaming({
    searchId,
    query,
    repoPath,
    filters,
  });
}

/**
 * Cancel an in-progress search.
 * Returns true if the search was found and cancelled, false otherwise.
 */
export async function cancelSearch(searchId: string): Promise<boolean> {
  return rpc.searchRegex.cancel({ searchId });
}

/**
 * Fast search using grep-searcher (ripgrep core).
 * Uses memory-mapped files and SIMD-accelerated search for 5-10x speedup.
 */
export async function searchCodeFast(
  searchId: string,
  query: string,
  repoPath: string,
  filters?: SearchFilters
): Promise<void> {
  return rpc.searchRegex.startFast({
    searchId,
    query,
    repoPath,
    filters,
  });
}

/**
 * Clear search result cache.
 * Should be called when files change.
 */
export async function clearSearchCache(): Promise<void> {
  return rpc.searchRegex.clearCache();
}
