/**
 * useEditUserMessage Hook
 *
 * Handles editing a user message in the chat using a linear hard-delete
 * model:
 * 1. Checks whether file changes exist after the target message
 * 2. If so, shows a three-choice dialog (revert / keep / cancel)
 * 3. Sets a truncation guard to prevent sync effects from re-adding events
 * 4. Truncates the event and everything after it from SQLite
 * 5. Splices the event and all subsequent events from the live Rust store
 * 6. Optionally reverts files
 * 7. Re-submits the edited text as a new message
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  CANCEL_REASON,
  cancelSession,
  checkSnapshotChanges,
  truncateAfterMessage,
} from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import useWorkspaceChat from "@src/engines/ChatPanel/hooks/useWorkspaceChat";
import { editTruncationTimestampAtom } from "@src/engines/SessionCore";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { truncateAfterEvent } from "@src/engines/SessionCore/storage/sqliteCache";
import { isSessionActiveAtom } from "@src/store/session/cliSessionStatusAtom";
import {
  clearPendingPlanApproval,
  pendingPlanApprovalsAtom,
} from "@src/store/session/planApprovalAtom";
import { clearTodosForSessionAtom } from "@src/store/ui/todoAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { showRevertConfirm } from "../components/RevertConfirmDialog";

const TRUNCATION_GUARD_CLEAR_DELAY_MS = 500;

export function useEditUserMessage(): (
  chatItem: OptimizedChatItem,
  newText: string,
  imageDataUrls?: string[]
) => Promise<void> {
  const setEditTruncation = useSetAtom(editTruncationTimestampAtom);
  const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom);
  const clearTodosForSession = useSetAtom(clearTodosForSessionAtom);
  const sessionId = useAtomValue(sessionIdAtom);
  const { handleSessChatSubmit } = useWorkspaceChat();
  const { t } = useTranslation("sessions");
  const store = useStore();

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, []);

  return useCallback(
    async (
      chatItem: OptimizedChatItem,
      newText: string,
      imageDataUrls?: string[]
    ) => {
      const initiatedSessionId = sessionId;
      const isStillOnInitiatingSession = (): boolean =>
        store.get(sessionIdAtom) === initiatedSessionId;

      const dbEventId = chatItem.event?.id ?? null;
      const eventId = dbEventId ?? chatItem.chunk_id;
      if (!eventId) return;

      const createdAt = chatItem.event?.createdAt;
      let revertFiles = true;

      if (
        initiatedSessionId &&
        createdAt &&
        (isAgentSession(initiatedSessionId) || isCliSession(initiatedSessionId))
      ) {
        try {
          const hasChanges = await checkSnapshotChanges(
            initiatedSessionId,
            createdAt
          );
          if (!isStillOnInitiatingSession()) return;
          if (hasChanges) {
            const choice = await showRevertConfirm();
            if (!isStillOnInitiatingSession()) return;
            if (choice === "cancel") return;
            revertFiles = choice === "revert";
          }
        } catch (err) {
          console.warn(
            "[useEditUserMessage] checkSnapshotChanges failed, proceeding with revert:",
            err
          );
          Message.warning(t("errors.failedToCheckChanges"));
        }
      }

      if (initiatedSessionId && store.get(isSessionActiveAtom)) {
        try {
          if (isAgentSession(initiatedSessionId)) {
            await cancelSession(initiatedSessionId, CANCEL_REASON.USER_STOP);
          } else if (isCliSession(initiatedSessionId)) {
            await invokeTauri<boolean>("cli_agent_cancel", {
              sessionId: initiatedSessionId,
            });
          }
        } catch (err) {
          console.warn(
            "[useEditUserMessage] cancel before truncate failed:",
            err
          );
        }
        if (!isStillOnInitiatingSession()) return;
      }

      if (createdAt) {
        setEditTruncation(createdAt);
      }
      if (initiatedSessionId) {
        setPendingPlanApprovals((prev) =>
          clearPendingPlanApproval(prev, initiatedSessionId)
        );
        clearTodosForSession(initiatedSessionId);
      }

      if (
        initiatedSessionId &&
        !dbEventId &&
        isAgentSession(initiatedSessionId)
      ) {
        console.error(
          "[useEditUserMessage] dbEventId is null for agent session — SQLite truncate will be skipped. " +
            "The edit will appear to work but history will reappear after reload.",
          {
            sessionId: initiatedSessionId,
            chunkId: chatItem.chunk_id,
          }
        );
      }

      try {
        if (initiatedSessionId) {
          await cancelTurnForTimelineBoundary(initiatedSessionId, "rewind");
        }

        if (
          initiatedSessionId &&
          createdAt &&
          dbEventId &&
          !isCliSession(initiatedSessionId)
        ) {
          await truncateAfterEvent(initiatedSessionId, dbEventId);
        }

        if (initiatedSessionId && createdAt) {
          if (isAgentSession(initiatedSessionId)) {
            await truncateAfterMessage(initiatedSessionId, createdAt, {
              revertFiles,
            });
          } else if (isCliSession(initiatedSessionId)) {
            await invokeTauri<number>("cli_agent_truncate_after_chunk", {
              sessionId: initiatedSessionId,
              createdAt,
              revertFiles,
            });
          }
        }

        if (!isStillOnInitiatingSession()) return;

        await eventStoreProxy.truncateBeforeId(
          eventId,
          initiatedSessionId ?? undefined
        );

        await handleSessChatSubmit(
          undefined,
          newText,
          undefined,
          imageDataUrls && imageDataUrls.length > 0 ? imageDataUrls : undefined,
          { forceDispatch: true }
        );
      } catch (err) {
        console.error(
          "[useEditUserMessage] edit truncate/resubmit failed:",
          err
        );
        Message.error(t("errors.errorOccurred"));
      } finally {
        if (clearTimerRef.current !== null) {
          clearTimeout(clearTimerRef.current);
        }
        clearTimerRef.current = setTimeout(() => {
          setEditTruncation(null);
          clearTimerRef.current = null;
        }, TRUNCATION_GUARD_CLEAR_DELAY_MS);
      }
    },
    [
      setEditTruncation,
      setPendingPlanApprovals,
      clearTodosForSession,
      sessionId,
      handleSessChatSubmit,
      t,
      store,
    ]
  );
}
