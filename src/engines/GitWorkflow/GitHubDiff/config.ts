/**
 * GitHubDiff Configuration
 *
 * Centralized configuration for the diff component
 */

// ============================================
// Icon Configuration (using Lucide icons)
// ============================================

export const ICON_CONFIG = {
  add: "Plus",
  remove: "Minus",
  expand: "ChevronDown",
  collapse: "ChevronRight",
  copy: "Copy",
  settings: "Settings",
} as const;

// ============================================
// Style Constants
// ============================================

export const STYLE_CONFIG = {
  /** Line height in pixels */
  lineHeight: 20,
  /** Gutter width for line numbers */
  gutterWidth: 50,
  /** Indicator width for +/- icons */
  indicatorWidth: 24,
  /** Minimum collapsed lines to show collapse button */
  minCollapsibleLines: 4,
  /** Default context lines */
  defaultContextLines: 3,
} as const;

// ============================================
// Color Configuration
// ============================================

export const COLORS = {
  // Addition colors
  addBackground: "rgba(35, 134, 54, 0.15)",
  addBackgroundHighlight: "rgba(35, 134, 54, 0.25)",
  addGutter: "rgba(35, 134, 54, 0.3)",
  addText: "#3fb950",
  addIndicator: "#3fb950",

  // Deletion colors
  removeBackground: "rgba(248, 81, 73, 0.15)",
  removeBackgroundHighlight: "rgba(248, 81, 73, 0.25)",
  removeGutter: "rgba(248, 81, 73, 0.3)",
  removeText: "#f85149",
  removeIndicator: "#f85149",

  // Context colors
  contextBackground: "transparent",
  contextText: "var(--color-text-1)",
  contextGutter: "var(--color-text-3)",

  // Hunk header colors
  hunkHeaderBackground: "rgba(56, 139, 253, 0.1)",
  hunkHeaderText: "var(--color-primary-6)",
  hunkHeaderBorder: "rgba(56, 139, 253, 0.2)",

  // General
  lineNumber: "var(--color-text-3)",
  divider: "var(--color-border-2)",
  emptyCell: "var(--color-bg-3)",
} as const;

// LANGUAGE_MAP removed — now using consolidated @src/config/languageMap

/**
 * Calculate gutter width based on max line number
 */
export function calculateGutterWidth(maxLineNumber: number): number {
  const digits = String(maxLineNumber).length;
  return Math.max(STYLE_CONFIG.gutterWidth, digits * 10 + 16);
}

/**
 * Format line number with padding
 */
export function formatLineNumber(
  lineNumber: number | undefined,
  maxWidth: number
): string {
  if (lineNumber === undefined) return "";
  return String(lineNumber).padStart(maxWidth, " ");
}

// ============================================
// Default Values
// ============================================

export const DEFAULT_PROPS = {
  viewMode: "unified" as const,
  contextLines: 3,
  showLineNumbers: true,
  syntaxHighlighting: true,
  readOnly: true,
  hideWhitespaceChanges: false,
  showHunkHeaders: true,
};
