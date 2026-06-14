/**
 * useRestoreCheckpoint Hook
 *
 * Restores the session to a previous checkpoint WITHOUT re-sending a message
 * (Cursor-style "restore to checkpoint"). This is the same destructive
 * truncate path as `useEditUserMessage`, MINUS the final re-dispatch:
 *
 * 1. Checks whether file changes exist after the target message
 * 2. If so, shows a three-choice dialog (revert / keep / cancel)
 * 3. Sets a truncation guard to prevent sync effects from re-adding events
 * 4. Truncates the event and everything after it from SQLite
 * 5. Splices the event and all subsequent events from the live Rust store
 * 6. Optionally reverts files
 * 7. Leaves the turn at idle — the session sits at the checkpoint, no resend
 *
 * Message-side restore is destructive (no message-side redo); the file-side
 * snapshot store keeps its own redo path via Undo All / Redo All.
 */
import { useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  checkSnapshotChanges,
  truncateAfterMessage,
} from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import { editTruncationTimestampAtom } from "@src/engines/SessionCore";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { deleteSession as deleteCachedSession } from "@src/engines/SessionCore/storage/cacheAdapter";
import { createLogger } from "@src/hooks/logger";
import {
  clearPendingPlanApproval,
  pendingPlanApprovalsAtom,
} from "@src/store/session/planApprovalAtom";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { clearTodosForSessionAtom } from "@src/store/ui/todoAtom";
import { invokeTauri } from "@src/util/platform/tauri/init";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { showRevertConfirm } from "../components/RevertConfirmDialog";

const log = createLogger("useRestoreCheckpoint");

const TRUNCATION_GUARD_CLEAR_DELAY_MS = 500;
const USER_MESSAGE_EVENT_ID_PREFIX = "user-message-";

function agentMessageIdFromUserEventId(eventId: string): string | undefined {
  return eventId.startsWith(USER_MESSAGE_EVENT_ID_PREFIX)
    ? eventId.slice(USER_MESSAGE_EVENT_ID_PREFIX.length)
    : undefined;
}

export function useRestoreCheckpoint(): (
  chatItem: OptimizedChatItem
) => Promise<void> {
  const setEditTruncation = useSetAtom(editTruncationTimestampAtom);
  const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom);
  const clearTodosForSession = useSetAtom(clearTodosForSessionAtom);
  const store = useStore();
  const resolveCurrentSessionId = useCallback(
    () => store.get(activeSessionIdAtom) ?? store.get(sessionIdAtom),
    [store]
  );
  const { t } = useTranslation("sessions");

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
    async (chatItem: OptimizedChatItem) => {
      const initiatedSessionId = resolveCurrentSessionId();
      const isStillOnInitiatingSession = (): boolean => {
        if (!initiatedSessionId) return false;
        const activeSessionId = store.get(activeSessionIdAtom);
        if (activeSessionId) return activeSessionId === initiatedSessionId;
        return store.get(sessionIdAtom) === initiatedSessionId;
      };

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
          log.warn(
            "[useRestoreCheckpoint] checkSnapshotChanges failed, proceeding with revert:",
            err
          );
          Message.warning(t("errors.failedToCheckChanges"));
        }
      }

      if (
        initiatedSessionId &&
        !dbEventId &&
        isAgentSession(initiatedSessionId)
      ) {
        log.error(
          "[useRestoreCheckpoint] dbEventId is null for agent session — SQLite truncate will be skipped. " +
            "The restore will appear to work but history will reappear after reload.",
          {
            sessionId: initiatedSessionId,
            chunkId: chatItem.chunk_id,
          }
        );
      }

      try {
        if (createdAt) {
          setEditTruncation(createdAt);
        }
        // Land the turn FSM at idle and leave it there: unlike edit-resend,
        // restore has no follow-up dispatch, so we must NOT flip back to an
        // optimistic running state — the session rests at the checkpoint.
        if (initiatedSessionId) {
          await cancelTurnForTimelineBoundary(initiatedSessionId, "rewind");
        }

        await eventStoreProxy.truncateBeforeId(
          eventId,
          initiatedSessionId ?? undefined
        );

        if (initiatedSessionId && createdAt) {
          if (isAgentSession(initiatedSessionId)) {
            await truncateAfterMessage(initiatedSessionId, createdAt, {
              revertFiles,
              messageId: agentMessageIdFromUserEventId(eventId),
            });
          } else if (isCliSession(initiatedSessionId)) {
            await invokeTauri<number>("cli_agent_truncate_after_chunk", {
              sessionId: initiatedSessionId,
              createdAt,
              revertFiles,
            });
          }
          // Purge the Rust EventStore and the session-persistence cache so
          // that after a browser reload the session reloads from the
          // authoritative SQLite source (agent_messages for agent sessions,
          // code_session_chunks for CLI sessions) rather than from stale cached
          // events that predate the restore. Unlike edit-resend, restore does
          // NOT re-dispatch a turn, so there is no fresh event stream to
          // overwrite the stale tail — the eviction is what makes the truncated
          // checkpoint stick across reload.
          //
          // Order matters: evict the live Rust store FIRST, then delete the
          // frontend cache LAST. Running them concurrently raced — eviction
          // could flush the still-resident pre-restore turn back into the
          // session-persistence cache after deleteCachedSession had already
          // run, leaving a stale turn-index/events row that a fresh reload
          // then rehydrated into an inconsistent (often empty) live store.
          await eventStoreProxy
            .evictSession(initiatedSessionId)
            .catch((err) =>
              log.warn(
                "[useRestoreCheckpoint] evictSession failed (non-fatal):",
                err
              )
            );
          await deleteCachedSession(initiatedSessionId).catch((err) =>
            log.warn(
              "[useRestoreCheckpoint] deleteSession failed (non-fatal):",
              err
            )
          );
        }

        if (initiatedSessionId) {
          setPendingPlanApprovals((prev) =>
            clearPendingPlanApproval(prev, initiatedSessionId)
          );
          clearTodosForSession(initiatedSessionId);
        }
      } catch (err) {
        log.error("[useRestoreCheckpoint] restore truncate failed:", err);
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
      resolveCurrentSessionId,
      t,
      store,
    ]
  );
}
