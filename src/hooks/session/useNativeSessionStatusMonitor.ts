/**
 * useNativeSessionStatusMonitor
 *
 * Listens for the "session-status-changed" Tauri event emitted by
 * `agent_core/lifecycle.rs` when a native (Rust) session reaches a terminal
 * state (completed / failed / cancelled).
 *
 * The event fires for ALL sessions regardless of which is active in the UI,
 * so this hook keeps `sessionsAtom` current for background sessions that the
 * user is not actively viewing — e.g. sessions launched from another window
 * whose TaskCard status should reflect the live state.
 *
 * This intentionally does NOT trigger toasts or notifications: those are
 * owned by `useBackgroundSessionMonitor` (CLI sessions) and individual
 * session panels. This hook is the minimal "keep the store in sync" layer.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import {
  markTurnRunning,
  markTurnTerminal,
  toTurnTerminalStatus,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { type SessionStatus, updateSessionStatus } from "@src/store/session";
import { isTerminalStatus } from "@src/types/session/session";

interface SessionStatusChangedPayload {
  sessionId: string;
  status: string;
}

export function useNativeSessionStatusMonitor(): void {
  useEffect(() => {
    const unlistenPromise = listen<SessionStatusChangedPayload>(
      "session-status-changed",
      (event) => {
        const { sessionId, status } = event.payload;
        if (isTerminalStatus(status)) {
          markTurnTerminal(sessionId, toTurnTerminalStatus(status));
        } else if (status === "running") {
          markTurnRunning(sessionId);
        }
        updateSessionStatus(sessionId, status as SessionStatus);
      }
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
