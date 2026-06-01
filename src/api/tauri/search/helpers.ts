/**
 * Search Helper Functions
 *
 * Utility functions for search result processing and formatting.
 */
import { getFileExtension, getFileName } from "@src/util/file/pathUtils";

import type { CodeSearchResult, SymbolInfo, SymbolSearchResult } from "./types";

/**
 * Check if code search is available (Tauri context)
 */
export function isCodeSearchAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Get total match count from search results
 */
export function getTotalMatchCount(results: CodeSearchResult[]): number {
  return results.reduce((total, result) => total + result.matches.length, 0);
}

/**
 * Get total symbol count from search results
 */
export function getTotalSymbolCount(results: SymbolSearchResult[]): number {
  return results.reduce((total, result) => total + result.symbols.length, 0);
}

/**
 * Group symbols by kind
 */
export function groupSymbolsByKind(
  symbols: SymbolInfo[]
): Record<string, SymbolInfo[]> {
  return symbols.reduce(
    (groups, symbol) => {
      const kind = symbol.kind;
      if (!groups[kind]) {
        groups[kind] = [];
      }
      groups[kind].push(symbol);
      return groups;
    },
    {} as Record<string, SymbolInfo[]>
  );
}

// Re-export helpers
export { getFileExtension, getFileName };

/**
 * Format file path for display (relative to repo root)
 */
export function formatRelativePath(filePath: string, repoPath: string): string {
  if (filePath.startsWith(repoPath)) {
    return filePath.slice(repoPath.length).replace(/^\//, "");
  }
  return filePath;
}
