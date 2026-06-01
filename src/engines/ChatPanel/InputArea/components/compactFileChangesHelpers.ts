/**
 * compactFileChangesHelpers
 *
 * Pure utility functions and types for CompactFileChanges.
 * Extracted to keep the component file under the 600-line limit.
 */
import { getFileName } from "@src/util/file/pathUtils";

// ============================================
// Public types
// ============================================

export interface FileChangeInfo {
  path: string;
  fileName: string;
  status: string;
  additions: number;
  deletions: number;
  lineCount: number;
}

export interface FileChangesResult {
  files: FileChangeInfo[];
  totalAdditions: number;
  totalDeletions: number;
  stats: { added: number; modified: number; deleted: number };
}

// ============================================
// Constants
// ============================================

/** uiCanonical values that represent file-write operations */
export const FILE_EDIT_UI_CANONICALS = new Set(["edit_file", "apply_patch"]);
export const BACKEND_FILE_CHANGES_POLL_INTERVAL_MS = 1_000;
export const BACKEND_FILE_CHANGES_POLL_WINDOW_MS = 120_000;

// ============================================
// Record helpers
// ============================================

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getStringField(
  record: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getNumberField(
  record: Record<string, unknown> | undefined,
  fields: string[]
): number | undefined {
  for (const field of fields) {
    const value = record?.[field];
    if (typeof value === "number") return value;
  }
  return undefined;
}

export function toBackendFileChange(value: unknown): FileChangeInfo | null {
  const record = asRecord(value);
  const path = getStringField(record, "path");
  if (!path) return null;
  const additions = getNumberField(record, ["additions", "linesAdded"]);
  const deletions = getNumberField(record, ["deletions", "linesRemoved"]);
  const lineCount = getNumberField(record, ["lineCount", "count"]);
  return {
    path,
    fileName: getFileName(path),
    status: "M",
    additions: additions ?? 0,
    deletions: deletions ?? 0,
    lineCount: lineCount ?? (additions ?? 0) + (deletions ?? 0),
  };
}
