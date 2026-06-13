import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import {
  getBinaryFileMessage,
  isBinaryByExtension,
  isBinaryContent,
} from "@src/util/file/binaryDetection";

const logger = createLogger("AgentStationLiveRead");

type LiveReadFileContentStatus = "idle" | "loading" | "loaded" | "failed";

interface LiveReadFileContentState {
  content: string | undefined;
  status: LiveReadFileContentStatus;
}

interface LoadedLiveReadFileContent {
  filePath: string;
  content: string | undefined;
  status: Exclude<LiveReadFileContentStatus, "idle" | "loading">;
}

export function useLiveReadFileContent(
  filePath: string | undefined,
  enabled: boolean
): LiveReadFileContentState {
  const [loadedContent, setLoadedContent] =
    useState<LoadedLiveReadFileContent | null>(null);

  useEffect(() => {
    if (!enabled || !filePath) return;

    const currentFilePath = filePath;
    let cancelled = false;

    async function loadFileContent() {
      if (isBinaryByExtension(currentFilePath)) {
        if (!cancelled) {
          setLoadedContent({
            filePath: currentFilePath,
            content: getBinaryFileMessage(),
            status: "loaded",
          });
        }
        return;
      }

      const fileContent = await readTextFile(currentFilePath);
      if (cancelled) return;

      setLoadedContent({
        filePath: currentFilePath,
        content: isBinaryContent(fileContent)
          ? getBinaryFileMessage()
          : fileContent,
        status: "loaded",
      });
    }

    loadFileContent().catch((error: unknown) => {
      if (!cancelled) {
        logger.rateLimited("local-read-failed", 60_000, "local read failed", {
          filePath: currentFilePath,
          error,
        });
        setLoadedContent({
          filePath: currentFilePath,
          content: undefined,
          status: "failed",
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, filePath]);

  return useMemo(() => {
    if (!enabled || !filePath) {
      return { content: undefined, status: "idle" };
    }

    if (loadedContent?.filePath !== filePath) {
      return { content: undefined, status: "loading" };
    }

    return {
      content: loadedContent.content,
      status: loadedContent.status,
    };
  }, [enabled, filePath, loadedContent]);
}
