/**
 * Document State Types
 *
 * VSCode-style document versioning with edit source attribution.
 * Enables AI vs human tracking, LSP sync, and conflict detection.
 *
 * Created: 2026-01-21
 */

// ============================================
// Edit Source Attribution
// ============================================

/**
 * Tracks the source of each edit operation
 */
export type EditSource =
  | { type: "human" }
  | { type: "ai"; model: string; sessionId: string }
  | { type: "external" } // Git checkout, other editors, build tools
  | { type: "reload" }; // File reload from disk

// ============================================
// Edit Operation
// ============================================

/**
 * Individual edit operation with attribution and versioning
 */
export interface EditOperation {
  /** Unique ID for this edit */
  id: string;

  /** Range affected by the edit */
  range: {
    from: number;
    to: number;
  };

  /** New text inserted */
  newText: string;

  /** Source of the edit */
  source: EditSource;

  /** Timestamp when edit occurred */
  timestamp: number;

  /** Document version after this edit was applied */
  versionAfter: number;
}

// ============================================
// Document State
// ============================================

/**
 * Complete document state with versioning and edit history
 */
export interface DocumentState {
  // Versioning (VSCode-style)
  /** Monotonically increasing version number (LSP-compatible) */
  version: number;

  /** Version when last saved/loaded from disk */
  diskVersion: number;

  // Content
  /** Current document content */
  content: string;

  /** File path on disk */
  filePath: string;

  // State flags
  /** Whether there are unsaved changes (version !== diskVersion) */
  isDirty: boolean;

  /** Whether disk file has changed since load */
  isStale: boolean;

  // Edit attribution (rolling window)
  /** Recent edits for attribution tracking (last 100) */
  recentEdits: EditOperation[];
}

// ============================================
// Helper Functions
// ============================================

/**
 * Filter edits by source type
 */
export function filterEditsBySource(
  edits: EditOperation[],
  sourceType: EditSource["type"]
): EditOperation[] {
  return edits.filter((edit) => edit.source.type === sourceType);
}

/**
 * Get AI-sourced edits
 */
export function getAIEdits(edits: EditOperation[]): EditOperation[] {
  return filterEditsBySource(edits, "ai");
}

/**
 * Get human-sourced edits
 */
export function getHumanEdits(edits: EditOperation[]): EditOperation[] {
  return filterEditsBySource(edits, "human");
}

/**
 * Get external edits (git, other editors)
 */
export function getExternalEdits(edits: EditOperation[]): EditOperation[] {
  return filterEditsBySource(edits, "external");
}

/**
 * Calculate AI vs human contribution percentage
 */
export function calculateContributionPercentage(edits: EditOperation[]): {
  ai: number;
  human: number;
  external: number;
} {
  if (edits.length === 0) {
    return { ai: 0, human: 0, external: 0 };
  }

  const aiCount = getAIEdits(edits).length;
  const humanCount = getHumanEdits(edits).length;
  const externalCount = getExternalEdits(edits).length;
  const total = edits.length;

  return {
    ai: (aiCount / total) * 100,
    human: (humanCount / total) * 100,
    external: (externalCount / total) * 100,
  };
}

/**
 * Create a new edit operation
 */
export function createEditOperation(
  range: { from: number; to: number },
  newText: string,
  source: EditSource,
  versionAfter: number
): EditOperation {
  return {
    id: crypto.randomUUID(),
    range,
    newText,
    source,
    timestamp: Date.now(),
    versionAfter,
  };
}
