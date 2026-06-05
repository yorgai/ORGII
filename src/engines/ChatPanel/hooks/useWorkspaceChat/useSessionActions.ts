/**
 * useSessionActions
 *
 * Encapsulates session resume and interrupt logic via the dispatch registry.
 */
import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { CANCEL_REASON } from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import {
  clearSessionAtom,
  pendingSyntheticEventAtom,
} from "@src/engines/SessionCore/core/atoms";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createLogger } from "@src/hooks/logger";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  isPendingCancelAtom,
  lastUserMessageAtom,
  restoreToInputAtom,
  sessionRolledBackAtom,
  sessionRuntimeStatusAtom,
  streamRetryStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  dequeueMessageAtom,
  messageQueueAtom,
} from "@src/store/ui/messageQueueAtom";

const logger = createLogger("UseSessionActions");

interface UseSessionActionsOptions {
  getSessionId: () => string | null;
}

export function useSessionActions(options: UseSessionActionsOptions) {
  const { getSessionId } = options;
  const { t } = useTranslation("sessions");
  const store = useStore();
  const setPendingCancel = useSetAtom(isPendingCancelAtom);
  const setUserInitiatedCancel = useSetAtom(userInitiatedCancelAtom);
  const setRestoreToInput = useSetAtom(restoreToInputAtom);
  const dispatchClearSession = useSetAtom(clearSessionAtom);
  const setPendingSyntheticEvent = useSetAtom(pendingSyntheticEventAtom);
  const setSessionRolledBack = useSetAtom(sessionRolledBackAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setWorkstationActiveSessionId = useSetAtom(
    workstationActiveSessionIdAtom
  );
  const dequeueMessage = useSetAtom(dequeueMessageAtom);
  const setSessionRuntimeStatus = useSetAtom(sessionRuntimeStatusAtom);
  const setStreamRetryStatus = useSetAtom(streamRetryStatusAtom);

  const resumeSession = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) {
      Message.error(t("errors.noSessionIdFound"));
      return;
    }

    try {
      await SessionService.resumeCli({
        sessionId,
        onError: (msg: string) => {
          Message.error(t(msg));
        },
      });
    } catch (err) {
      console.error("[useSessionActions] resume failed:", err);
      Message.error(t("errors.failedToResume"));
    }
  }, [getSessionId, t]);

  /**
   * Interrupt the current turn.
   *
   * `options.restoreQueueHead`:
   *   - `true` (default) — User clicked the Stop button. Performs instant UI
   *     updates synchronously before the Rust RPC fires.
   *   - `false` — Programmatic interrupt for Send Now. No restore and no
   *     rollback; the queued message becomes the next user turn immediately.
   *
   * Three cases (all decided from the state snapshot at click time):
   *
   *   1. No queued messages + no agent output yet
   *      → Return to the session creator immediately with the message restored.
   *        Rust cancel and DB rollback fire in the background.
   *
   *   2. No queued messages + agent already produced output
   *      → Interrupt only. History stays intact.
   *
   *   3. Queue is non-empty and current turn already produced output
   *      → Pop the head to the input box, keep the tail queued.
   */
  const interruptSession = useCallback(
    async (options?: { restoreQueueHead?: boolean }) => {
      const restoreQueueHead = options?.restoreQueueHead ?? true;
      const sessionId = getSessionId();
      if (!sessionId) {
        console.error("[useSessionActions] No session ID found for interrupt");
        return;
      }

      const queue = store.get(messageQueueAtom);
      const lastUserMessage = store.get(lastUserMessageAtom);
      const pendingSyntheticEvent = store.get(pendingSyntheticEventAtom);

      // Derive "has visible output" from the EventStore snapshot.
      // chatEvents already excludes thinking deltas (Rust is_visible_in_chat
      // filter), so we check for any non-user, non-thinking event after
      // the last user message.
      const snap = eventStoreProxy.getLatestSessionSnapshot(sessionId);
      const chatEvents = snap?.chatEvents ?? [];
      let lastUserIdx = -1;
      for (let i = chatEvents.length - 1; i >= 0; i -= 1) {
        if (chatEvents[i].source === "user") {
          lastUserIdx = i;
          break;
        }
      }
      const turnHasVisibleOutput = chatEvents
        .slice(lastUserIdx + 1)
        .some((ev) => ev.source !== "user" && ev.displayVariant !== "thinking");
      const sessionHasPriorContent =
        lastUserIdx > 0 &&
        chatEvents.slice(0, lastUserIdx).some((ev) => ev.source !== "user");
      const snapshotUserMessage =
        lastUserIdx >= 0 && chatEvents[lastUserIdx].displayText
          ? {
              displayContent: chatEvents[lastUserIdx].displayText,
              imageDataUrls: undefined,
            }
          : null;
      const pendingUserMessage =
        pendingSyntheticEvent?.source === "user" &&
        pendingSyntheticEvent.displayText
          ? {
              displayContent: pendingSyntheticEvent.displayText,
              imageDataUrls: undefined,
            }
          : null;
      const currentUserMessage =
        snapshotUserMessage ?? lastUserMessage ?? pendingUserMessage;

      // Case 1: stopped before any visible agent output with no pending queue
      // AND no prior completed turns — a truly fresh first-send.
      // Navigate back to the creator immediately — no UI wait for Rust.
      if (
        restoreQueueHead &&
        !queue[0] &&
        !turnHasVisibleOutput &&
        !sessionHasPriorContent
      ) {
        setPendingSyntheticEvent(null);
        setSessionRolledBack(true);
        if (currentUserMessage) {
          setRestoreToInput({
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
        }
        // Prune the orphaned user event from the client-side cache.
        void (async () => {
          try {
            const current = await eventStoreProxy.getEvents();
            for (let i = current.length - 1; i >= 0; i -= 1) {
              if (current[i].source === "user") {
                await eventStoreProxy.truncateBeforeId(current[i].id);
                return;
              }
            }
          } catch (err) {
            console.warn(
              "[useSessionActions] Failed to prune cancelled user event:",
              err
            );
          }
        })();

        dispatchClearSession();
        setSessionRuntimeStatus("idle");
        setStreamRetryStatus(null);
        setWorkstationActiveSessionId(null);
        setActiveSessionId(null);

        // Fire the backend cancel + rollback in the background.
        void SessionService.interrupt({
          sessionId,
          reason: CANCEL_REASON.USER_STOP,
          onError: (msg: string) => {
            Message.error(t(msg));
          },
        })
          .then(() => eventStoreProxy.finalizeRunningEventsAsStopped(sessionId))
          .catch((err: unknown) => {
            logger.warn("background cancel failed:", err);
          });
        return;
      }

      // Cases 2 & 3: normal cancel flow — keep the session view open
      // and wait for Rust to confirm before clearing the pending state.
      setPendingCancel(true);

      if (restoreQueueHead) {
        setSessionRolledBack(false);
        setUserInitiatedCancel(true);

        if (!turnHasVisibleOutput && currentUserMessage) {
          setRestoreToInput({
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
          void (async () => {
            try {
              const events = await eventStoreProxy.getEvents();
              for (let i = events.length - 1; i >= 0; i -= 1) {
                if (events[i].source === "user") {
                  await eventStoreProxy.truncateBeforeId(events[i].id);
                  return;
                }
              }
            } catch (err) {
              console.warn(
                "[useSessionActions] Failed to prune user event:",
                err
              );
            }
          })();
        } else {
          const head = queue[0];
          if (head) {
            dequeueMessage(head.id);
            setRestoreToInput({
              displayContent: head.displayContent,
              imageDataUrls: head.imageDataUrls,
            });
          }
        }
      }

      if (!restoreQueueHead) {
        setUserInitiatedCancel(false);
        setPendingCancel(true);
        try {
          await SessionService.interrupt({
            sessionId,
            reason: CANCEL_REASON.FORCE_SEND,
            onError: (msg: string) => {
              Message.error(t(msg));
            },
          });
          await eventStoreProxy.finalizeRunningEventsAsStopped(sessionId);
        } catch (error: unknown) {
          console.error(
            "[useSessionActions] send-now interrupt failed:",
            error
          );
        } finally {
          setPendingCancel(false);
          setSessionRuntimeStatus("idle");
          setStreamRetryStatus(null);
        }
        return;
      }

      try {
        await SessionService.interrupt({
          sessionId,
          reason: CANCEL_REASON.USER_STOP,
          onError: (msg: string) => {
            Message.error(t(msg));
          },
        });
        await eventStoreProxy.finalizeRunningEventsAsStopped(sessionId);
        // isPendingCancel is intentionally NOT cleared here on the success path.
        // Rust will emit an agent:complete (or agent:error) event after winding
        // down the turn; the runtime-status handler that processes that event is
        // responsible for clearing isPendingCancel. Clearing it here would
        // create a race: the input area could re-enable and the queue could
        // flush a follow-up message before Rust has actually stopped.
      } catch (error) {
        console.error("[useSessionActions] interrupt failed:", error);
        setPendingCancel(false);
        if (restoreQueueHead) setUserInitiatedCancel(false);
        // Session is gone (already completed/removed): Rust will never send
        // agent:complete, so reset the runtime status ourselves to unblock
        // the input area and queue dispatch.
        setSessionRuntimeStatus("idle");
        setStreamRetryStatus(null);
      }
    },
    [
      dequeueMessage,
      dispatchClearSession,
      getSessionId,
      setActiveSessionId,
      setPendingCancel,
      setPendingSyntheticEvent,
      setRestoreToInput,
      setSessionRolledBack,
      setSessionRuntimeStatus,
      setStreamRetryStatus,
      setUserInitiatedCancel,
      setWorkstationActiveSessionId,
      store,
      t,
    ]
  );

  /**
   * User-initiated stop: identical to `interruptSession` now that the
   * "stopped -> promote to input" flow has been removed in favor of silent
   * queue-then-flush. Kept as a distinct export for call-site clarity.
   */
  const stopSession = interruptSession;

  return { resumeSession, interruptSession, stopSession };
}
