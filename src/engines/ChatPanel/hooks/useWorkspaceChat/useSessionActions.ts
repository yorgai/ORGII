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
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import {
  clearSessionAtom,
  pendingSyntheticEventAtom,
  sortedEventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { clearSessionStreamingStopped } from "@src/engines/SessionCore/sync/adapters/rustAgent/eventHandlers/streamHelpers";
import { createLogger } from "@src/hooks/logger";
import {
  isPendingCancelAtom,
  lastUserMessageAtom,
  restoreToInputAtom,
  sessionRolledBackAtom,
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

const log = createLogger("useSessionActions");

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
      log.error("[useSessionActions] resume failed:", err);
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
   * Single entry point: `cancelTurnForTimelineBoundary("stop")` owns ALL
   * boundary side effects (FSM transition to "stopping", atom writes, streaming
   * clear, shell kills, running-event close, IPC interrupt). The FSM returns to
   * "idle" when the backend delivers a cancelled/failed terminal, or when the
   * 10s stopping deadman fires — no separate timer or forceTurnIdle needed here.
   *
   * Three strictly-ordered phases:
   *   A. Snapshot: read events, compute output/prior-turn state, capture draft.
   *   B. Boundary: single call to cancelTurnForTimelineBoundary.
   *   C. UI: draft restore / page navigate / session clear based on A's snapshot.
   */
  const interruptSession = useCallback(async () => {
    const sessionId = getSessionId();
    if (!sessionId) {
      log.error("[useSessionActions] No session ID found for interrupt");
      return;
    }

    // ── Phase A: snapshot ────────────────────────────────────────────────────
    const events = store.get(sortedEventsAtom);
    const currentTurnHasOutput = hasCurrentTurnProducedOutput(
      events,
      sessionId
    );
    const priorTurnsExist = hasPriorTurns(events, sessionId);

    let restorable: ReturnType<typeof resolveRestorableUserMessage> = null;
    if (!currentTurnHasOutput) {
      const pendingSyntheticEvent = store.get(pendingSyntheticEventAtom);
      restorable = resolveRestorableUserMessage({
        lastUserMessage: store.get(lastUserMessageAtom),
        pendingDisplayText:
          pendingSyntheticEvent?.source === "user"
            ? pendingSyntheticEvent.displayText
            : undefined,
        pendingImages: pendingSyntheticEvent?.result?.images,
      });
    }

    // ── Phase B: boundary ────────────────────────────────────────────────────
    // This is the ONLY Stop boundary call. It synchronously drives the FSM
    // (beginTurnStopping), sets isPendingCancel/userInitiatedCancel atoms,
    // clears streaming, kills shells, closes running events, and writes
    // sessionRuntimeStatus = "idle". The async tail sends the IPC interrupt.
    setPendingCancel(false);
    setSessionRolledBack(false);

    void cancelTurnForTimelineBoundary(sessionId, "stop", {
      onError: (msg: string) => {
        Message.error(t(msg));
      },
    });

    // ── Phase C: UI side effects based on Phase A snapshot ───────────────────
    if (restorable) {
      setRestoreToInput({
        sessionId,
        displayContent: restorable.displayContent,
        imageDataUrls: restorable.imageDataUrls,
      });
      markRestoredStopDraft({
        sessionId,
        displayContent: restorable.displayContent,
        imageDataUrls: restorable.imageDataUrls,
      });
      suppressRestoredStopSubmit({
        sessionId,
        displayContent: restorable.displayContent,
        imageDataUrls: restorable.imageDataUrls,
      });
    }

    if (priorTurnsExist) {
      // Multi-turn: signal ChatHistory to navigate to the previous page.
      store.set(stopEarlyCancelEpochAtom, (prev) => prev + 1);
    } else {
      // First conversation: always clear the session so the creator shows.
      // The backend turn_index handles visibility — cancelled intents are
      // excluded from the materialized round index.
      setSessionRolledBack(true);
      store.set(clearSessionAtom);
      store.set(activeSessionIdAtom, null);
      store.set(workstationActiveSessionIdAtom, null);
    }
  }, [
    getSessionId,
    setPendingCancel,
    setRestoreToInput,
    setSessionRolledBack,
    store,
    t,
  ]);

  /** User-initiated stop entrypoint kept separate for call-site clarity. */
  const stopSession = interruptSession;

  return { resumeSession, interruptSession, stopSession };
}
