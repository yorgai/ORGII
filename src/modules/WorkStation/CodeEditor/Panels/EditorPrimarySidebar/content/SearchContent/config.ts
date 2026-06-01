/**
 * RepoSearchPanel Configuration
 */
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Regex,
  Search,
  WholeWord,
  X,
} from "lucide-react";

export const ICON_CONFIG = {
  search: Search,
  caseSensitive: CaseSensitive,
  wholeWord: WholeWord,
  regex: Regex,
  refresh: RefreshCw,
  clear: X,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
} as const;

export const SEARCH_CONSTANTS = {
  /** Debounce delay for search input (ms) - VSCode uses 150ms */
  DEBOUNCE_MS: 150,
  /** Maximum total results to allow (VS Code uses 20000) */
  MAX_TOTAL_RESULTS: 20000,
  /** Initial max results for first search (aligned with VSCode-style ceiling) */
  INITIAL_MAX_RESULTS: 20000,
  /** Batch size for incremental loading (number of files) */
  BATCH_SIZE: 50,
  /** Warning threshold - show warning when results exceed this */
  WARNING_THRESHOLD: 3000,
  /** Scroll threshold for infinite scroll (px from bottom) */
  SCROLL_THRESHOLD: 300,
  /** Icon size for toolbar buttons */
  ICON_SIZE: 14,
  /** Default file extensions to search */
  DEFAULT_EXTENSIONS: [".ts", ".tsx", ".js", ".jsx", ".json", ".md"],
  /** Default directories to exclude */
  DEFAULT_EXCLUDE_DIRS: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
    "coverage",
  ],
} as const;
