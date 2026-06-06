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
  streamingDeltaContentAtom,
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
import { messageQueueAtom } from "@src/store/ui/messageQueueAtom";

const logger = createLogger("UseSessionActions");

interface RestorableUserMessage {
  displayContent: string;
  imageDataUrls?: string[];
}

function readImageDataUrls(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.filter(
    (item): item is string => typeof item === "string"
  );
  return images.length > 0 ? images : undefined;
}

export function resolveRestorableUserMessage(options: {
  snapshotDisplayText?: string;
  snapshotImages?: unknown;
  lastUserMessage?: RestorableUserMessage | null;
  pendingDisplayText?: string;
  pendingImages?: unknown;
}): RestorableUserMessage | null {
  const snapshotImages = readImageDataUrls(options.snapshotImages);
  const pendingImages = readImageDataUrls(options.pendingImages);

  if (options.snapshotDisplayText) {
    const fallbackImages =
      options.lastUserMessage?.displayContent === options.snapshotDisplayText
        ? options.lastUserMessage.imageDataUrls
        : undefined;
    return {
      displayContent: options.snapshotDisplayText,
      imageDataUrls: snapshotImages ?? fallbackImages,
    };
  }

  if (options.lastUserMessage) {
    return options.lastUserMessage;
  }

  if (options.pendingDisplayText) {
    return {
      displayContent: options.pendingDisplayText,
      imageDataUrls: pendingImages,
    };
  }

  return null;
}

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
  const setSessionRuntimeStatus = useSetAtom(sessionRuntimeStatusAtom);
  const setStreamRetryStatus = useSetAtom(streamRetryStatusAtom);
  const setStreamingDeltaContent = useSetAtom(streamingDeltaContentAtom);

  const stopVisibleStreaming = useCallback(
    (sessionId: string) => {
      setStreamRetryStatus(null);
      setStreamingDeltaContent((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      void eventStoreProxy.setStreaming(false, sessionId).catch((error) => {
        logger.warn("failed to stop EventStore streaming snapshot:", error);
      });
    },
    [setStreamRetryStatus, setStreamingDeltaContent]
  );

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
   *   3. Queue is non-empty
   *      → Restore the active in-flight prompt to the input box and keep queued
   *        follow-ups queued. Stop should not consume or reorder the queue.
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
      const snapshotUserEvent =
        lastUserIdx >= 0 ? chatEvents[lastUserIdx] : null;
      const currentUserMessage = resolveRestorableUserMessage({
        snapshotDisplayText: snapshotUserEvent?.displayText,
        snapshotImages: snapshotUserEvent?.result?.images,
        lastUserMessage,
        pendingDisplayText:
          pendingSyntheticEvent?.source === "user"
            ? pendingSyntheticEvent.displayText
            : undefined,
        pendingImages: pendingSyntheticEvent?.result?.images,
      });

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
        stopVisibleStreaming(sessionId);
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

      // Cases 2 & 3: normal cancel flow — keep the session view open, but
      // stop visible streaming immediately. Queue release still waits for the
      // real cancel-settle path via isPendingCancel/userInitiatedCancel.
      setPendingCancel(true);
      stopVisibleStreaming(sessionId);

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
        } else if (currentUserMessage) {
          setRestoreToInput({
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
        }
      }

      if (!restoreQueueHead) {
        // Force-send (Send Now) path: the queued message is about to become the
        // next turn immediately, so we must always unblock the queue dispatcher
        // regardless of whether the interrupt succeeded or threw.  Resetting
        // isPendingCancel / runtimeStatus / streamRetryStatus unconditionally in
        // `finally` is intentional here — unlike the user-stop path (below),
        // there is no `agent:complete` event coming that would do the reset for
        // us, because the Rust side treats FORCE_SEND as a tear-down-and-replace
        // operation rather than a graceful stop.
        setUserInitiatedCancel(false);
        setPendingCancel(true);
        stopVisibleStreaming(sessionId);
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
          stopVisibleStreaming(sessionId);
        }
        return;
      }

      void (async () => {
        let watchdogId: number | null = window.setTimeout(() => {
          watchdogId = null;
          setPendingCancel(false);
          setSessionRuntimeStatus("idle");
          stopVisibleStreaming(sessionId);
        }, 10_000);

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
          stopVisibleStreaming(sessionId);
        } finally {
          if (watchdogId !== null) {
            window.clearTimeout(watchdogId);
          }
        }
      })();
    },
    [
      dispatchClearSession,
      getSessionId,
      setActiveSessionId,
      setPendingCancel,
      setPendingSyntheticEvent,
      setRestoreToInput,
      setSessionRolledBack,
      setSessionRuntimeStatus,
      stopVisibleStreaming,
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
