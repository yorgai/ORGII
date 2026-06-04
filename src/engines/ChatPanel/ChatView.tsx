/**
 * ChatView — Reusable chat content component
 *
 * Renders ChatHistory + InputArea for a given session.
 * Can be used in:
 * - Sidebar mode (inside ChatPanel)
 * - Tab mode (inside WorkStation tabs)
 *
 * Both modes write activeSessionIdAtom so that SessionSyncProvider
 * loads the correct session data into the global event store.
 * Secondary surfaces additionally null the pipeline atom on unmount
 * when they were the last claimant, so that event streaming does not
 * outlive the embedding.
 *
 * This component handles:
 * - File Review sync (via ChatInteractArea)
 * - Message queue display
 * - ChatHistory + ChatInteractArea rendering
 *
 * It does NOT handle:
 * - Sidebar positioning/resize
 * - Session tab bar / header
 * - Session creator (shown when no session)
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GroupChatPausedBanner } from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { useAgentOrgGroupChatController } from "@src/engines/ChatPanel/hooks/useAgentOrgGroupChatController";
import { useChatPanelState } from "@src/engines/ChatPanel/hooks/useChatPanelState";
import { chatEventsAtom } from "@src/engines/SessionCore/derived/chatEvents";
import { derivePlanApprovalViewState } from "@src/engines/SessionCore/derived/planDisplayEvents";
import { useFileReviewSync } from "@src/hooks/fileReview";
import { useSessionWorkspaceSync } from "@src/hooks/session/useSessionWorkspaceSync";
import { activeSessionIdAtom } from "@src/store/session";
import {
  isSessionActiveAtom,
  sessionRuntimeStatusAtom,
  streamRetryStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { pendingPlanApprovalsAtom } from "@src/store/session/planApprovalAtom";
import {
  dequeueMessageAtom,
  editMessageAtom,
  enqueueCountAtom,
  messageQueueAtom,
  promoteMessageAtom,
  queueFlushRequestAtom,
  reorderQueueAtom,
} from "@src/store/ui/messageQueueAtom";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import ChatFloatingComposer from "./ChatFloatingComposer";
import ChatHistory, { type ScrollNavState } from "./ChatHistory";
import { GroupChatProvider } from "./ChatHistory/GroupChatView/GroupChatContext";
import { AgentEventsTap } from "./ChatHistory/GroupChatView/useGroupChatMergedEvents";
import { ChatHistoryOverrideContext } from "./ChatHistoryOverrideContext";
import { ChatSessionContext } from "./ChatSessionContext";
import AgentOrgOverviewPanel from "./InputArea/components/AgentOrgOverviewPanel";
import { useAgentOrgIntervention } from "./InputArea/components/useAgentOrgIntervention";
import { useAgentOrgMemberSessionJump } from "./InputArea/components/useAgentOrgMemberSessionJump";
import { useAgentOrgRunView } from "./InputArea/components/useAgentOrgRunView";
import { useComposerSections } from "./InputArea/hooks/useComposerSections";
import { useQueueEditMode } from "./InputArea/hooks/useQueueEditMode";
import { useSessionActions } from "./hooks/useWorkspaceChat/useSessionActions";

const CHAT_FLOATING_COMPOSER_FALLBACK_INSET_PX = 72;

export interface ChatViewProps {
  /** Session ID to display. Sync bridges and events load for this session. */
  sessionId: string;
  onRegisterSearchOpen?: (handler: (() => void) | null) => void;
  turnPaginationEnabled?: boolean;
  /** Opaque background class for sticky headers (must match the container surface).
   *  Defaults to "bg-chat-pane" (side panel). Pass EDITOR_TAB_CANVAS_BG_CLASS for WorkStation. */
  surfaceBgClass?: string;
  /**
   * Passive replay mode: this ChatView does NOT write the pipeline
   * atom AND does NOT mirror the IDE workspace folders into the
   * session's backend workspace. Use for editor-tab session inspection
   * where the chat is a read-only artifact.
   */
  readOnly?: boolean;
  /**
   * Secondary/inspect mode: this ChatView DOES claim the pipeline
   * (so live events stream and the user can interact), but does NOT
   * mutate the session's persisted backend workspace via
   * `useSessionWorkspaceSync`. Use when showing another session's
   * chat in a non-primary surface (kanban detail, project-manager
   * tab) — those sessions may belong to a totally different repo and
   * we must not silently rewrite their workspace footprint to match
   * the IDE's current folders.
   */
  secondary?: boolean;
}

const ChatView: React.FC<ChatViewProps> = memo(
  ({
    sessionId,
    onRegisterSearchOpen,
    turnPaginationEnabled = true,
    surfaceBgClass = "bg-chat-pane",
    readOnly = false,
    secondary = false,
  }) => {
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const store = useStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const floatingComposerRef = useRef<HTMLDivElement>(null);
    const [floatingComposerInset, setFloatingComposerInset] = useState(
      CHAT_FLOATING_COMPOSER_FALLBACK_INSET_PX
    );

    useEffect(() => {
      if (readOnly) return;
      setActiveSessionId(sessionId);

      // Secondary surfaces (e.g. kanban detail panel) must release the
      // pipeline when the embedding closes, otherwise event streaming
      // would keep running for a session no surface is showing. We
      // only release if the pipeline is still pointing at this view's
      // session — another surface may already have taken over.
      // Primary (WorkStation) surfaces don't release on unmount: the
      // pipeline atom is owned by WorkStation memory, which the bridge
      // re-asserts whenever WorkStation is active.
      if (!secondary) return;
      return () => {
        const current = store.get(activeSessionIdAtom);
        if (current === sessionId) {
          setActiveSessionId(null);
        }
      };
    }, [sessionId, setActiveSessionId, readOnly, secondary, store]);

    useFileReviewSync(sessionId, !readOnly && !secondary);

    const isCursorIde = isCursorIdeSession(sessionId);

    // Backend `agent_session_list_workspaces` only resolves sessions whose
    // runtime is currently attached. Historical sessions (status
    // `completed` / `failed` / `cancelled`) are persisted in `sessions.db`
    // but their runtime is dropped; the workspace state will be re-built
    // lazily by `init_session` on the next `agent_send_message`. Gate the
    // sync on a live status so opening a finished session in ChatView
    // doesn't fire a guaranteed `not found` snapshot pull.
    const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
    const isLiveStatus =
      runtimeStatus === "running" || runtimeStatus === "installing";

    useSessionWorkspaceSync({
      sessionId,
      // Workspace sync only runs for live agent sessions on the *primary*
      // surface — never for read-only replay, secondary inspection,
      // imported Cursor IDE history rows, or historical sessions whose
      // runtime is not attached. Once the user sends a follow-up,
      // `agent_send_message` re-inits the runtime and flips the status
      // to "running", which lets sync resume.
      enabled: !readOnly && !secondary && !isCursorIde && isLiveStatus,
    });

    // Cursor IDE sessions used to swap the composer for a read-only
    // banner; they're now writable through the regular `InputArea`
    // (the model pill swaps to a Cursor-aware variant inside that
    // component, and `cursorIdeAdapter.sendMessage` runs the probe
    // dispatch).

    const { showInteractArea } = useChatPanelState();

    useLayoutEffect(() => {
      if (!showInteractArea) {
        const animationFrameId = window.requestAnimationFrame(() => {
          setFloatingComposerInset(CHAT_FLOATING_COMPOSER_FALLBACK_INSET_PX);
        });
        return () => window.cancelAnimationFrame(animationFrameId);
      }
      const element = floatingComposerRef.current;
      if (!element) return;

      const updateInset = () => {
        const height = Math.ceil(element.getBoundingClientRect().height);
        setFloatingComposerInset((previous) =>
          Math.abs(previous - height) >= 4 ? height : previous
        );
      };

      updateInset();
      const resizeObserver = new ResizeObserver(updateInset);
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }, [showInteractArea]);

    const streamRetryStatus = useAtomValue(streamRetryStatusAtom);
    const streamRetry =
      streamRetryStatus?.sessionId === sessionId ? streamRetryStatus : null;
    const currentPlanApproval = useAtomValue(pendingPlanApprovalsAtom).get(
      sessionId
    )?.current;
    const chatEvents = useAtomValue(chatEventsAtom);
    const planViewState = useMemo(
      () =>
        derivePlanApprovalViewState({
          pendingPlan: currentPlanApproval,
          chatEvents,
          displayEvents: chatEvents,
        }),
      [chatEvents, currentPlanApproval]
    );
    const showCurrentPlanSurface = planViewState.currentSurfaceVisible;
    const currentPlanSurfaceState = planViewState.activePendingEvent
      ? planViewState.getEventState(planViewState.activePendingEvent, "current")
      : undefined;

    const [scrollNav, setScrollNav] = useState<ScrollNavState | null>(null);
    const handleScrollNavChange = useCallback((state: ScrollNavState) => {
      setScrollNav(state);
    }, []);

    const {
      view: agentOrgRunView,
      error: agentOrgRunViewError,
      refresh: refreshAgentOrgRunView,
    } = useAgentOrgRunView(sessionId);
    // The dropdown's "current member" highlight should follow the
    // pipeline session, not the backend's `currentMemberId`. The
    // member selector now flips only the pipeline atom (via
    // `useAgentOrgMemberSessionJump`) so the parent ChatView keeps
    // rendering the org session — meaning the run view is fetched
    // against the parent and its `currentMemberId` would stick to
    // coordinator no matter which member the user picks. Match the
    // pipeline session against `sessionRuntime.sessionId` first; fall
    // back to the backend hint when no member matches (e.g. before
    // members hydrate or for the bare coordinator session).
    const pipelineSessionId = useAtomValue(activeSessionIdAtom);
    const currentAgentOrgMember = useMemo(() => {
      if (!agentOrgRunView) return null;
      const members = agentOrgRunView.members;
      if (pipelineSessionId) {
        const byPipeline = members.find(
          (member) => member.sessionRuntime?.sessionId === pipelineSessionId
        );
        if (byPipeline) return byPipeline;
      }
      if (!agentOrgRunView.currentMemberId) return null;
      return (
        members.find(
          (member) => member.memberId === agentOrgRunView.currentMemberId
        ) ?? null
      );
    }, [agentOrgRunView, pipelineSessionId]);
    const {
      agentOrgInteractionSessionId,
      queueSessionId,
      groupChatViewActive,
      groupChatViewAvailable,
      groupChatMergedEvents,
      groupChatAgents,
      handleGroupChatTapEvents,
      groupChatMentionOptions,
      groupChatRunPaused,
      groupChatPendingMessage,
      isResumingGroupChat,
      handleResumeGroupChatRun,
      handleGroupChatViewToggle,
      handleGroupChatSubmitOverride,
    } = useAgentOrgGroupChatController({
      sessionId,
      agentOrgRunView,
      currentAgentOrgMember,
      refreshAgentOrgRunView,
    });

    const handleAgentOrgMemberSessionJump =
      useAgentOrgMemberSessionJump(sessionId);

    // Message queue — keep this aligned with InputArea.sessionId so queued
    // follow-ups written by the composer are visible on the same surface.
    const messageQueue = useAtomValue(messageQueueAtom);
    const sessionMessageQueue = useMemo(
      () =>
        messageQueue.filter((message) => message.sessionId === queueSessionId),
      [messageQueue, queueSessionId]
    );
    const enqueueCount = useAtomValue(enqueueCountAtom);
    const cancelQueuedMessage = useSetAtom(dequeueMessageAtom);
    const editQueuedMessage = useSetAtom(editMessageAtom);
    const reorderQueue = useSetAtom(reorderQueueAtom);
    const isSessionActive = useAtomValue(isSessionActiveAtom);
    const promoteQueuedMessage = useSetAtom(promoteMessageAtom);
    const setQueueFlushRequest = useSetAtom(queueFlushRequestAtom);

    const getQueueSessionId = useCallback(
      () => queueSessionId,
      [queueSessionId]
    );
    const { interruptSession } = useSessionActions({
      getSessionId: getQueueSessionId,
    });
    const handleSendNow = useCallback(
      (messageId: string) => {
        const message = messageQueue.find((item) => item.id === messageId);
        if (!message) return;
        promoteQueuedMessage(messageId);
        if (isSessionActive) {
          void interruptSession({ restoreQueueHead: false });
        }
        setQueueFlushRequest((requestId) => requestId + 1);
      },
      [
        messageQueue,
        promoteQueuedMessage,
        interruptSession,
        isSessionActive,
        setQueueFlushRequest,
      ]
    );

    const handleCommitQueueEdit = useCallback(
      (messageId: string, content: string, imageDataUrls?: string[]) => {
        editQueuedMessage({ messageId, content, imageDataUrls });
      },
      [editQueuedMessage]
    );

    const handleReorderSessionQueue = useCallback(
      (fromIndex: number, toIndex: number) => {
        const fromMessage = sessionMessageQueue[fromIndex];
        const toMessage = sessionMessageQueue[toIndex];
        if (!fromMessage || !toMessage) return;
        const globalFromIndex = messageQueue.findIndex(
          (message) => message.id === fromMessage.id
        );
        const globalToIndex = messageQueue.findIndex(
          (message) => message.id === toMessage.id
        );
        reorderQueue({ fromIndex: globalFromIndex, toIndex: globalToIndex });
      },
      [messageQueue, reorderQueue, sessionMessageQueue]
    );
    const queueEditProps = useQueueEditMode({
      onCommit: handleCommitQueueEdit,
      onCommitSendNow: handleSendNow,
    });

    const groupChatPausedBottomContent = groupChatRunPaused ? (
      <GroupChatPausedBanner
        disabled={isResumingGroupChat}
        onResume={handleResumeGroupChatRun}
      />
    ) : null;

    const {
      intervention: agentOrgIntervention,
      error: agentOrgInterventionError,
      returning: agentOrgInterventionReturning,
      returnToWork: returnAgentOrgMemberToWork,
    } = useAgentOrgIntervention(agentOrgInteractionSessionId);
    const isViewingAgentOrgMemberPlan =
      currentAgentOrgMember !== null && !currentAgentOrgMember.isCoordinator;
    const shouldShowCurrentPlanSurface =
      showCurrentPlanSurface && !isViewingAgentOrgMemberPlan;

    // Primary card active-data state (reported up by each card)
    const [hasQuestion, setHasQuestion] = useState(false);
    const [hasPermission, setHasPermission] = useState(false);
    const [hasModeSwitch, setHasModeSwitch] = useState(false);
    const hasPlan = Boolean(
      currentPlanApproval && shouldShowCurrentPlanSurface
    );

    const {
      questionCollapsed,
      permissionCollapsed,
      modeSwitchCollapsed,
      planCollapsed,
      collapseQuestion,
      collapsePermission,
      collapseModeSwitch,
      collapsePlan,
      queueExpanded,
      processExpanded,
      filesExpanded,
      toggleQueue,
      toggleProcess,
      toggleFiles,
      hasAny,
      inlineSections,
      setProcessVisibleCount,
      setFileChangeStats,
    } = useComposerSections({
      sessionId,
      queueCount: sessionMessageQueue.length,
      enqueueCount,
      hasQuestion,
      hasPermission,
      hasModeSwitch,
      hasPlan,
    });

    const hasAgentOrgIntervention =
      agentOrgInterventionError !== null || agentOrgIntervention !== null;

    // ChatSessionContext provides the *content* session id — pipeline,
    // chat history, pinned bars, reload, etc. all key off this value.
    // When the user picks an Agent-Org member via the chip / pagination
    // pills, the pipeline atom flips to that member's session but the
    // ChatPanel's `sessionId` prop (= WorkStation memory) stays anchored
    // to the parent so the header/sidebar don't move. Without using the
    // member id here, ChatHistory would keep rendering the parent's
    // events even though the streaming pipeline has already moved on.
    // Group chat is the exception: the rendered history is the merged
    // coordinator-scoped feed, and header actions such as collapse-all are
    // keyed by the coordinator session id.
    const chatHistorySessionId = groupChatViewActive
      ? sessionId
      : agentOrgInteractionSessionId;
    const inputAreaSessionId = queueSessionId;

    return (
      <ChatSessionContext.Provider value={chatHistorySessionId}>
        <div
          ref={rootRef}
          data-chat-view-root
          data-session-id={chatHistorySessionId}
          className="relative flex h-full min-w-0 max-w-full flex-col overflow-hidden"
        >
          {/* Chat history takes full height; input overlaps from below. */}
          <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden">
            <ChatHistoryOverrideContext.Provider
              value={groupChatViewActive ? groupChatMergedEvents : undefined}
            >
              <GroupChatProvider
                enabled={groupChatViewActive}
                coordinatorSessionId={sessionId}
                orgMembers={agentOrgRunView?.members ?? []}
              >
                {groupChatViewActive &&
                  groupChatAgents.map((agent) => (
                    <AgentEventsTap
                      key={agent.sessionId}
                      sessionId={agent.sessionId}
                      onEvents={handleGroupChatTapEvents}
                    />
                  ))}
                <ChatHistory
                  surfaceBgClass={surfaceBgClass}
                  agentOrgCurrentMemberName={
                    currentAgentOrgMember?.name ?? null
                  }
                  agentOrgCurrentMemberId={
                    currentAgentOrgMember?.memberId ?? null
                  }
                  agentOrgMembers={agentOrgRunView?.members ?? []}
                  agentOrgOverviewPanel={
                    agentOrgRunView || agentOrgRunViewError ? (
                      <AgentOrgOverviewPanel
                        view={agentOrgRunView}
                        error={agentOrgRunViewError}
                        currentSessionId={sessionId}
                        onRefresh={refreshAgentOrgRunView}
                      />
                    ) : null
                  }
                  onAgentOrgMemberSelect={handleAgentOrgMemberSessionJump}
                  onAgentOrgRunViewRefresh={refreshAgentOrgRunView}
                  onScrollNavChange={handleScrollNavChange}
                  onRegisterSearchOpen={onRegisterSearchOpen}
                  turnPaginationEnabled={turnPaginationEnabled}
                  bottomInset={showInteractArea ? floatingComposerInset : 0}
                  groupChatViewAvailable={groupChatViewAvailable}
                  groupChatViewActive={groupChatViewActive}
                  onGroupChatViewToggle={handleGroupChatViewToggle}
                />
              </GroupChatProvider>
            </ChatHistoryOverrideContext.Provider>
          </div>
          {showInteractArea && (
            <ChatFloatingComposer
              composerRef={floatingComposerRef}
              sessionId={sessionId}
              inputAreaSessionId={inputAreaSessionId}
              currentPlanApproval={currentPlanApproval}
              shouldShowCurrentPlanSurface={shouldShowCurrentPlanSurface}
              currentPlanSurfaceState={currentPlanSurfaceState}
              planCollapsed={planCollapsed}
              onPlanCollapse={collapsePlan}
              questionCollapsed={questionCollapsed}
              permissionCollapsed={permissionCollapsed}
              modeSwitchCollapsed={modeSwitchCollapsed}
              onQuestionCollapse={collapseQuestion}
              onPermissionCollapse={collapsePermission}
              onModeSwitchCollapse={collapseModeSwitch}
              onQuestionDataChange={setHasQuestion}
              onPermissionDataChange={setHasPermission}
              onModeSwitchDataChange={setHasModeSwitch}
              queueExpanded={queueExpanded}
              processExpanded={processExpanded}
              filesExpanded={filesExpanded}
              queuedMessages={sessionMessageQueue}
              onCancelQueuedMessage={cancelQueuedMessage}
              onSendQueuedMessageNow={handleSendNow}
              onReorderQueuedMessages={handleReorderSessionQueue}
              onToggleQueue={toggleQueue}
              onToggleProcess={toggleProcess}
              onToggleFiles={toggleFiles}
              onProcessVisibleCountChange={setProcessVisibleCount}
              onFileChangeStatsChange={setFileChangeStats}
              groupChatPendingMessage={groupChatPendingMessage}
              groupChatViewActive={groupChatViewActive}
              hasAnyInlineSection={hasAny}
              scrollNav={scrollNav}
              inlineSections={inlineSections}
              hasModeSwitch={hasModeSwitch}
              agentOrgIntervention={
                hasAgentOrgIntervention
                  ? {
                      intervention: agentOrgIntervention,
                      memberName: currentAgentOrgMember?.name,
                      error: agentOrgInterventionError,
                      returning: agentOrgInterventionReturning,
                      onReturnToWork: returnAgentOrgMemberToWork,
                    }
                  : null
              }
              streamRetry={streamRetry}
              groupChatPausedBottomContent={groupChatPausedBottomContent}
              onSubmitOverride={handleGroupChatSubmitOverride}
              customMentionOptions={groupChatMentionOptions}
              queueEditProps={queueEditProps}
            />
          )}
        </div>
      </ChatSessionContext.Provider>
    );
  }
);

ChatView.displayName = "ChatView";

export default ChatView;
