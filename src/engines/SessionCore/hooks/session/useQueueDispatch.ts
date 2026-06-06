/**
 * useQueueDispatch Hook
 *
 * SINGLETON — must be mounted exactly once (in GlobalSessionSync).
 *
 * Watches isSessionActiveAtom for falling edges (true -> false) and dispatches
 * the next queued message from messageQueueAtom. Only one message is dispatched
 * per falling edge; the next message is dispatched when the agent finishes
 * processing the current one (Rust pushes status_changed -> completed/failed).
 *
 * Uses the dispatch registry so all session types (rust_agent, cli_agent)
 * are handled uniformly.
 *
 * NOTE on cancel-restore: restoring the active in-flight user message happens
 * SYNCHRONOUSLY inside `useSessionActions.interruptSession` at click time.
 * This hook is only responsible for auto-flushing queued follow-ups once the
 * session truly goes idle (either natural completion or a non-user-initiated
 * cancel). The `userCancelRef` guard below stops Stop from immediately
 * dispatching preserved queued follow-ups.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { Message } from "@src/components/Message";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared";
import { markSessionActive } from "@src/store/session";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  lastUserMessageAtom,
  sessionRuntimeStatusAtom,
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
  dequeueMessageAtom,
  forceSendPendingQueueAtom,
  messageQueueAtom,
  queueEditingAtom,
  queueFlushRequestAtom,
} from "@src/store/ui/messageQueueAtom";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import { selectionFromSession } from "@src/util/session/selectionFromSession";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import {
  hasQueueTurnSettledAfter,
  markQueueTurnSettled,
} from "./queueTurnGate";

const MAX_SENT_QUEUE_ID_CACHE = 200;
const MIN_QUEUE_VISIBLE_MS = 1_200;

function queuedMessageAgeMs(message: QueuedMessage): number {
  const createdAtMs = Date.parse(message.createdAt);
  if (!Number.isFinite(createdAtMs)) return MIN_QUEUE_VISIBLE_MS;
  return Date.now() - createdAtMs;
}

export function useQueueDispatch(): void {
  const isSessionActive = useAtomValue(isSessionActiveAtom);
  const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
  const isPendingCancel = useAtomValue(isPendingCancelAtom);
  const userInitiatedCancel = useAtomValue(userInitiatedCancelAtom);
  const setUserInitiatedCancel = useSetAtom(userInitiatedCancelAtom);
  const setLastUserMessage = useSetAtom(lastUserMessageAtom);
  const queue = useAtomValue(messageQueueAtom);
  const forceSendQueue = useAtomValue(forceSendPendingQueueAtom);
  const activeSessionId = useAtomValue(sessionIdAtom);
  const isQueueEditing = useAtomValue(queueEditingAtom);
  const flushRequest = useAtomValue(queueFlushRequestAtom);
  const dequeueMessage = useSetAtom(dequeueMessageAtom);
  const setSessionRuntimeStatus = useSetAtom(sessionRuntimeStatusAtom);
  const sessionMap = useAtomValue(sessionMapAtom);
  const creatorDefaultSelection = useAtomValue(
    creatorDefaultModelSelectionAtom
  );
  const creatorDefaultMode = useAtomValue(creatorDefaultExecModeAtom);

  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const forceSendQueueRef = useRef(forceSendQueue);
  useEffect(() => {
    forceSendQueueRef.current = forceSendQueue;
  }, [forceSendQueue]);

  const activeSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const runtimeStatusRef = useRef(runtimeStatus);
  useEffect(() => {
    runtimeStatusRef.current = runtimeStatus;
  }, [runtimeStatus]);

  const editingRef = useRef(isQueueEditing);
  useEffect(() => {
    editingRef.current = isQueueEditing;
  }, [isQueueEditing]);

  const pendingCancelRef = useRef(isPendingCancel);
  useEffect(() => {
    pendingCancelRef.current = isPendingCancel;
  }, [isPendingCancel]);

  const userCancelRef = useRef(userInitiatedCancel);
  useEffect(() => {
    userCancelRef.current = userInitiatedCancel;
  }, [userInitiatedCancel]);

  // Keep the per-render values in a ref so the singleton useEffect chain
  // below can see fresh values without re-creating callbacks. Dispatch
  // resolves the per-session model/mode at *call* time (not enqueue time)
  // so a mode the user picked while the queue was running takes effect on
  // subsequent dispatches.
  const depsRef = useRef({
    sessionMap,
    creatorDefaultSelection,
    creatorDefaultMode,
  });
  useEffect(() => {
    depsRef.current = {
      sessionMap,
      creatorDefaultSelection,
      creatorDefaultMode,
    };
  }, [sessionMap, creatorDefaultSelection, creatorDefaultMode]);

  const addUserMessage = useCallback(
    async (
      content: string,
      sessionId: string,
      imageDataUrls?: string[]
    ): Promise<void> => {
      const userEvent = createSyntheticUserEvent(sessionId, content, {
        imageDataUrls,
      });
      await eventStoreProxy.append([userEvent], sessionId);
    },
    []
  );

  const dispatchMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      const { sessionId, content, displayContent, imageDataUrls } = msg;
      const deps = depsRef.current;

      dequeueMessage(msg.id);
      setLastUserMessage({ displayContent, imageDataUrls });

      // Optimistically mark the session as running so the planning indicator
      // starts immediately, rather than waiting for the first SSE event from
      // Rust (which can take several seconds). The real status_changed event
      // from Rust will overwrite this when it arrives.
      setSessionRuntimeStatus("running");

      // Both `modelSelection` and `agentExecMode` on QueuedMessage are
      // *snapshots taken at enqueue time*. Honour them strictly here —
      // a swap of the session row's model or mode while the queue is
      // draining must NOT retroactively change in-flight messages.
      // The session-row + creator-default fallback chain only kicks in
      // for legacy queue entries that were enqueued before the
      // snapshot fields existed.
      const session = deps.sessionMap.get(sessionId);
      const lastModelSelection: LastModelSelection | null =
        msg.modelSelection ??
        selectionFromSession(session, deps.creatorDefaultSelection);
      const agentExecMode: AgentExecMode =
        msg.agentExecMode ??
        (session?.agentExecMode as AgentExecMode | undefined) ??
        deps.creatorDefaultMode;
      const { model, accountId } = resolveModelForMessage(lastModelSelection);

      void (async () => {
        try {
          if (!optimisticVisibleQueueIdsRef.current.has(msg.id)) {
            await addUserMessage(displayContent, sessionId, imageDataUrls);
          }
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
          // Bump activity timestamps so the just-flushed session
          // surfaces in "recent activity" views (sidebar / Kanban)
          // without waiting for the next session list refresh.
          markSessionActive(sessionId);
          dequeueMessage(msg.id);
          // Release the lock before Cursor IDE triggers its synthetic idle edge,
          // so the next queued follow-up can flush immediately.
          onDone();
          if (isCursorIdeSession(sessionId)) {
            setSessionRuntimeStatus("idle");
          }
        } catch (err) {
          console.error("[useQueueDispatch] dispatch failed:", err);
          // IPC failed before Rust even received the message — reset status
          // back to idle so the UI doesn't stay stuck in "running".
          setSessionRuntimeStatus("idle");
          dequeueMessage(msg.id);
          onDone();
          const detail = err instanceof Error ? err.message : String(err);
          Message.error({
            content: `Failed to send message: ${detail}`,
            duration: 5000,
          });
        }
      })();
    },
    [
      addUserMessage,
      dequeueMessage,
      setLastUserMessage,
      setSessionRuntimeStatus,
    ]
  );

  const optimisticVisibleQueueIdsRef = useRef<Set<string>>(new Set());

  const showQueuedMessageOptimistically = useCallback(
    (msg: QueuedMessage) => {
      if (optimisticVisibleQueueIdsRef.current.has(msg.id)) return;
      optimisticVisibleQueueIdsRef.current.add(msg.id);
      setLastUserMessage({
        displayContent: msg.displayContent,
        imageDataUrls: msg.imageDataUrls,
      });
      void addUserMessage(msg.displayContent, msg.sessionId, msg.imageDataUrls);
    },
    [addUserMessage, setLastUserMessage]
  );

  const dispatchRef = useRef<typeof dispatchMessage>(dispatchMessage);
  useEffect(() => {
    dispatchRef.current = dispatchMessage;
  }, [dispatchMessage]);

  // --- falling-edge dispatch with lock ---
  const dispatchLockRef = useRef(false);
  const sentQueuedMessageIdsRef = useRef<Set<string>>(new Set());
  const sentQueuedMessageIdOrderRef = useRef<string[]>([]);
  // Tracks which sessionId currently holds the lock, so we can detect
  // session switches and release a stale lock immediately.
  const lockSessionIdRef = useRef<string | null>(null);
  const prevActiveRef = useRef(isSessionActive);

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

  const flushTimersRef = useRef<number[]>([]);
  const tryDispatchNextRef = useRef<(() => void) | null>(null);

  const tryDispatchNext = useCallback(() => {
    // Hold off while Rust is still winding down a cancelled turn — the
    // sessionHandlers will clear isPendingCancelAtom when agent:complete /
    // agent:error actually lands, which triggers this watcher again.
    if (pendingCancelRef.current) return;

    const status = runtimeStatusRef.current;
    const sessionStillActive =
      status === "running" ||
      status === "installing" ||
      status === "waiting_for_user" ||
      status === "waiting_for_funds";
    if (sessionStillActive) return;

    // Hold off if the most recent cancel was user-initiated. Stop restores the
    // active in-flight user message synchronously in useSessionActions;
    // auto-flushing here would dispatch preserved follow-ups before the user
    // has a chance to revise or cancel the restored prompt. The flag is cleared
    // when the cancel settles, so after the user resends the queue flushes
    // normally.
    if (userCancelRef.current) return;

    const activeSessionId = activeSessionIdRef.current;
    const nextMsg =
      forceSendQueueRef.current.find(
        (message) => message.sessionId === activeSessionId
      ) ??
      queueRef.current.find((message) => message.sessionId === activeSessionId);

    if (!nextMsg || editingRef.current) return;

    if (nextMsg.requiresRuntimeSettle) {
      const createdAtMs = Date.parse(nextMsg.createdAt);
      if (
        Number.isFinite(createdAtMs) &&
        !hasQueueTurnSettledAfter(nextMsg.sessionId, createdAtMs)
      ) {
        return;
      }
    }

    const visibleDelayMs = MIN_QUEUE_VISIBLE_MS - queuedMessageAgeMs(nextMsg);
    if (visibleDelayMs > 0) {
      const timerId = window.setTimeout(() => {
        tryDispatchNextRef.current?.();
      }, visibleDelayMs);
      flushTimersRef.current.push(timerId);
      return;
    }

    // If lock is held for a *different* session than the next active-session
    // queue message, the previous dispatch call has already finished or become
    // irrelevant — release the lock so this session can proceed.
    if (
      dispatchLockRef.current &&
      nextMsg &&
      lockSessionIdRef.current !== nextMsg.sessionId
    ) {
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
    }

    if (dispatchLockRef.current) return;
    if (sentQueuedMessageIdsRef.current.has(nextMsg.id)) {
      dequeueMessage(nextMsg.id);
      return;
    }
    rememberSentQueueId(nextMsg.id);
    dispatchLockRef.current = true;
    lockSessionIdRef.current = nextMsg.sessionId;
    dispatchRef.current(nextMsg, () => {
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
    });
  }, [dequeueMessage, rememberSentQueueId]);

  useEffect(() => {
    for (const msg of forceSendQueue) {
      showQueuedMessageOptimistically(msg);
    }
  }, [forceSendQueue, showQueuedMessageOptimistically]);

  useEffect(() => {
    tryDispatchNextRef.current = tryDispatchNext;
  }, [tryDispatchNext]);

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = isSessionActive;

    if (isSessionActive) {
      // Session became active — release any stale lock from a previous dispatch
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
      return;
    }

    if (!wasActive) return;
    const activeSessionId = activeSessionIdRef.current;
    if (activeSessionId) {
      markQueueTurnSettled(activeSessionId);
    }
    tryDispatchNext();
  }, [isSessionActive, tryDispatchNext]);

  // Falling edge of isPendingCancel: Rust finished winding down the
  // cancelled turn (sessionHandlers cleared the flag).
  //
  // User-initiated cancels: the restore has already been done synchronously
  // in useSessionActions.interruptSession, so we just consume the
  // `userInitiatedCancel` flag and leave preserved queued follow-ups parked
  // until the user sends again.
  //
  // Non-user cancels (e.g. a Send Now interrupt with restoreQueueHead=false):
  // just flush.
  const prevPendingCancelRef = useRef(isPendingCancel);
  useEffect(() => {
    const wasPending = prevPendingCancelRef.current;
    prevPendingCancelRef.current = isPendingCancel;

    if (!wasPending || isPendingCancel || isSessionActive) return;

    const activeSessionId = activeSessionIdRef.current;
    if (activeSessionId) {
      markQueueTurnSettled(activeSessionId);
    }

    if (userCancelRef.current) {
      setUserInitiatedCancel(false);
      userCancelRef.current = false;
      return;
    }

    tryDispatchNext();
  }, [
    isPendingCancel,
    isSessionActive,
    setUserInitiatedCancel,
    tryDispatchNext,
  ]);

  useEffect(
    () => () => {
      flushTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      flushTimersRef.current = [];
    },
    []
  );

  // Manual flush request (e.g. "Send Now" clicked).
  const prevFlushRef = useRef(flushRequest);
  useEffect(() => {
    const prev = prevFlushRef.current;
    prevFlushRef.current = flushRequest;
    if (flushRequest === prev) return;

    setUserInitiatedCancel(false);
    userCancelRef.current = false;
    queueRef.current = queue;
    forceSendQueueRef.current = forceSendQueue;
    editingRef.current = isQueueEditing;
    if (isQueueEditing) return;
    tryDispatchNext();
    flushTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    flushTimersRef.current = [
      window.setTimeout(tryDispatchNext, 0),
      window.setTimeout(tryDispatchNext, 50),
      window.setTimeout(tryDispatchNext, 250),
    ];
  }, [
    flushRequest,
    forceSendQueue,
    isQueueEditing,
    queue,
    setUserInitiatedCancel,
    tryDispatchNext,
  ]);
}
