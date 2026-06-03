/**
 * useTerminalProcessPoller
 *
 * Polls the Rust backend for the foreground process and live CWD
 * of the currently active terminal session. Updates are written
 * to the terminal session atoms so the sidebar, tab title, and
 * breadcrumb can reflect what's actually running.
 *
 * Only polls the *active* terminal to keep IPC overhead minimal.
 * Polling is paused when:
 * - No sessions exist
 * - The active session is read-only (agent terminal)
 * - The active session doesn't have a PID yet
 */
import { useCallback, useEffect, useRef } from "react";

import type { TerminalSession } from "@src/engines/TerminalCore/types";
import { invokeTauri, isTauriReady } from "@src/util/platform/tauri/init";
import { toBackendPtySessionId } from "@src/util/ui/terminal/ptySessionId";

const POLL_INTERVAL_MS = 2000;

interface ForegroundProcessInfo {
  process_name: string | null;
  pid: number | null;
  cwd: string | null;
}

interface UseTerminalProcessPollerOptions {
  activeSession: TerminalSession | undefined;
  updateSessionInfo: (
    sessionId: string,
    info: Partial<Pick<TerminalSession, "processName" | "liveCwd">>
  ) => void;
}

export function useTerminalProcessPoller({
  activeSession,
  updateSessionInfo,
}: UseTerminalProcessPollerOptions): void {
  const prevProcessNameRef = useRef<string | undefined>();
  const prevLiveCwdRef = useRef<string | undefined>();

  const sessionId = activeSession?.id;
  const sessionPid = activeSession?.pid;
  const sessionReadOnly = activeSession?.readOnly;

  const poll = useCallback(async () => {
    if (!isTauriReady() || !sessionPid || sessionReadOnly || !sessionId) {
      return;
    }

    const ptySessionId = toBackendPtySessionId(sessionId);

    try {
      const info = await invokeTauri<ForegroundProcessInfo>(
        "get_pty_foreground_process",
        { sessionId: ptySessionId }
      );

      const processName = info.process_name ?? undefined;
      const liveCwd = info.cwd ?? undefined;

      const nameChanged = processName !== prevProcessNameRef.current;
      const cwdChanged = liveCwd !== prevLiveCwdRef.current;

      if (nameChanged || cwdChanged) {
        prevProcessNameRef.current = processName;
        prevLiveCwdRef.current = liveCwd;
        updateSessionInfo(sessionId, { processName, liveCwd });
      }
    } catch {
      // Session may have been closed between poll scheduling and execution
    }
  }, [sessionId, sessionPid, sessionReadOnly, updateSessionInfo]);

  useEffect(() => {
    if (!sessionPid || sessionReadOnly) {
      prevProcessNameRef.current = undefined;
      prevLiveCwdRef.current = undefined;
      return;
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [sessionPid, sessionReadOnly, poll]);
}
