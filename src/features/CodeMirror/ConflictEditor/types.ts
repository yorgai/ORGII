/**
 * CodeMirrorConflictEditor Types
 *
 * Type definitions for the conflict resolution editor.
 */

export type ConflictResolutionChoice = "current" | "incoming" | "both";

/**
 * A parsed conflict block from the file
 */
export interface ConflictBlock {
  /** Unique identifier for this conflict */
  id: string;
  /** Start line in the document (0-based) */
  startLine: number;
  /** End line in the document (0-based, inclusive) */
  endLine: number;
  /** Line number of the <<<<<<< marker */
  markerStartLine: number;
  /** Line number of the ======= separator */
  separatorLine: number;
  /** Line number of the >>>>>>> marker */
  markerEndLine: number;
  /** The current (HEAD/ours) content lines */
  currentContent: string;
  /** The incoming (theirs) content lines */
  incomingContent: string;
  /** Label from <<<<<<< marker (e.g., "HEAD" or branch name) */
  currentLabel: string;
  /** Label from >>>>>>> marker (e.g., branch name) */
  incomingLabel: string;
  /** Whether this conflict has been resolved */
  resolved: boolean;
  /** The resolution choice if resolved */
  resolutionChoice?: ConflictResolutionChoice;
}

/**
 * Props for the CodeMirrorConflictEditor component
 */
export interface CodeMirrorConflictEditorProps {
  /** File content with conflict markers */
  content: string;
  /** File path for syntax highlighting */
  filePath?: string;
  /** Programming language override */
  language?: string;
  /** Read-only mode (no editing, only resolution actions) */
  readOnly?: boolean;
  /** Callback when content changes (via editing or resolution) */
  onChange?: (content: string) => void;
  /** Callback when a conflict is resolved */
  onResolveConflict?: (
    conflictId: string,
    choice: ConflictResolutionChoice
  ) => void;
  /** Custom height */
  height?: string;
  /** Custom class name */
  className?: string;
  /** Currently focused conflict index (for keyboard navigation) */
  focusedConflictIndex?: number;
  /** Callback when focused conflict changes */
  onFocusConflictChange?: (index: number) => void;
}

/**
 * Return type for useConflictMarkers hook
 */
export interface UseConflictMarkersResult {
  /** Parsed conflict blocks */
  conflicts: ConflictBlock[];
  /** Whether the content has any unresolved conflicts */
  hasConflicts: boolean;
  /** Total number of conflicts */
  conflictCount: number;
  /** Number of resolved conflicts */
  resolvedCount: number;
  /** Apply a resolution to a conflict */
  resolveConflict: (
    conflictId: string,
    choice: ConflictResolutionChoice
  ) => string;
  /** Get content with a specific conflict resolved */
  getResolvedContent: (
    content: string,
    conflictId: string,
    choice: ConflictResolutionChoice
  ) => string;
}
