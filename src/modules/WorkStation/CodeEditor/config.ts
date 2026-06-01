/**
 * CodeEditor Configuration
 *
 * Configuration constants and icons for the CodeEditor component.
 */
import { FileCode, FolderOpen, Search } from "lucide-react";

// ============================================
// Icon Configuration
// ============================================

export const CODE_EDITOR_ICONS = {
  fileCode: FileCode,
  folderOpen: FolderOpen,
  search: Search,
} as const;

// ============================================
// Default Configuration
// ============================================

export const CODE_EDITOR_CONFIG = {
  // File tree
  defaultTreeWidth: 300,
  minTreeWidth: 200,
  maxTreeWidth: 500,

  // Search
  maxSearchResults: 50,
  searchDebounceMs: 300,

  // Excluded directories
  excludeDirs: [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "target",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    ".DS_Store",
  ],
} as const;
