import React, { useCallback, useEffect, useRef, useState } from "react";

import { getSessionFiles } from "@src/api/tauri/agent";

import {
  type SessionFileChange,
  type SessionFilesCache,
  TERMINAL_STATUS,
} from "../types";

interface UseSessionFilesOptions {
  sessionId: string;
  displayStatus: string;
  isActive: boolean;
  isTerminal: boolean;
  filesCache: React.MutableRefObject<SessionFilesCache>;
}

const POLL_INTERVAL_MS = 5_000;

export function useSessionFiles(options: UseSessionFilesOptions) {
  const { sessionId, displayStatus, isActive, isTerminal, filesCache } =
    options;

  const [sessionFiles, setSessionFiles] = useState<SessionFileChange[] | null>(
    () => filesCache.current.get(sessionId) ?? null
  );
  const [filesLoading, setFilesLoading] = useState(false);

  const loadSessionFiles = useCallback(async () => {
    const cached = filesCache.current.get(sessionId);
    if (cached) {
      setSessionFiles(cached);
      return;
    }
    setFilesLoading(true);
    try {
      const files = (await getSessionFiles(
        sessionId
      )) as unknown as SessionFileChange[];
      if (TERMINAL_STATUS.has(displayStatus)) {
        filesCache.current.set(sessionId, files);
      }
      setSessionFiles(files);
    } catch {
      setSessionFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [sessionId, displayStatus, filesCache]);

  const filesPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isTerminal || !isActive) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await loadSessionFiles();
      if (!cancelled) {
        filesPollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (filesPollRef.current) clearTimeout(filesPollRef.current);
    };
  }, [isActive, isTerminal, loadSessionFiles]);

  return { sessionFiles, filesLoading, loadSessionFiles };
}
