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
import { useTranslation } from "react-i18next";

import {
  AGENT_ORG_RUN_STATUS,
  type AgentOrgInboxRow,
  resumeAgentOrgRun,
  sendAgentOrgGroupChatMessage,
} from "@src/api/tauri/agent";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import {
  ChatRetryBanner,
  GroupChatPausedBanner,
  toChatRetryKind,
} from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { useChatPanelState } from "@src/engines/ChatPanel/hooks/useChatPanelState";
import { chatEventsAtom } from "@src/engines/SessionCore/derived/chatEvents";
import { derivePlanApprovalViewState } from "@src/engines/SessionCore/derived/planDisplayEvents";
import { useFileReviewSync } from "@src/hooks/fileReview";
import { createLogger } from "@src/hooks/logger";
import { useSessionWorkspaceSync } from "@src/hooks/session/useSessionWorkspaceSync";
import { activeSessionIdAtom } from "@src/store/session";
import {
  isSessionActiveAtom,
  sessionRuntimeStatusAtom,
  streamRetryStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { pendingPlanApprovalsAtom } from "@src/store/session/planApprovalAtom";
import { groupChatViewSessionIdAtom } from "@src/store/ui/chatPanelAtom";
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

import ChatHistory, { type ScrollNavState } from "./ChatHistory";
import { GroupChatProvider } from "./ChatHistory/GroupChatView/GroupChatContext";
import {
  AgentEventsTap,
  useGroupChatMergedEvents,
} from "./ChatHistory/GroupChatView/useGroupChatMergedEvents";
import { ChatHistoryOverrideContext } from "./ChatHistoryOverrideContext";
import { ChatSessionContext } from "./ChatSessionContext";
import InputArea from "./InputArea";
import AskQuestionCard from "./InputArea/AskQuestionCard";
import { ModeSwitchInputCard } from "./InputArea/ModeSwitchCard";
import PermissionCard from "./InputArea/PermissionCard";
import ActiveProcesses from "./InputArea/components/ActiveProcesses";
import AgentOrgInterventionPinBar from "./InputArea/components/AgentOrgInterventionPinBar";
import AgentOrgOverviewPanel from "./InputArea/components/AgentOrgOverviewPanel";
import CollapsedInlineRow from "./InputArea/components/CollapsedInlineRow";
import CompactFileChanges from "./InputArea/components/CompactFileChanges";
import CursorIdeFocusPoller from "./InputArea/components/CursorIdeFocusPoller";
import QueueEditModeCard from "./InputArea/components/QueueEditModeCard";
import QueuedMessages from "./InputArea/components/QueuedMessages";
import { useAgentOrgIntervention } from "./InputArea/components/useAgentOrgIntervention";
import { useAgentOrgMemberSessionJump } from "./InputArea/components/useAgentOrgMemberSessionJump";
import { useAgentOrgRunView } from "./InputArea/components/useAgentOrgRunView";
import { useComposerSections } from "./InputArea/hooks/useComposerSections";
import { useQueueEditMode } from "./InputArea/hooks/useQueueEditMode";
import CanvasInlineCard from "./blocks/CanvasInlineCard";
import { useCanvasPreviewForSession } from "./blocks/CanvasInlineCard/useCanvasPreviewForSession";
import CreatePlanCard from "./blocks/CreatePlanCard";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "./hooks/useInputArea/types";
import { useSessionActions } from "./hooks/useWorkspaceChat/useSessionActions";

const logger = createLogger("ChatView");
const CHAT_FLOATING_COMPOSER_FALLBACK_INSET_PX = 72;

interface GroupChatRoute {
  targetMemberId: string | null;
  body: string;
  displayText: string;
}

interface GroupChatPendingMessage {
  rowId: number;
  targetMemberId: string;
  targetMemberName: string;
  createdAt: string;
  displayText: string;
}

function normalizeMentionToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "");
}

function isInboxRowRead(row: AgentOrgInboxRow | undefined): boolean {
  return Boolean(row?.readAt && row.readAt.trim());
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function parseGroupChatRoute(
  rawText: string,
  members: ReadonlyArray<{
    memberId: string;
    name: string;
    isCoordinator: boolean;
  }>
): GroupChatRoute {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("@")) {
    return { targetMemberId: null, body: trimmed, displayText: trimmed };
  }

  const mentionText = trimmed.slice(1).trimStart();
  const mentionLower = mentionText.toLowerCase();
  const routeCandidates = members
    .flatMap((member) => {
      const labels = [member.name, member.memberId];
      if (member.isCoordinator) {
        labels.push("Coordinator");
      }
      return labels.map((label) => ({ label: label.trim(), member }));
    })
    .filter((candidate) => candidate.label.length > 0)
    .sort((left, right) => right.label.length - left.label.length);

  for (const candidate of routeCandidates) {
    const labelLower = candidate.label.toLowerCase();
    if (
      mentionLower === labelLower ||
      mentionLower.startsWith(`${labelLower} `) ||
      mentionLower.startsWith(`${labelLower}\n`)
    ) {
      return {
        targetMemberId: candidate.member.isCoordinator
          ? null
          : candidate.member.memberId,
        body: mentionText.slice(candidate.label.length).trim(),
        displayText: trimmed,
      };
    }
  }

  const tokenMatch = mentionText.match(/^([^\s]+)\s*(.*)$/s);
  const token = normalizeMentionToken(tokenMatch?.[1] ?? "");
  const member = members.find((candidate) => {
    const candidateNames = [candidate.memberId, candidate.name].map(
      normalizeMentionToken
    );
    return candidateNames.includes(token);
  });
  if (!member) {
    throw new Error(`Unknown Agent Org mention: @${tokenMatch?.[1] ?? ""}`);
  }
  return {
    targetMemberId: member.isCoordinator ? null : member.memberId,
    body: tokenMatch?.[2].trim() ?? "",
    displayText: trimmed,
  };
}

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
    const { t } = useTranslation("sessions");
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
        setFloatingComposerInset(CHAT_FLOATING_COMPOSER_FALLBACK_INSET_PX);
        return;
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
    const [groupChatPendingMessage, setGroupChatPendingMessage] =
      useState<GroupChatPendingMessage | null>(null);
    const [groupChatDisplayOverrides, setGroupChatDisplayOverrides] = useState<
      ReadonlyMap<number, string>
    >(() => new Map());
    const [isResumingGroupChat, setIsResumingGroupChat] = useState(false);
    const groupChatDefaultAppliedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
      setGroupChatPendingMessage(null);
      setGroupChatDisplayOverrides(new Map());
    }, [sessionId]);
    const handleScrollNavChange = useCallback((state: ScrollNavState) => {
      setScrollNav(state);
    }, []);

    const { payload: canvasPayload, dismiss: dismissCanvas } =
      useCanvasPreviewForSession(sessionId);
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
    const agentOrgInteractionSessionId =
      currentAgentOrgMember?.sessionRuntime?.sessionId ?? sessionId;
    const handleAgentOrgMemberSessionJump =
      useAgentOrgMemberSessionJump(sessionId);
    // Group chat view: per-session opt-in toggle. The atom holds the
    // coordinator session id for which group view is active, or null.
    // We compare against `sessionId` (not `agentOrgInteractionSessionId`)
    // so flipping the member pipeline does not turn the group view off.
    const groupChatViewSessionId = useAtomValue(groupChatViewSessionIdAtom);
    const setGroupChatViewSessionId = useSetAtom(groupChatViewSessionIdAtom);
    const groupChatViewActive = groupChatViewSessionId === sessionId;
    const queueSessionId = groupChatViewActive
      ? sessionId
      : agentOrgInteractionSessionId;

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

    // The group view is the default Agent Org surface once at least one
    // non-coordinator member has a runtime session. It should not depend on
    // task counts: users can group-chat before tasks exist, after tasks finish,
    // or when only inbox traffic exists.
    const groupChatViewAvailable = useMemo(() => {
      const members = agentOrgRunView?.members ?? [];
      if (members.length < 2) return false;
      return members.some(
        (member) => !member.isCoordinator && member.sessionRuntime?.sessionId
      );
    }, [agentOrgRunView]);
    const handleGroupChatViewToggle = useCallback(
      (active: boolean) => {
        if (sessionId) {
          groupChatDefaultAppliedRef.current.add(sessionId);
        }
        if (!active) {
          setGroupChatPendingMessage(null);
          setGroupChatDisplayOverrides(new Map());
        } else {
          setActiveSessionId(sessionId);
        }
        setGroupChatViewSessionId(active ? sessionId : null);
      },
      [sessionId, setActiveSessionId, setGroupChatViewSessionId]
    );
    useEffect(() => {
      if (!sessionId || !groupChatViewAvailable) return;
      if (groupChatDefaultAppliedRef.current.has(sessionId)) return;
      groupChatDefaultAppliedRef.current.add(sessionId);
      setGroupChatViewSessionId(sessionId);
    }, [groupChatViewAvailable, sessionId, setGroupChatViewSessionId]);

    // Reset when the toggle's prerequisites disappear (e.g. all
    // members deactivate) so the chat panel does not get stuck on a
    // stale group view.
    useEffect(() => {
      if (groupChatViewActive && !groupChatViewAvailable) {
        setGroupChatViewSessionId(null);
      }
    }, [
      groupChatViewActive,
      groupChatViewAvailable,
      setGroupChatViewSessionId,
    ]);
    const {
      mergedEvents: groupChatMergedEvents,
      agents: groupChatAgents,
      handleTapEvents: handleGroupChatTapEvents,
    } = useGroupChatMergedEvents(
      groupChatViewActive ? sessionId : null,
      agentOrgRunView?.members ?? [],
      agentOrgRunView?.inbox ?? [],
      groupChatDisplayOverrides
    );
    const groupChatMentionOptions = useMemo<ReadonlyArray<CustomMentionOption>>(
      () =>
        groupChatViewActive
          ? (agentOrgRunView?.members ?? []).map((member) => ({
              id: member.memberId,
              label: member.name,
              description: member.isCoordinator ? "Coordinator" : member.role,
            }))
          : [],
      [agentOrgRunView?.members, groupChatViewActive]
    );
    const groupChatRunPaused =
      groupChatViewActive &&
      agentOrgRunView?.runStatus === AGENT_ORG_RUN_STATUS.PAUSED;
    useEffect(() => {
      if (!groupChatPendingMessage || !agentOrgRunView) return;
      const pendingRow = agentOrgRunView.inbox.find(
        (row) => row.id === groupChatPendingMessage.rowId
      );
      if (isInboxRowRead(pendingRow)) {
        setGroupChatPendingMessage(null);
        return;
      }

      const targetMember = agentOrgRunView.members.find(
        (member) => member.memberId === groupChatPendingMessage.targetMemberId
      );
      const targetSessionId = targetMember?.isCoordinator
        ? sessionId
        : targetMember?.sessionRuntime?.sessionId;
      const pendingCreatedAtMs = timestampMs(groupChatPendingMessage.createdAt);
      const targetHasStartedAfterMessage = groupChatMergedEvents.some(
        (event) => {
          if (!targetSessionId || event.sessionId !== targetSessionId)
            return false;
          const eventMs = timestampMs(event.createdAt);
          return (
            eventMs !== null &&
            pendingCreatedAtMs !== null &&
            eventMs >= pendingCreatedAtMs &&
            (event.source === "assistant" ||
              event.args?.agentOrgInboxTranscript === true ||
              event.result?.agentOrgInboxTranscript === true)
          );
        }
      );
      if (targetHasStartedAfterMessage) {
        setGroupChatPendingMessage(null);
      }
    }, [
      agentOrgRunView,
      groupChatMergedEvents,
      groupChatPendingMessage,
      sessionId,
    ]);

    const handleResumeGroupChatRun = useCallback(async () => {
      if (!sessionId || isResumingGroupChat) return;
      setIsResumingGroupChat(true);
      try {
        await resumeAgentOrgRun(sessionId);
        await refreshAgentOrgRunView();
      } catch (err: unknown) {
        logger.error("Failed to resume Agent Org run from group chat:", err);
      } finally {
        setIsResumingGroupChat(false);
      }
    }, [isResumingGroupChat, refreshAgentOrgRunView, sessionId]);

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

    const handleGroupChatSubmitOverride = useCallback(
      async (input: SubmitOverrideInput): Promise<boolean> => {
        if (!agentOrgRunView) return false;
        const content = input.agentContent ?? input.displayText;
        if (!groupChatViewActive && !content.trim().startsWith("@")) {
          return false;
        }
        let route: GroupChatRoute;
        try {
          route = parseGroupChatRoute(content, agentOrgRunView.members);
        } catch (err) {
          if (!groupChatViewActive) return false;
          throw err;
        }
        if (input.imageDataUrls && input.imageDataUrls.length > 0) {
          throw new Error("Group chat does not support image attachments yet");
        }
        if (!route.body.trim()) {
          throw new Error("Agent Org group chat message content is required");
        }
        const response = await sendAgentOrgGroupChatMessage(
          sessionId,
          route.targetMemberId,
          route.body
        );
        setGroupChatDisplayOverrides((prev) => {
          const next = new Map(prev);
          next.set(response.inboxRow.id, route.displayText);
          return next;
        });
        setGroupChatPendingMessage({
          rowId: response.inboxRow.id,
          targetMemberId: response.targetMemberId,
          targetMemberName: response.targetMemberName,
          createdAt: response.inboxRow.createdAt,
          displayText: route.displayText,
        });
        await refreshAgentOrgRunView();
        return true;
      },
      [agentOrgRunView, groupChatViewActive, refreshAgentOrgRunView, sessionId]
    );

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
            <div
              ref={floatingComposerRef}
              className="absolute bottom-0 left-0 right-0 z-50 flex w-full flex-shrink-0 flex-col items-center px-2 pb-2 pt-1"
            >
              <div
                className={`flex w-full flex-col gap-1.5 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
              >
                {currentPlanApproval && shouldShowCurrentPlanSurface && (
                  <CreatePlanCard
                    key={`current-plan-${currentPlanApproval.planRevisionId ?? currentPlanApproval.toolCallId ?? currentPlanApproval.planPath}`}
                    content={currentPlanApproval.planContent}
                    title={currentPlanApproval.planTitle}
                    isStreaming={false}
                    toolCallId={currentPlanApproval.toolCallId}
                    planId={currentPlanApproval.planId}
                    planRevisionId={currentPlanApproval.planRevisionId}
                    sessionId={sessionId}
                    surface="current"
                    surfaceState={currentPlanSurfaceState}
                    collapsed={planCollapsed}
                    onCollapse={collapsePlan}
                  />
                )}

                {/* Primary cards — collapsed state controlled by pill row.
                    Keys are namespaced per card so each remounts on session
                    switch (clearing local state) without colliding with its
                    siblings under the same parent. */}
                <AskQuestionCard
                  key={`ask-${sessionId}`}
                  collapsed={questionCollapsed}
                  onCollapse={collapseQuestion}
                  onHasDataChange={setHasQuestion}
                />
                <PermissionCard
                  key={`permission-${sessionId}`}
                  sessionId={sessionId}
                  collapsed={permissionCollapsed}
                  onCollapse={collapsePermission}
                  onHasDataChange={setHasPermission}
                />
                <ModeSwitchInputCard
                  key={`mode-switch-tracker-${sessionId}`}
                  collapsed
                  onHasDataChange={setHasModeSwitch}
                />

                {/* Expanded section card — shown above pill row */}
                {queueExpanded && (
                  <QueuedMessages
                    messages={sessionMessageQueue}
                    onCancel={cancelQueuedMessage}
                    onSendNow={handleSendNow}
                    onReorder={handleReorderSessionQueue}
                    onToggle={toggleQueue}
                  />
                )}
                {processExpanded && (
                  <ActiveProcesses
                    key={`process-expanded-${sessionId}`}
                    onToggle={toggleProcess}
                    onVisibleCountChange={setProcessVisibleCount}
                  />
                )}
                {filesExpanded && (
                  <CompactFileChanges
                    key={`files-expanded-${sessionId}`}
                    onToggle={toggleFiles}
                    onVisibleStatsChange={setFileChangeStats}
                  />
                )}

                {/* Always-mounted hidden instances for count tracking */}
                {!processExpanded && (
                  <ActiveProcesses
                    key={`process-hidden-${sessionId}`}
                    onToggle={toggleProcess}
                    onVisibleCountChange={setProcessVisibleCount}
                    hidden
                  />
                )}
                {!filesExpanded && (
                  <CompactFileChanges
                    key={`files-hidden-${sessionId}`}
                    onToggle={toggleFiles}
                    onVisibleStatsChange={setFileChangeStats}
                    hidden
                  />
                )}

                <QueueEditModeCard />

                {canvasPayload && (
                  <CanvasInlineCard
                    mode={canvasPayload.mode}
                    title={canvasPayload.title}
                    content={canvasPayload.content}
                    url={canvasPayload.url}
                    isStreaming={canvasPayload.streaming ?? false}
                    onClose={dismissCanvas}
                  />
                )}

                {groupChatPendingMessage && groupChatViewActive && (
                  <div
                    data-testid="agent-org-group-chat-pending"
                    data-target-name={groupChatPendingMessage.targetMemberName}
                    className="bg-background-2 mx-auto flex items-center gap-2 rounded-full border border-solid border-border-2 px-3 py-1 text-[12px] text-text-2 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6" />
                    <span>
                      {t("groupChat.userMessagePending", {
                        member: groupChatPendingMessage.targetMemberName,
                        defaultValue: "{{member}} is picking up your message",
                      })}
                    </span>
                  </div>
                )}

                <InputArea
                  omitChatHeader
                  sessionId={inputAreaSessionId}
                  onSubmitOverride={handleGroupChatSubmitOverride}
                  customMentionOptions={groupChatMentionOptions}
                  topRowPills={
                    hasAny ||
                    scrollNav?.showScrollToBottom ||
                    scrollNav?.showFollowAgent ? (
                      <CollapsedInlineRow
                        sections={inlineSections}
                        scrollNav={scrollNav}
                      />
                    ) : null
                  }
                  statusBanners={
                    <>
                      {hasModeSwitch && !modeSwitchCollapsed && (
                        <ModeSwitchInputCard
                          key={`mode-switch-status-${sessionId}`}
                          collapsed={false}
                          onCollapse={collapseModeSwitch}
                        />
                      )}
                      {hasAgentOrgIntervention && (
                        <AgentOrgInterventionPinBar
                          intervention={agentOrgIntervention}
                          memberName={currentAgentOrgMember?.name}
                          error={agentOrgInterventionError}
                          returning={agentOrgInterventionReturning}
                          onReturnToWork={returnAgentOrgMemberToWork}
                        />
                      )}
                      {streamRetry && (
                        <ChatRetryBanner
                          kind={toChatRetryKind(streamRetry.kind)}
                          attempt={streamRetry.attempt}
                          maxAttempts={streamRetry.maxAttempts}
                        />
                      )}
                      {groupChatPausedBottomContent}
                    </>
                  }
                  {...queueEditProps}
                />
                {/* Cursor IDE sessions need their own poll loop to
                    pick up new bubbles streamed by the live probe.
                    The hook is mounted here (focused chat panel)
                    rather than inside InputArea so it doesn't fire
                    for embedded chat surfaces (kanban detail panel,
                    project-manager tab) that aren't the active view. */}
                {isCursorIdeSession(sessionId) && (
                  <CursorIdeFocusPoller sessionId={sessionId} />
                )}
              </div>
            </div>
          )}
        </div>
      </ChatSessionContext.Provider>
    );
  }
);

ChatView.displayName = "ChatView";

export default ChatView;
