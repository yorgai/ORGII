/**
 * Lazily resolves file read/write payloads for session replay.
 *
 * After deduplication, heavy `content` / `oldContent` / `newContent` strings may be
 * stripped from `FileOperationEntry` to save memory; this rehydrates from the
 * original `SessionEvent` via the same conversion path as initial ingest.
 */
import { convertToFileOperation } from "./converters/fileConverter";
import type { FileOperationEntry } from "./types";

export interface ResolvedFilePayload {
  content?: string;
  oldContent?: string;
  newContent?: string;
  diff?: string;
  oldStartLine?: number;
  newStartLine?: number;
  language?: string;
}

function isEmptyEventPlaceholder(event: FileOperationEntry["event"]): boolean {
  return !event || Object.keys(event as object).length === 0;
}

/**
 * Returns inline payload if present; otherwise re-extracts from `op.event`.
 */
export function resolveFileOperationPayload(
  op: FileOperationEntry
): ResolvedFilePayload {
  if (
    op.content !== undefined ||
    op.oldContent !== undefined ||
    op.newContent !== undefined ||
    op.diff !== undefined
  ) {
    return {
      content: op.content,
      oldContent: op.oldContent,
      newContent: op.newContent,
      diff: op.diff,
      oldStartLine: op.oldStartLine,
      newStartLine: op.newStartLine,
      language: op.language,
    };
  }

  if (isEmptyEventPlaceholder(op.event)) {
    return { language: op.language };
  }

  const reconverted = convertToFileOperation(op.event, op.isCurrent);
  if (!reconverted) {
    return { language: op.language };
  }

  return {
    content: reconverted.content,
    oldContent: reconverted.oldContent,
    newContent: reconverted.newContent,
    diff: reconverted.diff,
    oldStartLine: reconverted.oldStartLine,
    newStartLine: reconverted.newStartLine,
    language: reconverted.language ?? op.language,
  };
}
