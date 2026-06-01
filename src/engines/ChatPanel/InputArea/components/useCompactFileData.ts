/**
 * useCompactFileData
 *
 * Derives the visible file list for CompactFileChanges.
 *
 * - Primary source: tool-call events from `sortedEventsAtom` (all agent types
 *   that emit `file_write` / `apply_patch` events).
 * - Fallback source: backend `getSessionFiles` RPC, polled for
 *   BACKEND_FILE_CHANGES_POLL_WINDOW_MS after mount, for CLI sessions that
 *   persist tool chunks without corresponding frontend events.
 *
 * Returns the full `allFiles` list and the subset of `visibleFiles` that
 * haven't been individually accepted/rejected yet.
 */
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { getSessionFiles } from "@src/api/tauri/agent";
import { sortedEventsAtom } from "@src/engines/SessionCore";
import { createLogger } from "@src/hooks/logger";
import { resolvedFilePathsAtom } from "@src/store/session/fileReviewAtom";
import { getFileName } from "@src/util/file/pathUtils";

import {
  BACKEND_FILE_CHANGES_POLL_INTERVAL_MS,
  BACKEND_FILE_CHANGES_POLL_WINDOW_MS,
  FILE_EDIT_UI_CANONICALS,
  type FileChangeInfo,
  type FileChangesResult,
  asRecord,
  getNumberField,
  getStringField,
  toBackendFileChange,
} from "./compactFileChangesHelpers";

const logger = createLogger("CompactFileChanges");

export interface UseCompactFileDataOptions {
  sessionId: string | null;
  initialData?: FileChangesResult;
  pendingCount: number;
  canRedo: boolean;
}

export interface UseCompactFileDataReturn {
  allFiles: FileChangeInfo[];
  visibleFiles: FileChangeInfo[];
  hasCompletedFileWriteEvent: boolean;
}

export function useCompactFileData({
  sessionId,
  initialData,
  pendingCount,
  canRedo,
}: UseCompactFileDataOptions): UseCompactFileDataReturn {
  const events = useAtomValue(sortedEventsAtom);
  const resolvedFiles = useAtomValue(resolvedFilePathsAtom);
  const [backendFileChanges, setBackendFileChanges] =
    useState<FileChangesResult | null>(null);

  // Clear the backend cache when it is no longer needed (pendingCount dropped
  // to 0 and there is nothing to redo). We do this via a separate effect so
  // the reset never fires synchronously inside the data-loading effect body,
  // which would trip `react-hooks/set-state-in-effect`.
  const shouldClearCache = pendingCount === 0 && !canRedo && !initialData;
  useEffect(() => {
    if (shouldClearCache) {
      setBackendFileChanges(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldClearCache]);

  const hasCompletedFileWriteEvent = useMemo(
    () =>
      events.some(
        (event) =>
          event.actionType === "tool_call" &&
          FILE_EDIT_UI_CANONICALS.has(event.uiCanonical) &&
          Boolean(event.result)
      ),
    [events]
  );

  const eventsBasedFiles = useMemo<FileChangeInfo[]>(() => {
    if (initialData) return initialData.files;
    if (pendingCount === 0) return [];

    const fileMap = new Map<string, FileChangeInfo>();
    for (const event of events) {
      if (
        event.actionType !== "tool_call" ||
        !FILE_EDIT_UI_CANONICALS.has(event.uiCanonical)
      )
        continue;

      if (event.uiCanonical === "apply_patch") {
        const patchText = event.args?.patch_text as string | undefined;
        if (!patchText) continue;
        for (const line of patchText.split("\n")) {
          const trimmed = line.trim();
          let filePath: string | undefined;
          let status = "M";
          if (trimmed.startsWith("*** Add File:")) {
            filePath = trimmed.slice("*** Add File:".length).trim();
            status = "A";
          } else if (trimmed.startsWith("*** Update File:")) {
            filePath = trimmed.slice("*** Update File:".length).trim();
            status = "M";
          } else if (trimmed.startsWith("*** Delete File:")) {
            filePath = trimmed.slice("*** Delete File:".length).trim();
            status = "D";
          }
          if (!filePath) continue;
          const fileName = getFileName(filePath);
          if (!fileMap.has(filePath)) {
            fileMap.set(filePath, {
              path: filePath,
              fileName,
              status,
              additions: 0,
              deletions: 0,
              lineCount: 0,
            });
          }
        }
        continue;
      }

      const args = event.args;
      const result = event.result;
      const success = asRecord(result.success);
      const extracted = asRecord(event.extracted);
      const filePath =
        event.filePath ??
        getStringField(extracted, "filePath") ??
        getStringField(args, "file_path") ??
        getStringField(args, "file_name") ??
        getStringField(args, "path") ??
        getStringField(result, "file_path") ??
        getStringField(result, "path") ??
        getStringField(success, "file_path") ??
        getStringField(success, "path");
      if (!filePath) continue;

      const fileName = getFileName(filePath);
      const hasOld =
        !!getStringField(args, "old_string") ||
        !!getStringField(extracted, "oldContent");
      const isDeleted = extracted?.isDeleted === true;
      const status = isDeleted ? "D" : hasOld ? "M" : "A";
      const additions =
        getNumberField(extracted, ["linesAdded"]) ??
        getNumberField(result, ["lines_added", "linesAdded"]) ??
        getNumberField(success, ["lines_added", "linesAdded"]) ??
        0;
      const deletions =
        getNumberField(extracted, ["linesRemoved"]) ??
        getNumberField(result, ["lines_removed", "linesRemoved"]) ??
        getNumberField(success, ["lines_removed", "linesRemoved"]) ??
        0;
      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, {
          path: filePath,
          fileName,
          status,
          additions,
          deletions,
          lineCount: additions + deletions,
        });
      }
    }
    return Array.from(fileMap.values());
  }, [events, initialData, pendingCount]);

  useEffect(() => {
    if (
      initialData ||
      (pendingCount === 0 && !canRedo) ||
      eventsBasedFiles.length > 0 ||
      !sessionId
    ) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    const loadFileChanges = () => {
      getSessionFiles(sessionId)
        .then((records) => {
          if (cancelled) return;
          const files = records
            .map(toBackendFileChange)
            .filter((file): file is FileChangeInfo => file !== null);
          if (files.length > 0) {
            const totalAdditions = files.reduce(
              (sum, file) => sum + file.additions,
              0
            );
            const totalDeletions = files.reduce(
              (sum, file) => sum + file.deletions,
              0
            );
            setBackendFileChanges({
              files,
              totalAdditions,
              totalDeletions,
              stats: { added: 0, modified: files.length, deleted: 0 },
            });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            logger.warn("Failed to load file changes:", err);
          }
        });
    };

    loadFileChanges();
    const intervalId = window.setInterval(() => {
      if (Date.now() - startedAt > BACKEND_FILE_CHANGES_POLL_WINDOW_MS) {
        window.clearInterval(intervalId);
        return;
      }
      loadFileChanges();
    }, BACKEND_FILE_CHANGES_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canRedo, eventsBasedFiles.length, initialData, pendingCount, sessionId]);

  const allFiles =
    eventsBasedFiles.length > 0
      ? eventsBasedFiles
      : (backendFileChanges?.files ?? []);

  const visibleFiles = allFiles.filter((file) => !resolvedFiles.has(file.path));

  return { allFiles, visibleFiles, hasCompletedFileWriteEvent };
}
