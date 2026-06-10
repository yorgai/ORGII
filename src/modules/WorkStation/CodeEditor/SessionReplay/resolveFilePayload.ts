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
    // TEMP DIAG [file-blank] — empty event placeholder, can't rehydrate content
    // eslint-disable-next-line no-console
    console.log("[file-blank] empty-event-placeholder", {
      filePath: op.filePath,
      type: op.type,
      eventId: op.eventId,
      isCurrent: op.isCurrent,
      hasRelatedOps: !!op.relatedOperations?.length,
      relatedEventIds: op.relatedEventIds,
    });
    return { language: op.language };
  }

  const reconverted = convertToFileOperation(op.event, op.isCurrent);
  if (!reconverted) {
    // TEMP DIAG [file-blank] — converter returned null
    // eslint-disable-next-line no-console
    console.log("[file-blank] reconvert-null", {
      filePath: op.filePath,
      type: op.type,
      eventId: op.eventId,
      functionName: (op.event as { functionName?: string })?.functionName,
      eventKeys: Object.keys(op.event as object),
    });
    return { language: op.language };
  }

  // TEMP DIAG [file-blank] — only log when we still can't produce content for a READ
  if (op.type === "read" && reconverted.content === undefined) {
    const ev = op.event as {
      functionName?: string;
      result?: Record<string, unknown>;
      args?: Record<string, unknown>;
      extracted?: unknown;
    };
    // eslint-disable-next-line no-console
    console.log("[file-blank] reconvert-no-content", {
      filePath: op.filePath,
      eventId: op.eventId,
      functionName: ev?.functionName,
      hasResult: !!ev?.result,
      resultKeys: ev?.result ? Object.keys(ev.result) : [],
      hasOutput: !!(ev?.result as { output?: unknown })?.output,
      outputType: typeof (ev?.result as { output?: unknown })?.output,
      outputKeys:
        ev?.result &&
        typeof (ev.result as { output?: unknown }).output === "object"
          ? Object.keys(
              (ev.result as { output?: Record<string, unknown> }).output || {}
            )
          : [],
      hasExtracted: !!ev?.extracted,
    });
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
