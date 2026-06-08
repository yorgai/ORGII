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
 * session reaches a natural queue-releasing terminal edge. User Stop only
 * unlocks the composer and restores the draft; it never consumes preserved
 * queued follow-ups.
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { enterAgentOrgSessionIntervention } from "@src/api/tauri/agent";
import { Message } from "@src/components/Message";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { cancelTurnForTimelineBoundary } from "@src/engines/SessionCore/control/sessionTimelineBoundary";
import { sortedEventsAtom } from "@src/engines/SessionCore/core/atoms/events";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import { hasTurnBlockingRunningSessionEvent } from "@src/engines/SessionCore/core/runningEventGate";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared";
import { markSessionActive } from "@src/store/session";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  lastUserMessageAtom,
  sessionRuntimeStatusAtom,
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
  dequeueMessageAtom,
  forceSendPendingQueueAtom,
  messageQueueAtom,
  queueEditingAtom,
  queueFlushRequestAtom,
} from "@src/store/ui/messageQueueAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import { selectionFromSession } from "@src/util/session/selectionFromSession";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import {
  hasQueueTurnSettledAfter,
  hasQueueTurnTerminatedAfter,
  isQueueRuntimeStillWorking,
  markQueueTurnWorking,
} from "./queueTurnGate";

const MAX_SENT_QUEUE_ID_CACHE = 200;
const MIN_QUEUE_VISIBLE_MS = 1_200;
function queuedMessageAgeMs(message: QueuedMessage): number {
  const createdAtMs = Date.parse(message.createdAt);
  if (!Number.isFinite(createdAtMs)) return MIN_QUEUE_VISIBLE_MS;
  return Date.now() - createdAtMs;
}

function hasTurnBlockingRunningEventForSession(sessionId: string): boolean {
  return hasTurnBlockingRunningSessionEvent(
    getInstrumentedStore().get(sortedEventsAtom),
    sessionId
  );
}

export function useQueueDispatch(): void {
  const store = useStore();
  const isSessionActive = useAtomValue(isSessionActiveAtom);
  const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
  const isPendingCancel = useAtomValue(isPendingCancelAtom);
  const userInitiatedCancel = useAtomValue(userInitiatedCancelAtom);
  const setUserInitiatedCancel = useSetAtom(userInitiatedCancelAtom);
  const setLastUserMessage = useSetAtom(lastUserMessageAtom);
  const queue = useAtomValue(messageQueueAtom);
  const forceSendQueue = useAtomValue(forceSendPendingQueueAtom);
  const sortedEvents = useAtomValue(sortedEventsAtom);
  const activeSessionId = useAtomValue(sessionIdAtom);
  const isQueueEditing = useAtomValue(queueEditingAtom);
  const flushRequest = useAtomValue(queueFlushRequestAtom);
  const dequeueMessage = useSetAtom(dequeueMessageAtom);
  const setSessionRuntimeStatus = useSetAtom(setSessionRuntimeStatusAtom);
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

  const dispatchMessage = useCallback(
    (msg: QueuedMessage, onDone: () => void) => {
      const { sessionId, content, displayContent, imageDataUrls } = msg;
      const deps = depsRef.current;

      setLastUserMessage({ displayContent, imageDataUrls });

      // Optimistically mark the session as running so the planning indicator
      // starts immediately, rather than waiting for the first SSE event from
      // Rust (which can take several seconds). The real status_changed event
      // from Rust will overwrite this when it arrives.
      setSessionRuntimeStatus({ status: "running", source: "queue" });
      markQueueTurnWorking(sessionId);

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
          // Bump activity timestamps so the just-flushed session
          // surfaces in "recent activity" views (sidebar / Kanban)
          // without waiting for the next session list refresh.
          markSessionActive(sessionId);
          rememberSentQueueId(msg.id);
          dequeueMessage(msg.id);
          // Release the lock before Cursor IDE triggers its synthetic idle edge,
          // so the next queued follow-up can flush immediately.
          onDone();
          if (isCursorIdeSession(sessionId)) {
            setSessionRuntimeStatus({ status: "idle", source: "queue" });
          }
        } catch (err) {
          console.error("[useQueueDispatch] dispatch failed:", err);
          // IPC failed before Rust even received the message — reset status
          // back to idle so the UI doesn't stay stuck in "running".
          setSessionRuntimeStatus({ status: "idle", source: "queue" });
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
      rememberSentQueueId,
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
  // Tracks which sessionId currently holds the lock, so we can detect
  // session switches and release a stale lock immediately.
  const lockSessionIdRef = useRef<string | null>(null);
  const isRuntimeWorkingStatus = useCallback(
    (status: string) => isQueueRuntimeStillWorking(status),
    []
  );
  const prevRuntimeWorkingRef = useRef(isRuntimeWorkingStatus(runtimeStatus));

  const flushTimersRef = useRef<number[]>([]);
  const explicitInterruptSessionRef = useRef<string | null>(null);
  const explicitInterruptRequestedAtByQueueIdRef = useRef<Map<string, number>>(
    new Map()
  );
  const tryDispatchNextRef = useRef<(() => void) | null>(null);
  const handledFlushRequestRef = useRef(flushRequest);

  const tryDispatchNext = useCallback(() => {
    const latestPendingCancel = store.get(isPendingCancelAtom);
    const latestUserCancel = store.get(userInitiatedCancelAtom);
    const latestRuntimeStatus = store.get(sessionRuntimeStatusAtom);
    const latestIsSessionActive = store.get(isSessionActiveAtom);
    const latestQueue = store.get(messageQueueAtom);
    const latestForceSendQueue = store.get(forceSendPendingQueueAtom);
    const latestActiveSessionId = store.get(sessionIdAtom);
    const latestIsEditing = store.get(queueEditingAtom);

    pendingCancelRef.current = latestPendingCancel;
    userCancelRef.current = latestUserCancel;
    runtimeStatusRef.current = latestRuntimeStatus;
    queueRef.current = latestQueue;
    forceSendQueueRef.current = latestForceSendQueue;
    activeSessionIdRef.current = latestActiveSessionId;
    editingRef.current = latestIsEditing;

    const activeSessionIdHint = activeSessionIdRef.current;
    const forcedMsg = forceSendQueueRef.current[0];
    const latestFlushRequest = store.get(queueFlushRequestAtom);
    if (latestFlushRequest < handledFlushRequestRef.current) {
      handledFlushRequestRef.current = latestFlushRequest;
    }
    const flushRequested = latestFlushRequest > handledFlushRequestRef.current;
    const postCancelSendMsg = queueRef.current.find(
      (message) => message.dispatchAfterUserCancel
    );
    const explicitMsg = forcedMsg ?? postCancelSendMsg;
    const activeSessionId = explicitMsg?.sessionId ?? activeSessionIdHint;
    if (!activeSessionId) return;

    // Hold off while Rust is still winding down a cancelled turn — the
    // sessionHandlers will clear isPendingCancelAtom when agent:complete /
    // agent:error actually lands, which triggers this watcher again. Explicit
    // post-Stop sends are the exception: they must be allowed to finish the
    // old turn with FORCE_SEND semantics, otherwise a Rust-native turn that
    // accepted Stop but stayed visually running can strand the user's resend.
    if (latestPendingCancel && !explicitMsg) return;

    const runtimeWorking =
      latestIsSessionActive ||
      isQueueRuntimeStillWorking(latestRuntimeStatus) ||
      hasTurnBlockingRunningEventForSession(activeSessionId);
    if (runtimeWorking && !explicitMsg) return;
    if (explicitMsg) {
      const interruptRequestedAt =
        explicitInterruptRequestedAtByQueueIdRef.current.get(explicitMsg.id);
      if (runtimeWorking && !interruptRequestedAt) {
        if (explicitInterruptSessionRef.current === explicitMsg.id) return;
        const requestedAt = Date.now();
        explicitInterruptRequestedAtByQueueIdRef.current.set(
          explicitMsg.id,
          requestedAt
        );
        explicitInterruptSessionRef.current = explicitMsg.id;
        void cancelTurnForTimelineBoundary(activeSessionId, "force-send")
          .catch((error) => {
            explicitInterruptRequestedAtByQueueIdRef.current.delete(
              explicitMsg.id
            );
            console.error(
              "[useQueueDispatch] explicit interrupt failed:",
              error
            );
          })
          .finally(() => {
            explicitInterruptSessionRef.current = null;
            tryDispatchNextRef.current?.();
          });
        return;
      }

      if (
        interruptRequestedAt &&
        runtimeWorking &&
        !hasQueueTurnTerminatedAfter(activeSessionId, interruptRequestedAt)
      ) {
        return;
      }
    }

    // Hold off if the most recent cancel was user-initiated. Stop restores the
    // active in-flight user message synchronously in useSessionActions;
    // auto-flushing here would dispatch preserved follow-ups before the user
    // has a chance to revise or cancel the restored prompt. The only exception
    // is when the user explicitly presses Send again while that cancel is
    // settling; that message becomes the next active prompt once Rust is idle.
    if (latestUserCancel && !explicitMsg) return;
    if (latestUserCancel && explicitMsg?.dispatchAfterUserCancel) {
      setUserInitiatedCancel(false);
      userCancelRef.current = false;
    }

    const nextMsg =
      explicitMsg ??
      queueRef.current.find((message) => message.sessionId === activeSessionId);

    if (!nextMsg || editingRef.current) return;

    const explicitBypassesRuntimeSettle =
      explicitMsg !== undefined && nextMsg.id === explicitMsg.id;
    if (nextMsg.requiresRuntimeSettle && !explicitBypassesRuntimeSettle) {
      const createdAtMs = Date.parse(nextMsg.createdAt);
      const requiredSettleAfter = Number.isFinite(createdAtMs)
        ? createdAtMs
        : 0;
      const hasSettled = hasQueueTurnSettledAfter(
        nextMsg.sessionId,
        requiredSettleAfter,
        nextMsg.releaseAfterTurnId
      );
      if (!hasSettled) return;

      if (!explicitMsg) {
        const stillWorking =
          store.get(isSessionActiveAtom) ||
          isQueueRuntimeStillWorking(store.get(sessionRuntimeStatusAtom)) ||
          hasTurnBlockingRunningEventForSession(nextMsg.sessionId);
        if (stillWorking || store.get(isPendingCancelAtom)) return;
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
      (lockSessionIdRef.current !== nextMsg.sessionId ||
        (explicitMsg && nextMsg.id === explicitMsg.id))
    ) {
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
    }

    if (dispatchLockRef.current) return;
    if (sentQueuedMessageIdsRef.current.has(nextMsg.id)) {
      dequeueMessage(nextMsg.id);
      return;
    }
    explicitInterruptRequestedAtByQueueIdRef.current.delete(nextMsg.id);
    rememberSentQueueId(nextMsg.id);
    if (flushRequested) {
      handledFlushRequestRef.current = latestFlushRequest;
    }
    dispatchLockRef.current = true;
    lockSessionIdRef.current = nextMsg.sessionId;
    dispatchRef.current(nextMsg, () => {
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
    });
  }, [dequeueMessage, rememberSentQueueId, setUserInitiatedCancel, store]);

  useEffect(() => {
    for (const msg of forceSendQueue) {
      showQueuedMessageOptimistically(msg);
    }
  }, [forceSendQueue, showQueuedMessageOptimistically]);

  useEffect(() => {
    tryDispatchNextRef.current = tryDispatchNext;
  }, [tryDispatchNext]);

  useEffect(() => {
    if (isSessionActive) {
      // Session became active — release any stale lock from a previous dispatch.
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
    }
  }, [isSessionActive]);

  useEffect(() => {
    const hasExplicitDispatch =
      forceSendQueue.length > 0 ||
      queue.some((message) => message.dispatchAfterUserCancel);
    if (!hasExplicitDispatch) return;
    tryDispatchNext();
  }, [forceSendQueue, queue, sortedEvents, tryDispatchNext]);

  useEffect(() => {
    const isWorking = isRuntimeWorkingStatus(runtimeStatus);
    const wasWorking = prevRuntimeWorkingRef.current;
    prevRuntimeWorkingRef.current = isWorking;

    if (isWorking) {
      dispatchLockRef.current = false;
      lockSessionIdRef.current = null;
      return;
    }

    const latestPendingCancel = store.get(isPendingCancelAtom);
    const latestUserCancel = store.get(userInitiatedCancelAtom);
    pendingCancelRef.current = latestPendingCancel;
    userCancelRef.current = latestUserCancel;

    if (!wasWorking || latestPendingCancel || latestUserCancel) {
      return;
    }
    tryDispatchNext();
  }, [isRuntimeWorkingStatus, runtimeStatus, store, tryDispatchNext]);

  // Falling edge of isPendingCancel: Rust finished winding down the
  // cancelled turn (sessionHandlers cleared the flag).
  //
  // User-initiated cancels: the restore has already been done synchronously
  // in useSessionActions.interruptSession, so we just consume the
  // `userInitiatedCancel` flag and leave preserved queued follow-ups parked
  // until the user sends again.
  //
  // Non-user cancels (e.g. a Send Now interrupt with restoreQueueHead=false):
  // may flush explicitly because force-send entries do not require a natural
  // runtime settle edge.
  const prevPendingCancelRef = useRef(isPendingCancel);
  useEffect(() => {
    const wasPending = prevPendingCancelRef.current;
    prevPendingCancelRef.current = isPendingCancel;

    if (!wasPending || isPendingCancel || isSessionActive) return;

    if (userCancelRef.current) {
      const activeSessionId = activeSessionIdRef.current;
      const hasExplicitPostCancelDispatch =
        forceSendQueueRef.current.some(
          (message) => message.sessionId === activeSessionId
        ) ||
        queueRef.current.some(
          (message) =>
            message.sessionId === activeSessionId &&
            message.dispatchAfterUserCancel
        );
      if (!hasExplicitPostCancelDispatch) {
        return;
      }
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
    const activeSessionId = store.get(sessionIdAtom);
    const hasExplicitPostCancelDispatch =
      forceSendQueue.some(
        (message) =>
          message.sessionId === activeSessionId &&
          message.dispatchAfterUserCancel
      ) ||
      queue.some(
        (message) =>
          message.sessionId === activeSessionId &&
          message.dispatchAfterUserCancel
      );
    if (store.get(userInitiatedCancelAtom) && !hasExplicitPostCancelDispatch) {
      return;
    }

    if (hasExplicitPostCancelDispatch) {
      setUserInitiatedCancel(false);
      userCancelRef.current = false;
    }
    const latestQueue = store.get(messageQueueAtom);
    const latestForceSendQueue = store.get(forceSendPendingQueueAtom);
    const latestIsQueueEditing = store.get(queueEditingAtom);
    queueRef.current = latestQueue;
    forceSendQueueRef.current = latestForceSendQueue;
    editingRef.current = latestIsQueueEditing;
    if (latestIsQueueEditing) return;

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
    store,
    tryDispatchNext,
  ]);
}
