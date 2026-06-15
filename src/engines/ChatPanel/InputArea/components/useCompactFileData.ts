import { useEffect, useMemo, useState } from "react";

import { getOrgtrackSessionFinalDiffs } from "@src/api/tauri/lineage";
import { createLogger } from "@src/hooks/logger";
import { getFileName } from "@src/util/file/pathUtils";

import type {
  FileChangeInfo,
  FileChangesResult,
} from "./compactFileChangesHelpers";

const logger = createLogger("CompactFileChanges");

export interface UseCompactFileDataOptions {
  sessionId: string | null;
  initialData?: FileChangesResult;
}

export interface UseCompactFileDataReturn {
  allFiles: FileChangeInfo[];
}

export function useCompactFileData({
  sessionId,
  initialData,
}: UseCompactFileDataOptions): UseCompactFileDataReturn {
  const [orgtrackFiles, setOrgtrackFiles] = useState<FileChangeInfo[]>([]);

  useEffect(() => {
    if (initialData || !sessionId) {
      return;
    }

    let cancelled = false;
    void getOrgtrackSessionFinalDiffs({ sessionId })
      .then((finalDiffs) => {
        if (cancelled) return;
        setOrgtrackFiles(
          finalDiffs.map((finalDiff) => ({
            path: finalDiff.filePath,
            fileName: getFileName(finalDiff.filePath),
            status: finalDiff.isDeleted ? "D" : "M",
            additions: finalDiff.linesAdded,
            deletions: finalDiff.linesRemoved,
            lineCount: finalDiff.linesAdded + finalDiff.linesRemoved,
          }))
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          logger.warn("failed to load orgtrack final diffs", {
            err,
            sessionId,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialData, sessionId]);

  const allFiles = useMemo(
    () => initialData?.files ?? (sessionId ? orgtrackFiles : []),
    [initialData?.files, orgtrackFiles, sessionId]
  );

  return { allFiles };
}
