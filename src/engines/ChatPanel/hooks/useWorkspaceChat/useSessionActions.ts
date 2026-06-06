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
import { clearLiveStreamingForSession } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { pendingSyntheticEventAtom } from "@src/engines/SessionCore/core/atoms";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { clearSessionStreamingStopped } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers";
import {
  isPendingCancelAtom,
  lastUserMessageAtom,
  restoreToInputAtom,
  sessionRolledBackAtom,
  sessionRuntimeStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";

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

const STOP_RESTORE_SNAPSHOT_TAIL_LIMIT = 200;

function readStopRestoreTail(events: SessionEvent[]): SessionEvent[] {
  return events.length > STOP_RESTORE_SNAPSHOT_TAIL_LIMIT
    ? events.slice(-STOP_RESTORE_SNAPSHOT_TAIL_LIMIT)
    : events;
}

export function restoreStoppedTurnFromSnapshot(options: {
  sessionId: string;
  lastUserMessage: RestorableUserMessage | null;
  pendingDisplayText?: string;
  pendingImages?: unknown;
  setRestoreToInput: (value: RestorableUserMessage) => void;
}): void {
  const snap = eventStoreProxy.getLatestSessionSnapshot(options.sessionId);
  const chatEvents = readStopRestoreTail(snap?.chatEvents ?? []);
  let lastUserIdx = -1;
  for (let i = chatEvents.length - 1; i >= 0; i -= 1) {
    if (chatEvents[i].source === "user") {
      lastUserIdx = i;
      break;
    }
  }

  const snapshotUserEvent = lastUserIdx >= 0 ? chatEvents[lastUserIdx] : null;
  const currentUserMessage = resolveRestorableUserMessage({
    snapshotDisplayText: snapshotUserEvent?.displayText,
    snapshotImages: snapshotUserEvent?.result?.images,
    lastUserMessage: options.lastUserMessage,
    pendingDisplayText: options.pendingDisplayText,
    pendingImages: options.pendingImages,
  });
  if (!currentUserMessage) return;

  options.setRestoreToInput({
    displayContent: currentUserMessage.displayContent,
    imageDataUrls: currentUserMessage.imageDataUrls,
  });

  const turnHasVisibleOutput = chatEvents
    .slice(lastUserIdx + 1)
    .some((ev) => ev.source !== "user" && ev.displayVariant !== "thinking");
  if (turnHasVisibleOutput || !snapshotUserEvent?.id) return;

  const sessionHasPriorContent = chatEvents
    .slice(0, lastUserIdx)
    .some((ev) => ev.source !== "user");
  if (!sessionHasPriorContent) return;

  void eventStoreProxy
    .truncateBeforeId(snapshotUserEvent.id, options.sessionId)
    .catch((err) => {
      console.warn("[useSessionActions] Failed to prune user event:", err);
    });
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
  const setSessionRolledBack = useSetAtom(sessionRolledBackAtom);
  const setSessionRuntimeStatus = useSetAtom(sessionRuntimeStatusAtom);
  const stopVisibleStreaming = useCallback((sessionId: string) => {
    clearLiveStreamingForSession(sessionId);
  }, []);

  const resumeSession = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) {
      Message.error(t("errors.noSessionIdFound"));
      return;
    }

    try {
      clearSessionStreamingStopped(sessionId);
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
   * Cursor-aligned Stop behavior (all decided from the click-time snapshot):
   *
   *   - The button/composer unlock immediately; visible streaming stops
   *     optimistically before the Rust RPC completes.
   *   - If the stopped turn has no visible assistant output, restore the active
   *     prompt to the composer. When an older round exists, prune the no-output
   *     user event so history visually returns to the previous round. When this
   *     is the first round, keep the user prompt visible instead of clearing the
   *     transcript to a blank creator state.
   *   - Queued follow-ups stay queued. Stop must not consume, reorder, or
   *     auto-dispatch them.
   */
  const interruptSession = useCallback(
    async (options?: { restoreQueueHead?: boolean }) => {
      const restoreQueueHead = options?.restoreQueueHead ?? true;
      const sessionId = getSessionId();
      if (!sessionId) {
        console.error("[useSessionActions] No session ID found for interrupt");
        return;
      }

      if (restoreQueueHead) {
        setUserInitiatedCancel(true);
        setPendingCancel(true);
        stopVisibleStreaming(sessionId);
        setSessionRuntimeStatus("idle");
      }

      const lastUserMessage = store.get(lastUserMessageAtom);
      const pendingSyntheticEvent = store.get(pendingSyntheticEventAtom);
      const pendingDisplayText =
        pendingSyntheticEvent?.source === "user"
          ? pendingSyntheticEvent.displayText
          : undefined;
      const pendingImages = pendingSyntheticEvent?.result?.images;
      const currentUserMessage = resolveRestorableUserMessage({
        lastUserMessage,
        pendingDisplayText,
        pendingImages,
      });

      // Cases 2 & 3: normal cancel flow — keep the session view open, but
      // stop visible streaming immediately. Queue release still waits for the
      // real cancel-settle path via isPendingCancel/userInitiatedCancel.
      setPendingCancel(true);
      stopVisibleStreaming(sessionId);

      if (restoreQueueHead) {
        setSessionRolledBack(false);
        setUserInitiatedCancel(true);

        if (currentUserMessage) {
          setRestoreToInput({
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
        }

        window.setTimeout(() => {
          restoreStoppedTurnFromSnapshot({
            sessionId,
            lastUserMessage,
            pendingDisplayText,
            pendingImages,
            setRestoreToInput,
          });
        }, 100);
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
        window.setTimeout(() => {
          const latestStatus = store.get(sessionRuntimeStatusAtom);
          const runtimeStartedAnotherTurn =
            latestStatus === "running" ||
            latestStatus === "installing" ||
            latestStatus === "waiting_for_user" ||
            latestStatus === "waiting_for_funds";
          if (runtimeStartedAnotherTurn) return;
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
          // Rust usually emits agent:complete / agent:error after winding down the
          // turn, and the runtime-status handler clears isPendingCancel there. The
          // watchdog above is deliberately left alive as the fallback for Rust-native
          // turns that accept the interrupt RPC but never emit a terminal event.
        } catch (error) {
          console.error("[useSessionActions] interrupt failed:", error);
          setPendingCancel(false);
          // Keep userInitiatedCancel set for user Stop even if the backend
          // interrupt races with completion or fails. The visible UI has already
          // performed Cursor-style Stop/restore; the next explicit Send must
          // consume that Stop intent instead of becoming a parked follow-up that
          // waits for a settle edge that may never arrive.
          setSessionRuntimeStatus("idle");
          stopVisibleStreaming(sessionId);
        }
      })();
    },
    [
      getSessionId,
      setPendingCancel,
      setRestoreToInput,
      setSessionRolledBack,
      setSessionRuntimeStatus,
      stopVisibleStreaming,
      setUserInitiatedCancel,
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
