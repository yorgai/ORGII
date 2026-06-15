import type { OrgtrackSessionFinalDiff } from "@src/api/tauri/lineage";

import { FILE_OPERATION_TYPE, type FileOperationEntry } from "./types";

export function finalDiffToFileOperation(
  finalDiff: OrgtrackSessionFinalDiff,
  isCurrent = false
): FileOperationEntry {
  const filePathParts = finalDiff.filePath.split("/");
  const fileName = filePathParts.at(-1) ?? finalDiff.filePath;
  return {
    filePath: finalDiff.filePath,
    fileName,
    directory: filePathParts.slice(0, -1).join("/") || "/",
    type: FILE_OPERATION_TYPE.WRITE,
    timestamp: new Date(finalDiff.computedAt),
    status: "completed",
    event: {},
    eventId: finalDiff.finalEventId ?? finalDiff.recordId,
    language: "text",
    oldContent: finalDiff.oldContent,
    newContent: finalDiff.newContent,
    diff: finalDiff.diff,
    linesAdded: finalDiff.linesAdded,
    linesRemoved: finalDiff.linesRemoved,
    isCurrent,
    relatedEventIds: [finalDiff.baselineEventId, finalDiff.finalEventId].filter(
      (eventId): eventId is string => Boolean(eventId)
    ),
    editCount: 1,
  };
}

export function finalDiffsToFileOperations(
  finalDiffs: OrgtrackSessionFinalDiff[]
): FileOperationEntry[] {
  return finalDiffs.map((finalDiff) => finalDiffToFileOperation(finalDiff));
}
