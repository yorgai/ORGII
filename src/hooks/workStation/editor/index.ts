/**
 * Editor-specific hooks for WorkStation
 *
 * These hooks are specific to the CodeEditor (code editor).
 */
export { useCodeEditorEvents } from "./useCodeEditorEvents";
export type { CodeEditorEventsOptions } from "./useCodeEditorEvents";

export { useCodeEditorHandlers } from "./useCodeEditorHandlers";
export { useFileContent } from "./useFileContent";
export type {
  FileError,
  UseFileContentOptions,
  UseFileContentReturn,
} from "./useFileContent";
export {
  clearFileCache,
  clearUnsavedContentCache,
  invalidateFileCache,
  onExternalFileChange,
  subscribeToFileChanges,
  updateCachedFileMtime,
} from "./useFileContent";
export { useOpenEditorFiles } from "./useOpenEditorFiles";
export type { UseOpenEditorFilesResult } from "./useOpenEditorFiles";
