/**
 * CodeMirror Feature Module
 *
 * Exports all CodeMirror-based editor components for WorkStation.
 */

// Editor component
export { CodeMirrorEditor, default as CodeMirrorEditorDefault } from "./Editor";
export type {
  CodeMirrorEditorProps,
  CursorPosition,
  TextSelectionInfo,
} from "./Editor";

// Diff component
export { CodeMirrorDiff, default as CodeMirrorDiffDefault } from "./Diff";
export type { CodeMirrorDiffProps } from "./Diff";

// ConflictEditor component
export {
  CodeMirrorConflictEditor,
  default as CodeMirrorConflictEditorDefault,
  useConflictMarkers,
  parseConflictBlocks,
  hasConflictMarkers,
} from "./ConflictEditor";
export type {
  CodeMirrorConflictEditorProps,
  ConflictBlock,
  ConflictResolutionChoice,
  UseConflictMarkersResult,
} from "./ConflictEditor";

// SqlEditor component
export { SqlQueryEditor, default as SqlQueryEditorDefault } from "./SqlEditor";
export type { SqlQueryEditorProps } from "./SqlEditor";
export { QueryResults } from "./SqlEditor/QueryResults";
export type { QueryResultsProps } from "./SqlEditor/QueryResults";

// Shared config
export {
  createCodeMirrorTheme,
  getCodeMirrorTheme,
  customFoldGutter,
  editorHistoryKeymapExtension,
  foldPlaceholderTheme,
  goToLineExtension,
  indentGuidesExtension,
  minimapExtension,
  findReplaceExtension,
  dirtyDiffGutter,
  BASIC_SETUP_CONFIG,
  BASIC_SETUP_SQL_CONFIG,
  CODE_FONT_FAMILY,
  CODE_FONT_SIZE,
  CODE_FONT_SIZE_SMALL,
  CODE_LINE_HEIGHT,
} from "./config";
export type { DiffLineType } from "./config";

// Shared language utilities
export {
  getLanguageExtension,
  getLanguageExtensionSync,
  getLanguageKey,
  loadLanguageExtension,
  EXT_TO_LANG_MAP,
} from "./shared/languageExtensions";
