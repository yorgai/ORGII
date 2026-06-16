/**
 * useWorkspaceChat Hook
 *
 * Manages workspace chat functionality including message sending and session interaction.
 * Orchestrates sub-hooks for dispatch and session actions.
 *
 * @example
 * const { handleSessChatSubmit, loading } = useWorkspaceChat();
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { isHostedFromSearchParams } from "@src/api/http/session/unified";
import { enterAgentOrgSessionIntervention } from "@src/api/tauri/agent";
import { isHostedKey } from "@src/api/tauri/session";
import Message from "@src/components/Message";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import {
  beginOptimisticTurn,
  failOptimisticTurn,
} from "@src/engines/SessionCore/control/optimisticTurnStatus";
import {
  beginTurnDispatch,
  forceTurnIdle,
  getTurnPhase,
} from "@src/engines/SessionCore/control/turnLifecycle";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import { createLogger } from "@src/hooks/logger";
import {
  isSessionActiveAtom,
  lastUserMessageAtom,
  userInitiatedCancelAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import {
  type LastModelSelection,
  creatorDefaultModelSelectionAtom,
} from "@src/store/session/creatorDefaultModelAtom";
import { sessionMapAtom } from "@src/store/session/sessionAtom";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import {
  enqueueMessageAtom,
  messageQueueAtom,
  queueFlushRequestAtom,
} from "@src/store/ui/messageQueueAtom";
import {
  isAgentSession,
  isCliSession,
} from "@src/util/session/sessionDispatch";

import {
  consumeRestoredStopDraft,
  consumeRestoredStopSubmitSuppression,
} from "./stopSubmitGuard";
import { useMessageDispatch } from "./useMessageDispatch";
import { useSessionActions } from "./useSessionActions";

const log = createLogger("useWorkspaceChat");

/**
 * Module-level submit guard shared across all useWorkspaceChat instances.
 *
 * WHY module-level (not per-instance ref or per-session Map):
 * The chat panel can mount multiple useWorkspaceChat consumers simultaneously
 * (InputArea + EditUserMessage each instantiate the hook independently). A
 * per-instance ref would let both fire in the same React render batch, sending
 * the same message twice. The module-level object acts as a cross-instance
 * mutex for the *currently active* submit.
 *
 * WHY not keyed by sessionId:
 * In the current layout there is at most one active submit in flight at any
 * time — switching sessions clears the guard via the isWpGeneWorking effect
 * (line ~129). A Map<sessionId, ...> would be safer but is unnecessary
 * complexity until multi-session parallel dispatch is a real requirement.
 *
 * IMPORTANT: guard.current is cleared asynchronously via a useEffect that
 * watches isWpGeneWorking, NOT synchronously on submit. There is a 1-2 frame
 * window after a fast session completes where a re-submit of the identical
 * payload would be silently dropped. This is intentional — the dedup check
 * (submitPayloadKey equality) is the safety valve, not the guard alone.
 */
const _sharedSubmitGuard = { current: false };
const _sharedSubmitPayload = { current: null as string | null };

function buildSubmitPayloadKey(
  sessionId: string,
  displayContent: string,
  agentContent?: string,
  imageDataUrls?: string[]
): string {
  return JSON.stringify({
    sessionId,
    displayContent,
    agentContent: agentContent ?? null,
    imageDataUrls: imageDataUrls ?? [],
  });
}

function stableSubmitHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface UseWorkspaceChatOptions {
  sessionId?: string;
}

const useWorkspaceChat = (options: UseWorkspaceChatOptions = {}) => {
  const { sessionId: propSessionId } = options;
  const { t } = useTranslation("sessions");
  const [searchParams] = useSearchParams();
  const store = useStore();

  const isHosted = useMemo(
    () => isHostedFromSearchParams(searchParams),
    [searchParams]
  );

  // ============================================
  // Atoms
  // ============================================
  const isWpGeneWorking = useAtomValue(isSessionActiveAtom);
  const setUserInitiatedCancel = useSetAtom(userInitiatedCancelAtom);
  const setLastUserMessage = useSetAtom(lastUserMessageAtom);
  // SessionCore engine-level session ID — always tracks the currently
  // synced session (set by loadSessionAtom inside useSessionSync).
  const coreSessionId = useAtomValue(sessionIdAtom);

  // Unified session ID from route/atoms (fallback when coreSessionId
  // is not yet set, e.g. during initial navigation before session load).
  const { sessionId: resolvedSessionId } = useSessionId();
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const workstationActiveSessionId = useAtomValue(
    workstationActiveSessionIdAtom
  );

  // ============================================
  // Queue Atoms
  // ============================================
  const enqueueMessage = useSetAtom(enqueueMessageAtom);
  const setQueueFlushRequest = useSetAtom(queueFlushRequestAtom);
  // Per-session source-of-truth: when enqueuing we snapshot the model
  // and exec-mode that the *session row* currently has, so a model or
  // mode swap done while the queue is draining cannot retroactively
  // change still-pending messages. The creator-default atoms are only
  // used as a fallback for the (rare) case where the session row has
  // no model/mode written yet — e.g. the very first message of a
  // freshly created session before any pill interaction.
  const sessionMap = useAtomValue(sessionMapAtom);
  const creatorDefaultSelection = useAtomValue(
    creatorDefaultModelSelectionAtom
  );
  const creatorDefaultMode = useAtomValue(creatorDefaultExecModeAtom);

  // ============================================
  // Local State
  // ============================================
  const [sessChatInput, setSessChatInput] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Sync the shared submit guard with runtime status so it clears
  // when the session finishes, regardless of which instance started it.
  useEffect(() => {
    if (!isWpGeneWorking) {
      _sharedSubmitGuard.current = false;
      _sharedSubmitPayload.current = null;
    }
  }, [isWpGeneWorking]);

  // ============================================
  // Session ID Helper
  // ============================================
  const getSessionId = useCallback((): string | null => {
    return (
      propSessionId ||
      coreSessionId ||
      resolvedSessionId ||
      activeSessionId ||
      workstationActiveSessionId ||
      null
    );
  }, [
    propSessionId,
    coreSessionId,
    resolvedSessionId,
    activeSessionId,
    workstationActiveSessionId,
  ]);

  // ============================================
  // Sub-hooks
  // ============================================
  const { addUserMessage, dispatchMessageBySessionType } = useMessageDispatch({
    getSessionId,
  });

  const { resumeSession, interruptSession, stopSession } = useSessionActions({
    getSessionId,
  });

  // ============================================
  // Input Change Handler
  // ============================================
  const handleSessInputChange = useCallback((value: string) => {
    setSessChatInput(value);
  }, []);

  // ============================================
  // Main Chat Submit Handler
  // ============================================
  const handleSessChatSubmit = useCallback(
    async (
      e?: React.FormEvent,
      inputValue?: string,
      agentContent?: string,
      imageDataUrls?: string[]
    ) => {
      e?.preventDefault();
      const finalInput = inputValue || sessChatInput;
      if (!finalInput.trim()) return;

      const contentForAgent = agentContent || finalInput;
      const restoreImageDataUrls =
        imageDataUrls && imageDataUrls.length > 0 ? imageDataUrls : undefined;
      const sessionId = getSessionId();
      if (!sessionId) {
        Message.error(t("errors.noSessionIdFound"));
        throw new Error("No session ID");
      }

      const submitPayloadKey = buildSubmitPayloadKey(
        sessionId,
        finalInput,
        agentContent,
        imageDataUrls
      );
      const directClientMessageId = `direct:${sessionId}:${stableSubmitHash(
        submitPayloadKey
      )}`;
      // Mint the canonical user-intent id once at the submit boundary.
      // This is the same value that travels through the queue, the synthetic
      // user event, and the wire call to `agent_send_message`. See
      // `QueuedMessage.turnIntentId` for the full propagation contract.
      const turnIntentId = mintTurnIntentId();
      if (
        consumeRestoredStopSubmitSuppression({
          sessionId,
          displayContent: finalInput,
          imageDataUrls,
        })
      ) {
        return;
      }
      // Re-submitting the exact draft a Stop restored is an explicit
      // post-Stop dispatch; so is any submit while a stop episode is open.
      const restoredStopDraftSubmit = consumeRestoredStopDraft({
        sessionId,
        displayContent: finalInput,
        imageDataUrls,
      });
      const explicitPostStopSubmit =
        store.get(userInitiatedCancelAtom) || restoredStopDraftSubmit;

      // Duplicate-submit guard: the exact payload of the in-flight direct
      // dispatch is dropped until the runtime settles (double-click safety).
      if (
        _sharedSubmitGuard.current &&
        _sharedSubmitPayload.current === submitPayloadKey
      ) {
        return;
      }

      // ── submitOrEnqueue: THE single queue/direct decision ────────────────
      // Queue when the turn-lifecycle FSM says a turn is open (or closing),
      // when a stop episode makes this an explicit post-Stop dispatch, or
      // when older natural siblings are still queued (FIFO ordering).
      const turnPhase = getTurnPhase(sessionId);
      const hasQueuedNaturalSibling = store
        .get(messageQueueAtom)
        .some(
          (message) =>
            message.sessionId === sessionId && !message.requiresExplicitDispatch
        );
      const shouldEnqueue =
        explicitPostStopSubmit ||
        turnPhase !== "idle" ||
        hasQueuedNaturalSibling;

      if (shouldEnqueue) {
        setSessChatInput("");

        // Build the snapshot from the session row, falling back to the
        // creator-default for fields the row doesn't carry. Mirrors
        // `selectionFromSession` in useMessageDispatch / useQueueDispatch
        // so the enqueued shape matches what the dispatcher would have
        // computed at send time — except this version is frozen on the
        // QueuedMessage for the lifetime of that entry.
        const session = sessionMap.get(sessionId);
        const keySource =
          session?.keySource ?? creatorDefaultSelection?.keySource;
        const market = isHostedKey(keySource);
        const snapshotSelection: LastModelSelection | undefined = session
          ? {
              ...creatorDefaultSelection,
              keySource,
              model: market
                ? undefined
                : (session.model ?? creatorDefaultSelection?.model),
              listingModel: market
                ? (session.model ?? creatorDefaultSelection?.listingModel)
                : undefined,
              selectedAccountId:
                session.accountId ?? creatorDefaultSelection?.selectedAccountId,
              cliAgentType:
                session.cliAgentType ?? creatorDefaultSelection?.cliAgentType,
              tier: session.tier ?? creatorDefaultSelection?.tier,
            }
          : (creatorDefaultSelection ?? undefined);
        const snapshotMode: AgentExecMode =
          (session?.agentExecMode as AgentExecMode | undefined) ??
          creatorDefaultMode;

        if (explicitPostStopSubmit) {
          setUserInitiatedCancel(false);
        }

        enqueueMessage({
          id: `queued-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          turnIntentId,
          sessionId,
          content: contentForAgent,
          displayContent: finalInput,
          imageDataUrls,
          modelSelection: snapshotSelection,
          agentExecMode: snapshotMode,
          // Explicit post-Stop dispatches jump the queue and may interrupt;
          // everything else is a natural FIFO follow-up.
          priority: explicitPostStopSubmit ? "now" : "next",
          status: "queued",
          createdAt: new Date().toISOString(),
        });
        if (explicitPostStopSubmit) {
          setQueueFlushRequest((requestId) => requestId + 1);
        }
        // Light up the planning indicator immediately for the visible session.
        // The enqueue path used to return without any optimistic status, so a
        // message that was queued (turn FSM not idle) showed no "working"
        // feedback until the queue drainer finally dispatched it — which is
        // gated behind MIN_QUEUE_VISIBLE_MS + a backend re-check and is worst
        // for image turns whose first stream event lands seconds later. The
        // gate inside setSessionRuntimeStatusAtom drops this write for
        // background sessions, and `!isPendingCancel` suppresses it during a
        // Stop episode, so it is safe to call unconditionally here.
        if (!explicitPostStopSubmit) {
          beginOptimisticTurn(sessionId, "queue");
        }
        return;
      }

      // Capture the user-visible payload before any async append/dispatch work.
      // Stop can be clicked immediately after the composer clears, before the
      // optimistic EventStore append finishes, so cancel-restore needs this
      // synchronous source of truth for text and images.
      setLastUserMessage({
        sessionId,
        displayContent: finalInput,
        imageDataUrls: restoreImageDataUrls,
      });

      // Synchronously reserve the turn BEFORE any await: from this instant,
      // every concurrent submit and the queue dispatcher observe this session
      // as busy, so nothing can race a second direct dispatch.
      beginTurnDispatch(sessionId);

      beginOptimisticTurn(sessionId);
      setSessChatInput("");
      setLoading(true);
      _sharedSubmitGuard.current = true;
      _sharedSubmitPayload.current = submitPayloadKey;

      let userEventAppended = false;
      try {
        await addUserMessage(finalInput, imageDataUrls, turnIntentId);
        userEventAppended = true;
        void enterAgentOrgSessionIntervention(sessionId).catch((error) => {
          log.warn("[useWorkspaceChat] intervention failed:", error);
        });
        // Pass finalInput as displayText so the pill format is preserved in
        // the persisted event. Only needed when the agent content differs
        // (i.e. skill pills were expanded).
        const displayTextForDispatch =
          contentForAgent !== finalInput ? finalInput : undefined;
        await dispatchMessageBySessionType(
          sessionId,
          contentForAgent,
          imageDataUrls,
          undefined,
          displayTextForDispatch,
          directClientMessageId,
          turnIntentId
        );
      } catch (error) {
        log.error("Error sending message:", error);
        Message.error(t("errors.failedToSendMessage"));
        _sharedSubmitGuard.current = false;
        _sharedSubmitPayload.current = null;
        failOptimisticTurn(sessionId);
        // Close the turn reserved above. If the failure happened inside
        // dispatchMessageBySessionType it already marked its own generation
        // terminal, in which case this is a no-op generation bump.
        forceTurnIdle(sessionId);
        if (!userEventAppended) throw error;
        // NOT re-thrown after user event append: the message is already visible
        // in chat, so restoring the editor would create a duplicate-send risk.
      } finally {
        setLoading(false);
      }
    },
    [
      sessChatInput,
      addUserMessage,
      enqueueMessage,
      sessionMap,
      creatorDefaultSelection,
      creatorDefaultMode,
      dispatchMessageBySessionType,
      getSessionId,
      setLastUserMessage,
      setQueueFlushRequest,
      setUserInitiatedCancel,
      store,
      t,
    ]
  );

  // ============================================
  // Send Message (Generic)
  // ============================================
  const sendMessage = useCallback(
    async (content: string) => {
      const sessionId = getSessionId();
      if (!sessionId) {
        Message.error(t("errors.noSessionIdFound"));
        return;
      }

      setLoading(true);

      try {
        const submitPayloadKey = buildSubmitPayloadKey(sessionId, content);
        await addUserMessage(content);
        await dispatchMessageBySessionType(
          sessionId,
          content,
          undefined,
          undefined,
          undefined,
          `direct:${sessionId}:${stableSubmitHash(submitPayloadKey)}`
        );
      } catch (error) {
        log.error("Error sending message:", error);
        Message.error(t("errors.failedToSendMessage"));
      } finally {
        setLoading(false);
      }
    },
    [addUserMessage, dispatchMessageBySessionType, getSessionId, t]
  );

  // ============================================
  // Derived State
  // ============================================
  const effectiveSessionId = resolvedSessionId || coreSessionId;

  const canStopAgent = useMemo(
    () =>
      isHosted ||
      (!!effectiveSessionId &&
        (isAgentSession(effectiveSessionId) ||
          isCliSession(effectiveSessionId))),
    [isHosted, effectiveSessionId]
  );

  // Resume is only meaningful for CLI-based sessions: the Rust process
  // stays alive and `cli_agent_resume` is a real tauri command. Rust-native
  // agent sessions (OS Agent, SDE Agent) have no resume — showing the orange
  // retry button for them would be dead UI. See agentDispatcher.resume which
  // throws "Agent sessions do not support resume".
  const canResume = useMemo(
    () => !!effectiveSessionId && isCliSession(effectiveSessionId),
    [effectiveSessionId]
  );

  // ============================================
  // Return Public API
  // ============================================
  return {
    sessChatInput,
    loading,
    isWpGeneWorking,

    isHosted,
    canStopAgent,
    canResume,

    handleSessInputChange,
    setSessChatInput,

    handleSessChatSubmit,
    sendMessage,

    resumeSession,
    interruptSession,
    stopSession,
  };
};

export default useWorkspaceChat;
export { useWorkspaceChat };
