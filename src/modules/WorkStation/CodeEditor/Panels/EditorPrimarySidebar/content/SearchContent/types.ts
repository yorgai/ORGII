/**
 * SearchContent Types
 *
 * Types for the repository search panel component
 */

// Re-export SearchMode from shared component
export type { SearchMode } from "../../../shared/SearchModeSelect";

export interface SearchMatch {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  text: string;
  context_before: string;
  context_after: string;
}

export interface SearchResultFile {
  file_path: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  /** Case sensitive search */
  caseSensitive: boolean;
  /** Match whole word only */
  wholeWord: boolean;
  /** Use regex pattern */
  useRegex: boolean;
  /** File extensions to include (e.g., [".ts", ".tsx"]) */
  fileExtensions: string[];
  /** Directories to exclude */
  excludeDirs: string[];
  /** Maximum number of results */
  maxResults: number;
  /** Offset for pagination */
  offset?: number;
  /** Files to include (glob patterns) */
  filesToInclude?: string;
  /** Files to exclude (glob patterns) */
  filesToExclude?: string;
  /** Only search in open files */
  onlyOpenFiles?: boolean;
}

/** Handle for SearchContent to expose collapse method */
export interface SearchContentHandle {
  /** Collapse all search result file headers */
  collapseAll: () => void;
}

export interface SearchContentProps {
  /** Repository path to search in */
  repoPath: string;
  /** Callback when a search result is clicked */
  onResultClick: (filePath: string, line: number) => void;
  /** List of open file paths (for "Only search in open files" feature) */
  openFiles?: string[];
  /** Whether to show filters section */
  showFilters?: boolean;
  /** Callback to open search in a main tab (shown when search is empty) */
  onOpenInTab?: () => void;
}
