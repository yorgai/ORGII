/**
 * CodeMirrorEditor Configuration
 *
 * Constants and utility functions for the CodeMirror editor.
 */

// ============================================
// Large File Thresholds
// ============================================

/**
 * Line count thresholds for disabling expensive features
 * These help maintain performance with large files
 */
export const LARGE_FILE_THRESHOLDS = {
  /** Disable minimap above this line count */
  MINIMAP: 1500,
  /** Disable indent guides above this line count */
  INDENT_GUIDES: 5000,
  /** Increase linting debounce / simplify above this line count */
  LINTING_THROTTLE: 3000,
  /** Disable linting entirely above this line count */
  LINTING_DISABLE: 10000,
} as const;

// ============================================
// Utility Functions
// ============================================

/**
 * Calculate line count from content (fast)
 * Uses charCodeAt for performance instead of split()
 */
export function getLineCount(content: string): number {
  if (!content) return 0;
  let count = 1;
  for (let charIndex = 0; charIndex < content.length; charIndex++) {
    if (content.charCodeAt(charIndex) === 10) count++;
  }
  return count;
}

// ============================================
// Selection Extension Constants
// ============================================

/** Minimum characters required for dropdown (avoid triggering on short selections) */
export const MIN_SELECTION_LENGTH = 30;

/** Minimum hold duration (ms) - must hold mouse down for this long while selecting */
export const MIN_HOLD_DURATION_MS = 200;

/** Delay after mouseup before showing dropdown (ms) */
export const SHOW_DELAY_MS = 150;
