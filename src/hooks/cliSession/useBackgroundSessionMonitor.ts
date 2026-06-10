/**
 * useBackgroundSessionMonitor Hook
 *
 * Listens for WebSocket status changes on background ("fire and forget")
 * CLI sessions and delivers system notifications + in-app toasts when
 * they complete or fail.
 *
 * This hook runs at the app root level (via GlobalSessionSync) so it is
 * always active, regardless of which view the user is on.
 *
 * It complements the cliAdapter sync, which only tracks the *active* session.
 * This hook watches ALL background sessions globally.
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { getCodeEditorWebSocket } from "@src/api/realtime/codeEditorWebSocket";
import {
  notifyError,
  notifyTaskCompletion,
} from "@src/api/services/notification";
import Message from "@src/components/Toast";
import {
  markTurnTerminal,
  toTurnTerminalStatus,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { type SessionStatus, updateSessionStatus } from "@src/store/session";
import { notificationSettingsAtom } from "@src/store/ui/notificationAtom";
import { isTerminalStatus } from "@src/types/session/session";

interface BackgroundStatusMessage {
  type: "code_session.status_changed";
  session_id: string;
  status: string;
  background?: boolean;
  session_name?: string;
  error_message?: string;
  exit_code?: number;
}

export function useBackgroundSessionMonitor(): void {
  const notificationSettings = useAtomValue(notificationSettingsAtom);

  const settingsRef = useRef(notificationSettings);
  useEffect(() => {
    settingsRef.current = notificationSettings;
  }, [notificationSettings]);

  useEffect(() => {
    const wsClient = getCodeEditorWebSocket();
    if (!wsClient) return;

    const unsubscribe = wsClient.on("code_session.status_changed", (raw) => {
      const msg = raw as unknown as BackgroundStatusMessage;

      if (!msg.background) return;
      if (!isTerminalStatus(msg.status)) return;

      const sessionName = msg.session_name || "Background session";

      markTurnTerminal(msg.session_id, toTurnTerminalStatus(msg.status));
      updateSessionStatus(msg.session_id, msg.status as SessionStatus);

      if (msg.status === "completed") {
        notifyTaskCompletion(
          `"${sessionName}" completed — ready for review`,
          settingsRef.current
        );

        Message.success({
          content: `"${sessionName}" completed. Click to review diff.`,
          duration: 0,
          closable: true,
        });
      } else if (msg.status === "failed") {
        const errorDetail = msg.error_message
          ? `: ${msg.error_message.slice(0, 120)}`
          : "";

        notifyError(
          `"${sessionName}" failed${errorDetail}`,
          settingsRef.current
        );

        Message.error({
          content: `"${sessionName}" failed${errorDetail}`,
          duration: 8000,
          closable: true,
        });
      } else if (msg.status === "cancelled") {
        Message.warning({
          content: `"${sessionName}" was cancelled`,
          duration: 5000,
        });
      }
    });

    return unsubscribe;
  }, []);
}
