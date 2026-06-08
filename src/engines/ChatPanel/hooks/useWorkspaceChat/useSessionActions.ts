/**
 * useSessionActions
 *
 * Encapsulates session resume and interrupt logic via the dispatch registry.
 */
import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import {
  beginStopBoundary,
  cancelTurnForTimelineBoundary,
  clearLiveStreamingForSession,
} from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { pendingSyntheticEventAtom } from "@src/engines/SessionCore/core/atoms";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { clearSessionStreamingStopped } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers";
import {
  isPendingCancelAtom,
  lastUserMessageAtom,
  restoreToInputAtom,
  sessionRolledBackAtom,
  sessionRuntimeStatusAtom,
  setSessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";

import {
  markRestoredStopDraft,
  suppressRestoredStopSubmit,
} from "./stopSubmitGuard";

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
  const setRestoreToInput = useSetAtom(restoreToInputAtom);
  const setSessionRolledBack = useSetAtom(sessionRolledBackAtom);
  const setSessionRuntimeStatus = useSetAtom(setSessionRuntimeStatusAtom);
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
   *   - `false` — Programmatic interrupt for Send Now. The queued message
   *     becomes the next user turn immediately.
   *
   * Stop is an O(1) timeline boundary: it updates local runtime state, restores
   * the click-time prompt to the composer, and signals Rust cancellation. It
   * must not read/repair DB history or scan/mutate the EventStore.
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
        beginStopBoundary(sessionId);
        markRestoredStopDraft(sessionId);
        setSessionRolledBack(false);

        const pendingSyntheticEvent = store.get(pendingSyntheticEventAtom);
        const currentUserMessage = resolveRestorableUserMessage({
          lastUserMessage: store.get(lastUserMessageAtom),
          pendingDisplayText:
            pendingSyntheticEvent?.source === "user"
              ? pendingSyntheticEvent.displayText
              : undefined,
          pendingImages: pendingSyntheticEvent?.result?.images,
        });

        if (currentUserMessage) {
          setRestoreToInput({
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
          suppressRestoredStopSubmit({
            sessionId,
            displayContent: currentUserMessage.displayContent,
            imageDataUrls: currentUserMessage.imageDataUrls,
          });
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
            setSessionRuntimeStatus({
              status: "idle",
              source: "timeline-boundary",
            });
            stopVisibleStreaming(sessionId);
          }, 10_000);

          await cancelTurnForTimelineBoundary(sessionId, "stop", {
            onError: (msg: string) => {
              Message.error(t(msg));
              setPendingCancel(false);
              setSessionRuntimeStatus({
                status: "idle",
                source: "timeline-boundary",
              });
              stopVisibleStreaming(sessionId);
            },
          });
        })();
        return;
      }

      await cancelTurnForTimelineBoundary(sessionId, "force-send", {
        onError: (msg: string) => {
          Message.error(t(msg));
        },
      });
      setPendingCancel(false);
      setSessionRuntimeStatus({ status: "idle", source: "timeline-boundary" });
      stopVisibleStreaming(sessionId);
    },
    [
      getSessionId,
      setPendingCancel,
      setRestoreToInput,
      setSessionRolledBack,
      setSessionRuntimeStatus,
      stopVisibleStreaming,
      store,
      t,
    ]
  );

  /** User-initiated stop entrypoint kept separate for call-site clarity. */
  const stopSession = interruptSession;

  return { resumeSession, interruptSession, stopSession };
}
