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
  maxVisible = 3
): string | undefined {
  const paths = events.map(getReadFilePath).filter((path) => path.length > 0);
  if (paths.length === 0) return undefined;

  const visiblePaths = paths.slice(0, maxVisible);
  const hiddenCount = paths.length - visiblePaths.length;
  const suffix = hiddenCount > 0 ? ` +${hiddenCount}` : "";
  return `${visiblePaths.join(" · ")}${suffix}`;
}
