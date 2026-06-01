/**
 * GitHubDiff Exports
 *
 * Centralized exports for the GitHubDiff component
 */

// Main component
export { GitHubDiff, default } from "./index";

// Sub-components
export {
  CollapsedSection,
  SplitDiffRowComponent,
  UnifiedDiffRow,
} from "./DiffRow";

// Types
export type {
  DiffHunk,
  DiffHunkHeader,
  DiffLine,
  DiffLineType,
  DiffRowProps,
  DiffType,
  DiffViewMode,
  FileDiff,
  GitHubDiffProps,
  SplitDiffCell,
  SplitDiffRow,
  SplitDiffRowProps,
  UseDiffOptions,
  UseDiffReturn,
} from "./types";

// Configuration and utilities
export {
  calculateGutterWidth,
  COLORS,
  DEFAULT_PROPS,
  formatLineNumber,
  ICON_CONFIG,
  STYLE_CONFIG,
} from "./config";

// Language map (from consolidated source)
export { getLanguageFromPath, LANGUAGE_MAP } from "@src/config/languageMap";
