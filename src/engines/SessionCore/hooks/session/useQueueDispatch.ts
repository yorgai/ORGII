/**
 * useQueueDispatch Hook — the single queue dispatcher.
 *
 * SINGLETON — must be mounted exactly once (in GlobalSessionSync).
 *
 * Drains `messageQueueAtom` strictly against the turn-lifecycle FSM
 * (`turnLifecycle.ts`). There is exactly one rule set:
 *
 *   - "now" priority (Send Now / post-Stop explicit submit):
 *       · session idle      → dispatch immediately.
 *       · session active    → request ONE timeline-boundary interrupt for it,
 *                             then dispatch when the provider terminal lands.
 *       · session stopping  → wait for the terminal (bounded by the FSM
 *                             stopping dead-man).
 *   - "next" priority (natural follow-ups):
 *       · dispatched FIFO, only when the session FSM is idle and the message
 *         is not held (`requiresExplicitDispatch` — set by a user Stop).
 *       · held messages are NEVER drained naturally; only Send Now can
 *         dispatch them.
 *
 * No runtime-status reads, no rendered-event heuristics, no timestamps or
 * stabilization windows: turn finality is exactly what the FSM says.
 */
import type { Atom } from "jotai";
import { useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { enterAgentOrgSessionIntervention } from "@src/api/tauri/agent";
import { Message } from "@src/components/Message";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import {
  beginTurnDispatch,
  confirmTurnRunning,
  getTurnPhase,
  markTurnTerminal,
  turnLifecycleSignalAtom,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared";
import { markSessionActive } from "@src/store/session";
import {
  lastUserMessageAtom,
  setSessionRuntimeStatusAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import {
  type LastModelSelection,
  creatorDefaultModelSelectionAtom,
} from "@src/store/session/creatorDefaultModelAtom";
import { sessionMapAtom } from "@src/store/session/sessionAtom";
import {
  type QueuedMessage,
  messageQueueAtom,
  queueEditingAtom,
  queueFlushRequestAtom,
} from "@src/store/ui/messageQueueAtom";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import { selectionFromSession } from "@src/util/session/selectionFromSession";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

const MAX_SENT_QUEUE_ID_CACHE = 200;

/**
 * Natural follow-ups stay visible in the queue UI for at least this long so
 * a fast turn completion does not make the queued bubble flash and vanish.
 * Explicit "now" dispatches skip this — the user just asked for it.
 */
const MIN_QUEUE_VISIBLE_MS = 1_200;

function queuedMessageAgeMs(message: QueuedMessage): number {
  const createdAtMs = Date.parse(message.createdAt);
  if (!Number.isFinite(createdAtMs)) return MIN_QUEUE_VISIBLE_MS;
  return Date.now() - createdAtMs;
}

export function useQueueDispatch(): void {
  const store = useStore();

  // ── Dispatch lock ─────────────────────────────────────────────────────────
  // One dispatch at a time, globally. The in-flight id additionally guards
  // the window between a successful send and the dequeue write.
  const dispatchLockRef = useRef(false);
  const inFlightMessageIdRef = useRef<string | null>(null);

  // Send Now interrupt bookkeeping: one boundary interrupt per message.
  const interruptRequestedByMessageIdRef = useRef<Set<string>>(new Set());

  // Already-sent ids (bounded LRU) so a stale queue snapshot can never
  // double-send a message that already became a user turn.
  const sentQueuedMessageIdsRef = useRef<Set<string>>(new Set());
  const sentQueuedMessageIdOrderRef = useRef<string[]>([]);
  const rememberSentQueueId = useCallback((messageId: string) => {
    if (sentQueuedMessageIdsRef.current.has(messageId)) return;
    sentQueuedMessageIdsRef.current.add(messageId);
    sentQueuedMessageIdOrderRef.current.push(messageId);
    while (
      sentQueuedMessageIdOrderRef.current.length > MAX_SENT_QUEUE_ID_CACHE
    ) {
      const expiredId = sentQueuedMessageIdOrderRef.current.shift();
      if (expiredId) sentQueuedMessageIdsRef.current.delete(expiredId);
    }
  }, []);

  // Pending wake-up for MIN_QUEUE_VISIBLE_MS waits.
  const wakeTimerRef = useRef<number | null>(null);
  const tryDispatchNextRef = useRef<() => void>(() => {});

  const dispatchMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      const { sessionId, content, displayContent, imageDataUrls } = msg;

      // Snapshot-first model/mode resolution: the QueuedMessage carries the
      // selection frozen at enqueue time; the session-row + creator-default
      // chain only covers legacy entries enqueued before snapshots existed.
      const sessionMap = store.get(sessionMapAtom);
      const session = sessionMap.get(sessionId);
      const lastModelSelection: LastModelSelection | null =
        msg.modelSelection ??
        selectionFromSession(
          session,
          store.get(creatorDefaultModelSelectionAtom)
        );
      const agentExecMode: AgentExecMode =
        msg.agentExecMode ??
        (session?.agentExecMode as AgentExecMode | undefined) ??
        store.get(creatorDefaultExecModeAtom);
      const { model, accountId } = resolveModelForMessage(lastModelSelection);

      // Synchronous turn reserve BEFORE any await: from this instant every
      // submit and every other dispatch pass observes the session as busy.
      const dispatchGeneration = beginTurnDispatch(sessionId);

      // An explicit dispatch concludes any pending stop episode.
      if (msg.priority === "now") {
        store.set(userInitiatedCancelAtom, false);
      }

      // Capture the payload for Stop-restore before the async append.
      store.set(lastUserMessageAtom, { displayContent, imageDataUrls });

      // Optimistic running status (UI mirror only) so the planning indicator
      // starts immediately; adapters overwrite it with authoritative status.
      store.set(setSessionRuntimeStatusAtom, {
        status: "running",
        source: "queue",
      });

      void (async () => {
        try {
          const userEvent = createSyntheticUserEvent(
            sessionId,
            displayContent,
            {
              imageDataUrls,
            }
          );
          await eventStoreProxy.append([userEvent], sessionId);
          void enterAgentOrgSessionIntervention(sessionId).catch((error) => {
            console.warn("[useQueueDispatch] intervention failed:", error);
          });
          // Pass displayContent as displayText when it differs from content
          // (i.e. skill pills were expanded) so the persisted event stores
          // the pill format and re-editing shows the pill, not the YAML.
          const displayTextForDispatch =
            content !== displayContent ? displayContent : undefined;
          await SessionService.sendMessage({
            sessionId,
            content,
            displayText: displayTextForDispatch,
            model,
            accountId,
            mode: agentExecMode,
            imageDataUrls,
            clientMessageId: `queued:${sessionId}:${msg.id}`,
          });
          // Backend accepted the message — confirm the turn as running.
          confirmTurnRunning(sessionId);
          // Bump activity timestamps so the just-flushed session surfaces in
          // "recent activity" views without waiting for the next refresh.
          markSessionActive(sessionId);
          rememberSentQueueId(msg.id);
          store.set(messageQueueAtom, (prev) =>
            prev.filter((item) => item.id !== msg.id)
          );
          onDone();
          if (isCursorIdeSession(sessionId)) {
            // Cursor IDE sessions have no turn lifecycle (no terminal event
            // stream) — close the turn right after a successful handoff.
            store.set(setSessionRuntimeStatusAtom, {
              status: "idle",
              source: "queue",
            });
            markTurnTerminal(sessionId, "completed", {
              generation: dispatchGeneration,
            });
          }
        } catch (err) {
          console.error("[useQueueDispatch] dispatch failed:", err);
          // IPC failed before the backend received the message: close the
          // reserved turn and park the message so it does not retry in a
          // tight loop — the user can fix the issue and press Send Now.
          store.set(setSessionRuntimeStatusAtom, {
            status: "idle",
            source: "queue",
          });
          markTurnTerminal(sessionId, "failed", {
            generation: dispatchGeneration,
          });
          store.set(messageQueueAtom, (prev) =>
            prev.map((item) =>
              item.id === msg.id
                ? { ...item, priority: "next", requiresExplicitDispatch: true }
                : item
            )
          );
          onDone();
          const detail = err instanceof Error ? err.message : String(err);
          Message.error({
            content: `Failed to send message: ${detail}`,
            duration: 5000,
          });
        }
      })();
    },
    [rememberSentQueueId, store]
  );

  const tryDispatchNext = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      window.clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
    if (dispatchLockRef.current) return;
    if (store.get(queueEditingAtom)) return;

    const queue = store.get(messageQueueAtom);
    if (queue.length === 0) return;

    const candidates = queue.filter(
      (msg) =>
        msg.id !== inFlightMessageIdRef.current &&
        !sentQueuedMessageIdsRef.current.has(msg.id)
    );

    // ── Explicit "now" dispatches take absolute precedence ─────────────────
    const explicitMsg = candidates.find((msg) => msg.priority === "now");
    if (explicitMsg) {
      const phase = getTurnPhase(explicitMsg.sessionId);
      if (phase === "idle") {
        dispatchLockRef.current = true;
        inFlightMessageIdRef.current = explicitMsg.id;
        dispatchMessage(explicitMsg, () => {
          if (inFlightMessageIdRef.current === explicitMsg.id) {
            inFlightMessageIdRef.current = null;
          }
          dispatchLockRef.current = false;
          tryDispatchNextRef.current();
        });
        return;
      }
      if (
        (phase === "working" || phase === "dispatching") &&
        !interruptRequestedByMessageIdRef.current.has(explicitMsg.id)
      ) {
        // Send Now against an active turn: interrupt it once. The provider's
        // cancelled terminal flips the FSM idle, which re-triggers this pass
        // and dispatches the message above.
        interruptRequestedByMessageIdRef.current.add(explicitMsg.id);
        void cancelTurnForTimelineBoundary(
          explicitMsg.sessionId,
          "force-send"
        ).catch((error) => {
          console.warn(
            "[useQueueDispatch] force-send interrupt failed:",
            error
          );
        });
      }
      // stopping (or interrupt already requested): wait for the terminal.
      return;
    }

    // ── Natural FIFO drain ──────────────────────────────────────────────────
    for (const msg of candidates) {
      if (msg.requiresExplicitDispatch) continue; // held by a user Stop
      if (getTurnPhase(msg.sessionId) !== "idle") continue; // turn active
      const remainingVisibleMs = MIN_QUEUE_VISIBLE_MS - queuedMessageAgeMs(msg);
      if (remainingVisibleMs > 0) {
        wakeTimerRef.current = window.setTimeout(() => {
          wakeTimerRef.current = null;
          tryDispatchNextRef.current();
        }, remainingVisibleMs);
        return;
      }
      dispatchLockRef.current = true;
      inFlightMessageIdRef.current = msg.id;
      dispatchMessage(msg, () => {
        if (inFlightMessageIdRef.current === msg.id) {
          inFlightMessageIdRef.current = null;
        }
        dispatchLockRef.current = false;
        tryDispatchNextRef.current();
      });
      return;
    }
  }, [dispatchMessage, store]);

  useEffect(() => {
    tryDispatchNextRef.current = tryDispatchNext;
  }, [tryDispatchNext]);

  useEffect(() => {
    const unsubscribers = [
      store.sub(messageQueueAtom as Atom<QueuedMessage[]>, tryDispatchNext),
      store.sub(turnLifecycleSignalAtom as Atom<number>, tryDispatchNext),
      store.sub(queueFlushRequestAtom as Atom<number>, tryDispatchNext),
      store.sub(queueEditingAtom as Atom<boolean>, tryDispatchNext),
    ];
    tryDispatchNext();
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (wakeTimerRef.current !== null) {
        window.clearTimeout(wakeTimerRef.current);
        wakeTimerRef.current = null;
      }
    };
  }, [store, tryDispatchNext]);
}
