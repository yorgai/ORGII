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
  beginOptimisticTurn,
  failOptimisticTurn,
} from "@src/engines/SessionCore/control/optimisticTurnStatus";
import {
  beginStopBoundary,
  cancelTurnForTimelineBoundary,
  clearLiveStreamingForSession,
} from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { forceTurnIdle } from "@src/engines/SessionCore/control/turnLifecycle";
import {
  clearSessionAtom,
  pendingSyntheticEventAtom,
  sortedEventsAtom,
} from "@src/engines/SessionCore/core/atoms";
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
  setSessionRuntimeStatusAtom,
  stopEarlyCancelEpochAtom,
} from "@src/store/session/cliSessionStatusAtom";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";

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

export function hasCurrentTurnProducedOutput(
  events: readonly SessionEvent[],
  sessionId: string
): boolean {
  // Walk backwards from the end to find the last user event for this session,
  // then check if any non-user event follows it.
  let lastUserIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.sessionId && event.sessionId !== sessionId) continue;
    if (event.source === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return false;
  for (let i = lastUserIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (event.sessionId && event.sessionId !== sessionId) continue;
    if (event.source !== "user") return true;
  }
  return false;
}

/**
 * Returns true when the session has prior completed turns (user events
 * that precede the current/last user event). Used to distinguish
 * "first conversation" from "multi-turn with early cancel on the latest turn".
 */
export function hasPriorTurns(
  events: readonly SessionEvent[],
  sessionId: string
): boolean {
  let userCount = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.sessionId && event.sessionId !== sessionId) continue;
    if (event.source === "user") {
      userCount++;
      if (userCount >= 2) return true;
    }
  }
  return false;
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
      // Resume bypasses useMessageDispatch — without the optimistic running
      // the panel looks dead until Rust's first status event (#9).
      beginOptimisticTurn(sessionId);
      await SessionService.resumeCli({
        sessionId,
        onError: (msg: string) => {
          Message.error(t(msg));
        },
      });
    } catch (err) {
      console.error("[useSessionActions] resume failed:", err);
      failOptimisticTurn(sessionId);
      Message.error(t("errors.failedToResume"));
    }
  }, [getSessionId, t]);

  /**
   * Interrupt the current turn (user Stop).
   *
   * Send Now interrupts are NOT routed here — the queue dispatcher issues its
   * own "force-send" timeline boundary.
   *
   * Stop is an O(1) timeline boundary: it updates local runtime state, restores
   * the click-time prompt to the composer, and signals Rust cancellation. It
   * must not read/repair DB history or scan/mutate the EventStore.
   */
  const interruptSession = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) {
      console.error("[useSessionActions] No session ID found for interrupt");
      return;
    }

    beginStopBoundary(sessionId);
    setSessionRolledBack(false);

    // When the current turn has not produced any assistant/tool output,
    // discard the user message that started it so the chat rolls back cleanly.
    const events = store.get(sortedEventsAtom);
    const currentTurnHasOutput = hasCurrentTurnProducedOutput(
      events,
      sessionId
    );

    // Only restore the draft when the turn has not produced output yet.
    if (!currentTurnHasOutput) {
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
          sessionId,
          displayContent: currentUserMessage.displayContent,
          imageDataUrls: currentUserMessage.imageDataUrls,
        });
        markRestoredStopDraft({
          sessionId,
          displayContent: currentUserMessage.displayContent,
          imageDataUrls: currentUserMessage.imageDataUrls,
        });
        suppressRestoredStopSubmit({
          sessionId,
          displayContent: currentUserMessage.displayContent,
          imageDataUrls: currentUserMessage.imageDataUrls,
        });
      }

      // Find the last user event for this session — that's the message to discard.
      let lastUserEventId: string | null = null;
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.sessionId && ev.sessionId !== sessionId) continue;
        if (ev.source === "user") {
          lastUserEventId = ev.id;
          break;
        }
      }

      if (lastUserEventId) {
        // Truncate removes this event and everything after it.
        void eventStoreProxy.truncateBeforeId(lastUserEventId, sessionId);
      }

      if (hasPriorTurns(events, sessionId)) {
        // Multi-turn: signal ChatHistory to navigate to the previous page.
        store.set(stopEarlyCancelEpochAtom, (prev) => prev + 1);
      } else {
        // First conversation: clear the session so the creator shows.
        store.set(clearSessionAtom);
        store.set(activeSessionIdAtom, null);
        store.set(workstationActiveSessionIdAtom, null);
      }
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
          sessionId,
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
            sessionId,
            status: "idle",
            source: "timeline-boundary",
          });
          stopVisibleStreaming(sessionId);
          // Interrupt RPC failed — no terminal will arrive, unlock now.
          forceTurnIdle(sessionId);
        },
      });
    })();
  }, [
    getSessionId,
    setPendingCancel,
    setRestoreToInput,
    setSessionRolledBack,
    setSessionRuntimeStatus,
    stopVisibleStreaming,
    store,
    t,
  ]);

  /** User-initiated stop entrypoint kept separate for call-site clarity. */
  const stopSession = interruptSession;

  return { resumeSession, interruptSession, stopSession };
}
