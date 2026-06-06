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
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import {
  markQueueTurnWorking,
  shouldQueueSubmitAsActiveTurn,
} from "@src/engines/SessionCore/hooks/session/queueTurnGate";
import {
  isPendingCancelAtom,
  isSessionActiveAtom,
  lastUserMessageAtom,
  sessionRuntimeStatusAtom,
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
import { enqueueMessageAtom } from "@src/store/ui/messageQueueAtom";
import {
  isAgentSession,
  isCliSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

import { useMessageDispatch } from "./useMessageDispatch";
import { useSessionActions } from "./useSessionActions";

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

interface UseWorkspaceChatOptions {
  sessionId?: string;
}

export interface SubmitOptions {
  forceDispatch?: boolean;
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
  const setSessionRuntimeStatus = useSetAtom(sessionRuntimeStatusAtom);
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
    const observedSessionId =
      propSessionId ||
      coreSessionId ||
      resolvedSessionId ||
      activeSessionId ||
      workstationActiveSessionId ||
      null;
    if (isWpGeneWorking && observedSessionId) {
      markQueueTurnWorking(observedSessionId);
      return;
    }
    if (!isWpGeneWorking) {
      _sharedSubmitGuard.current = false;
      _sharedSubmitPayload.current = null;
    }
  }, [
    activeSessionId,
    coreSessionId,
    isWpGeneWorking,
    propSessionId,
    resolvedSessionId,
    workstationActiveSessionId,
  ]);

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
      imageDataUrls?: string[],
      options: SubmitOptions = {}
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

      await enterAgentOrgSessionIntervention(sessionId);
      const latestSessionRuntimeStatus = store.get(sessionRuntimeStatusAtom);
      const latestIsSessionActive = store.get(isSessionActiveAtom);
      const latestIsPendingCancel = store.get(isPendingCancelAtom);
      const runtimeIsWorking =
        latestSessionRuntimeStatus === "running" ||
        latestSessionRuntimeStatus === "installing" ||
        latestSessionRuntimeStatus === "waiting_for_user" ||
        latestSessionRuntimeStatus === "waiting_for_funds";
      const submitShouldQueueAsActiveTurn = shouldQueueSubmitAsActiveTurn({
        sessionId,
        isActive: latestIsSessionActive,
        runtimeIsWorking,
        pendingCancel: latestIsPendingCancel,
        submitGuardActive: _sharedSubmitGuard.current,
      });
      const supportsQueuedFollowups =
        submitShouldQueueAsActiveTurn ||
        isAgentSession(sessionId) ||
        isCliSession(sessionId) ||
        isCursorIdeSession(sessionId);
      const submitPayloadKey = buildSubmitPayloadKey(
        sessionId,
        finalInput,
        agentContent,
        imageDataUrls
      );
      if (
        !options.forceDispatch &&
        _sharedSubmitGuard.current &&
        !isWpGeneWorking &&
        _sharedSubmitPayload.current === submitPayloadKey
      ) {
        return;
      }
      // Enqueue if the agent is running OR a cancel is mid-flight.
      // `isPendingCancel` is set by interruptSession() and cleared by the
      // agent:complete/error handler, covering the window where the user
      // clicked stop but Rust has not yet wound the turn down. The queue
      // will auto-flush on the runtime-status falling edge.
      if (
        !options.forceDispatch &&
        supportsQueuedFollowups &&
        submitShouldQueueAsActiveTurn
      ) {
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

        enqueueMessage({
          id: `queued-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          sessionId,
          content: contentForAgent,
          displayContent: finalInput,
          imageDataUrls,
          modelSelection: snapshotSelection,
          agentExecMode: snapshotMode,
          requiresRuntimeSettle: true,
          status: "queued",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      // Capture the user-visible payload before any async append/dispatch work.
      // Stop can be clicked immediately after the composer clears, before the
      // optimistic EventStore append finishes, so cancel-restore needs this
      // synchronous source of truth for text and images.
      setLastUserMessage({
        displayContent: finalInput,
        imageDataUrls: restoreImageDataUrls,
      });

      // Mark running BEFORE appending the user message event.
      // usePlanningIndicator's cold-start path records `activationVersion`
      // synchronously on the same render where isSessionActive flips true.
      // If we append first, the Rust EventStore round-trip bumps `version`
      // before `activationVersion` is captured, breaking the cold-start
      // condition (`activationVersion === version`) and forcing the indicator
      // to wait the full 1-second warm-path delay instead of appearing instantly.
      setSessionRuntimeStatus("running");
      setSessChatInput("");
      setLoading(true);
      _sharedSubmitGuard.current = true;
      _sharedSubmitPayload.current = submitPayloadKey;

      let userEventAppended = false;
      try {
        await addUserMessage(finalInput, imageDataUrls);
        userEventAppended = true;
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
          displayTextForDispatch
        );
      } catch (error) {
        console.error("Error sending message:", error);
        Message.error(t("errors.failedToSendMessage"));
        _sharedSubmitGuard.current = false;
        _sharedSubmitPayload.current = null;
        setSessionRuntimeStatus("idle");
        if (!userEventAppended) throw error;
        // NOT re-thrown after user event append: the message is already visible
        // in chat, so restoring the editor would create a duplicate-send risk.
      } finally {
        setLoading(false);
      }
    },
    [
      sessChatInput,
      isWpGeneWorking,
      addUserMessage,
      enqueueMessage,
      sessionMap,
      creatorDefaultSelection,
      creatorDefaultMode,
      dispatchMessageBySessionType,
      getSessionId,
      setLastUserMessage,
      store,
      setSessionRuntimeStatus,
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
        await addUserMessage(content);
        await dispatchMessageBySessionType(sessionId, content);
      } catch (error) {
        console.error("Error sending message:", error);
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
