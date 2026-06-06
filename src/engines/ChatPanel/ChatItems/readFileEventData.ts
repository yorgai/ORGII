import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  FILE_NAME_PAYLOAD_KEYS,
  extractFilePathFromPayloads,
} from "@src/util/file/filePathPayload";
import { getFileName as getFileNameFromPath } from "@src/util/file/pathUtils";

function getResultPayloads(event: SessionEvent): Record<string, unknown>[] {
  const result = event.result;
  if (!result) return [];

  const successData = result.success as Record<string, unknown> | undefined;
  const outputSuccess = (result.output as Record<string, unknown> | undefined)
    ?.success as Record<string, unknown> | undefined;

  return [result, successData, outputSuccess].filter(
    (payload): payload is Record<string, unknown> => Boolean(payload)
  );
}

export function getReadFilePath(event: SessionEvent): string {
  if (event.extracted?.kind === "file" && event.extracted.filePath) {
    return event.extracted.filePath;
  }

  if (event.filePath) return event.filePath;

  return extractFilePathFromPayloads(
    [event.args, ...getResultPayloads(event)],
    FILE_NAME_PAYLOAD_KEYS
  );
}

export function getReadFileName(event: SessionEvent): string {
  const filePath = getReadFilePath(event);
  if (filePath) return getFileNameFromPath(filePath);
  return "unknown";
}

export function getReadFilePathSummary(
  events: readonly SessionEvent[],
  visibleCount = 3
): string {
  const paths = events.map(getReadFilePath).filter(Boolean);
  if (paths.length === 0) return "unknown";

  const visible = paths.slice(0, visibleCount).join(" · ");
  const remainingCount = paths.length - visibleCount;
  return remainingCount > 0 ? `${visible} +${remainingCount}` : visible;
}
