/**
 * AIActionVisualizer Config
 *
 * Configuration constants for AI action visualization.
 */

export const AI_VISUALIZER_CONFIG = {
  /** Default delay before action executes (ms) - wait for cursor animation */
  defaultVisualDelay: 1000,

  /** How long to show highlight after action completes (ms) */
  highlightLingerDuration: 500,

  /** Cursor animation duration (ms) */
  cursorAnimationDuration: 800,

  /** Toast display duration (ms) */
  toastDuration: 2000,

  /** Whether to show cursor by default */
  showCursorByDefault: true,

  /** Whether to show toast by default */
  showToastByDefault: true,

  /** Z-index for the visualizer overlay */
  zIndex: 99999,

  /** Padding around highlight ring (px) */
  highlightPadding: 4,

  /** Border radius for highlight ring (px) */
  highlightBorderRadius: 8,
} as const;
