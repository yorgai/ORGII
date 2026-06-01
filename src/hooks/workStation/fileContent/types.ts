import type { EditOperation, EditSource } from "@src/types/editor/document";

export type FileError =
  | { type: "not_found"; message: string }
  | { type: "permission"; message: string }
  | { type: "too_large"; size: number; message: string }
  | { type: "binary"; message: string }
  | { type: "unknown"; message: string };

export interface UseFileContentOptions {
  filePath: string | null;
  autoLoad?: boolean;
}

export interface UseFileContentReturn {
  content: string;
  originalContent: string;
  loading: boolean;
  error: FileError | null;
  isBinary: boolean;
  hasUnsavedChanges: boolean;
  contentReady: boolean;
  version: number;
  diskVersion: number;
  diskMtime: number | null;
  recentEdits: EditOperation[];
  getAIEdits: () => EditOperation[];
  getHumanEdits: () => EditOperation[];
  getExternalEdits: () => EditOperation[];
  reload: () => Promise<void>;
  updateContent: (newContent: string, source: EditSource) => void;
  markSaved: () => void;
  discardChanges: () => void;
}

export interface UnsavedContentCache {
  content: string;
  originalContent: string;
  version: number;
  diskVersion: number;
  recentEdits: EditOperation[];
}
