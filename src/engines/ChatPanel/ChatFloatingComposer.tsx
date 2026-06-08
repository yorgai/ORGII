import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import type { AgentOrgMemberIntervention } from "@src/api/tauri/agent";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import {
  ChatRetryBanner,
  toChatRetryKind,
} from "@src/engines/ChatPanel/components/ChatStatusBanners";
import type { PendingPlanApproval } from "@src/store/session/planApprovalAtom";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import type { ScrollNavState } from "./ChatHistory";
import InputArea from "./InputArea";
import AskQuestionCard from "./InputArea/AskQuestionCard";
import { ModeSwitchInputCard } from "./InputArea/ModeSwitchCard";
import PermissionCard from "./InputArea/PermissionCard";
import ActiveProcesses from "./InputArea/components/ActiveProcesses";
import AgentOrgInterventionPinBar from "./InputArea/components/AgentOrgInterventionPinBar";
import CollapsedInlineRow, {
  type InlineSection,
} from "./InputArea/components/CollapsedInlineRow";
import CompactFileChanges, {
  type FileChangeVisibleStats,
} from "./InputArea/components/CompactFileChanges";
import CursorIdeFocusPoller from "./InputArea/components/CursorIdeFocusPoller";
import QueueEditModeCard from "./InputArea/components/QueueEditModeCard";
import QueuedMessages from "./InputArea/components/QueuedMessages";
import type { QueueEditInputAreaProps } from "./InputArea/hooks/useQueueEditMode";
import CreatePlanCard from "./blocks/CreatePlanCard";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "./hooks/useInputArea/types";

interface StreamRetryInfo {
  kind: string;
  attempt: number;
  maxAttempts: number;
}

interface AgentOrgInterventionView {
  intervention: AgentOrgMemberIntervention | null;
  memberName?: string | null;
  error: string | null;
  returning: boolean;
  onReturnToWork: () => Promise<boolean>;
}

interface GroupChatPendingMessageView {
  targetMemberName: string;
}

interface ChatFloatingComposerProps {
  composerRef: React.RefObject<HTMLDivElement>;
  inputBoxRef?: React.Ref<HTMLDivElement>;
  chatPanelPosition: "left" | "right";
  sessionId: string;
  inputAreaSessionId: string;
  currentPlanApproval: PendingPlanApproval | null | undefined;
  shouldShowCurrentPlanSurface: boolean;
  currentPlanSurfaceState: Parameters<typeof CreatePlanCard>[0]["surfaceState"];
  planCollapsed: boolean;
  onPlanCollapse: () => void;
  questionCollapsed: boolean;
  permissionCollapsed: boolean;
  modeSwitchCollapsed: boolean;
  onQuestionCollapse: () => void;
  onPermissionCollapse: () => void;
  onModeSwitchCollapse: () => void;
  onQuestionDataChange: (hasData: boolean) => void;
  onPermissionDataChange: (hasData: boolean) => void;
  onModeSwitchDataChange: (hasData: boolean) => void;
  queueExpanded: boolean;
  processExpanded: boolean;
  queuedMessages: Parameters<typeof QueuedMessages>[0]["messages"];
  onCancelQueuedMessage: Parameters<typeof QueuedMessages>[0]["onCancel"];
  onSendQueuedMessageNow: Parameters<typeof QueuedMessages>[0]["onSendNow"];
  onReorderQueuedMessages: Parameters<typeof QueuedMessages>[0]["onReorder"];
  onToggleQueue: () => void;
  onToggleProcess: () => void;
  onToggleFiles: () => void;
  onProcessVisibleCountChange: (count: number) => void;
  onFileChangeStatsChange: (stats: FileChangeVisibleStats) => void;
  groupChatPendingMessage: GroupChatPendingMessageView | null;
  groupChatViewActive: boolean;
  hasAnyInlineSection: boolean;
  scrollNav: ScrollNavState | null;
  inlineSections: InlineSection[];
  hasModeSwitch: boolean;
  agentOrgIntervention: AgentOrgInterventionView | null;
  streamRetry: StreamRetryInfo | null;
  groupChatPausedBottomContent: React.ReactNode;
  onSubmitOverride: (input: SubmitOverrideInput) => Promise<boolean>;
  customMentionOptions: ReadonlyArray<CustomMentionOption>;
  queueEditProps: QueueEditInputAreaProps;
  disableStopWhenEmpty?: boolean;
}

const ChatFloatingComposer: React.FC<ChatFloatingComposerProps> = memo(
  ({
    composerRef,
    inputBoxRef,
    chatPanelPosition,
    sessionId,
    inputAreaSessionId,
    currentPlanApproval,
    shouldShowCurrentPlanSurface,
    currentPlanSurfaceState,
    planCollapsed,
    onPlanCollapse,
    questionCollapsed,
    permissionCollapsed,
    modeSwitchCollapsed,
    onQuestionCollapse,
    onPermissionCollapse,
    onModeSwitchCollapse,
    onQuestionDataChange,
    onPermissionDataChange,
    onModeSwitchDataChange,
    queueExpanded,
    processExpanded,
    queuedMessages,
    onCancelQueuedMessage,
    onSendQueuedMessageNow,
    onReorderQueuedMessages,
    onToggleQueue,
    onToggleProcess,
    onToggleFiles,
    onProcessVisibleCountChange,
    onFileChangeStatsChange,
    groupChatPendingMessage,
    groupChatViewActive,
    hasAnyInlineSection,
    scrollNav,
    inlineSections,
    hasModeSwitch,
    agentOrgIntervention,
    streamRetry,
    groupChatPausedBottomContent,
    onSubmitOverride,
    customMentionOptions,
    queueEditProps,
    disableStopWhenEmpty = false,
  }) => {
    const { t } = useTranslation("sessions");
    const showTopRowPills =
      hasAnyInlineSection ||
      scrollNav?.showScrollToBottom ||
      scrollNav?.showFollowAgent;

    return (
      <div
        ref={composerRef}
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
              onCollapse={onPlanCollapse}
            />
          )}

          <AskQuestionCard
            key={`ask-${sessionId}`}
            collapsed={questionCollapsed}
            onCollapse={onQuestionCollapse}
            onHasDataChange={onQuestionDataChange}
          />
          <PermissionCard
            key={`permission-${sessionId}`}
            sessionId={sessionId}
            collapsed={permissionCollapsed}
            onCollapse={onPermissionCollapse}
            onHasDataChange={onPermissionDataChange}
          />
          <ModeSwitchInputCard
            key={`mode-switch-tracker-${sessionId}`}
            collapsed
            onHasDataChange={onModeSwitchDataChange}
          />

          {queueExpanded && (
            <QueuedMessages
              messages={queuedMessages}
              onCancel={onCancelQueuedMessage}
              onSendNow={onSendQueuedMessageNow}
              onReorder={onReorderQueuedMessages}
              onToggle={onToggleQueue}
            />
          )}
          {processExpanded && (
            <ActiveProcesses
              key={`process-expanded-${sessionId}`}
              sessionId={sessionId}
              onToggle={onToggleProcess}
              onVisibleCountChange={onProcessVisibleCountChange}
            />
          )}
          {!processExpanded && (
            <ActiveProcesses
              key={`process-hidden-${sessionId}`}
              sessionId={sessionId}
              onToggle={onToggleProcess}
              onVisibleCountChange={onProcessVisibleCountChange}
              hidden
            />
          )}
          <CompactFileChanges
            key={`files-tracker-${sessionId}`}
            onToggle={onToggleFiles}
            onVisibleStatsChange={onFileChangeStatsChange}
            hidden
          />

          <QueueEditModeCard />

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
            chatPanelPosition={chatPanelPosition}
            sessionId={inputAreaSessionId}
            onSubmitOverride={onSubmitOverride}
            customMentionOptions={customMentionOptions}
            topRowPills={
              showTopRowPills ? (
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
                    onCollapse={onModeSwitchCollapse}
                  />
                )}
                {agentOrgIntervention && (
                  <AgentOrgInterventionPinBar
                    intervention={agentOrgIntervention.intervention}
                    memberName={agentOrgIntervention.memberName}
                    error={agentOrgIntervention.error}
                    returning={agentOrgIntervention.returning}
                    onReturnToWork={agentOrgIntervention.onReturnToWork}
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
            composerShellRef={inputBoxRef}
            disableStopWhenEmpty={disableStopWhenEmpty}
            {...queueEditProps}
          />
          {isCursorIdeSession(sessionId) && (
            <CursorIdeFocusPoller sessionId={sessionId} />
          )}
        </div>
      </div>
    );
  }
);

ChatFloatingComposer.displayName = "ChatFloatingComposer";

export default ChatFloatingComposer;
