import { ExternalLink } from "lucide-react";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { useWorkItemImageInsert } from "@src/hooks/project";
import {
  ProjectContentEditor,
  type ProjectContentEditorRef,
} from "@src/modules/ProjectManager/shared";
import { DetailPanelContainer } from "@src/modules/shared/layouts/blocks";
import InternalHeader from "@src/modules/shared/layouts/blocks/InternalHeader";
import type { LinkedSession, WorkItemStatus } from "@src/types/core/workItem";

import AgentWorkflow from "../AgentWorkflow";
import TodoChecklist from "../TodoChecklist";
import HistoryTab from "./HistoryTab";
import OutputTab from "./OutputTab";
import { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { ContentTab, WorkItemContentProps } from "./types";

interface LinkedSessionsListProps {
  sessions: LinkedSession[];
  onOpenSession?: (sessionId: string) => void;
  onStartAgent?: (instructions?: string) => void;
  isStartingAgent?: boolean;
}

const LinkedSessionsList: React.FC<LinkedSessionsListProps> = ({
  sessions,
  onOpenSession,
  onStartAgent,
  isStartingAgent,
}) => {
  if (sessions.length === 0) return null;

  return (
    <section
      className="mt-6 border-t border-solid border-border-1 pt-4"
      data-testid="work-item-linked-sessions"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="m-0 text-[13px] font-semibold text-text-1">
          Linked Sessions
        </h3>
        {onStartAgent && (
          <button
            type="button"
            className="rounded-md border border-solid border-border-2 bg-bg-1 px-2 py-1 text-[11px] font-medium text-text-2 transition-colors hover:border-border-3 hover:bg-surface-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onStartAgent()}
            disabled={isStartingAgent}
          >
            {isStartingAgent ? "Starting..." : "New Session"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <button
            key={`${session.session_id}-${session.session_type}`}
            type="button"
            data-testid={`work-item-linked-session-${session.session_id}`}
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-solid border-border-1 bg-bg-1 px-3 py-2 text-left transition-colors hover:border-border-2 hover:bg-surface-hover"
            onClick={() => onOpenSession?.(session.session_id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-text-1">
                {session.agent_role || session.session_id}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-text-3">
                {session.status} · {session.session_type}
              </span>
            </span>
            <ExternalLink
              size={13}
              className="shrink-0 text-text-3 group-hover:text-text-1"
            />
          </button>
        ))}
      </div>
    </section>
  );
};

const WorkItemContent: React.FC<WorkItemContentProps> = ({
  workItem,
  onUpdateWorkItem,
  onUpdateWorkItemImmediate,
  currentUser: currentUserProp,
  teamMembers = [],
  headerProperties,
  hideTitleHeader = false,
  showHeaderPropertiesWhenTitleHidden = false,
  repoPath,
  projectSlug,
  shortId,
  onStartAgent,
  isStartingAgent,
  onCancelAgent,
  onRetry,
  onAcceptAsIs,
  onCreateFollowUp,
  onOpenSession,
  onOpenFileDiff,
  onOpenFileAtLine,
  onReviewAllFiles,
  onRefreshWorkflow,
  activeAgentSessionId,
  activeAgentRole,
  onCreatePr,
}) => {
  const { t } = useTranslation("projects");
  const editorRef = useRef<ProjectContentEditorRef>(null);

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: projectSlug ?? null,
    editorRef,
  });

  const {
    currentUser,
    activeTab,
    setActiveTab,
    commentText,
    setCommentText,
    isSubscribed,
    setIsSubscribed,
    isSubmittingComment,
    tabItems,
    resolvedDescription,
    rawDescription,
    timelineEntries,
    formatRelativeTime,
    handleTitleChange,
    handleDescriptionChange,
    handleTodosChange,
    handleCommentSubmit,
  } = useWorkItemContentState({
    workItem,
    onUpdateWorkItem,
    onUpdateWorkItemImmediate,
    currentUserProp,
    teamMembers,
    projectSlug,
    shortId,
    onStartAgent,
    onOpenSession,
    activeAgentSessionId,
  });

  return (
    <DetailPanelContainer className="relative">
      {!hideTitleHeader && (
        <div className="shrink-0 px-3 pt-4">
          <ProjectContentEditor
            ref={editorRef}
            title={workItem.name || ""}
            onTitleChange={handleTitleChange}
            initialDescription={resolvedDescription ?? rawDescription}
            onDescriptionChange={handleDescriptionChange}
            onImageInsert={onUpdateWorkItem ? handleImageInsert : undefined}
            titlePlaceholder={t("workItems.titlePlaceholder")}
            descriptionPlaceholder={t("workItems.descriptionPlaceholder")}
            editable={!!onUpdateWorkItem}
            metaContent={headerProperties}
            descriptionVisible={false}
            repoPath={repoPath}
            className="flex flex-col"
          />
        </div>
      )}

      {hideTitleHeader &&
        showHeaderPropertiesWhenTitleHidden &&
        headerProperties && (
          <div className="shrink-0 px-3 pt-3">{headerProperties}</div>
        )}

      <InternalHeader
        compactPadding
        data-testid="work-item-content-tabs"
        className={hideTitleHeader ? "pt-3" : "pt-4"}
        tabs={
          <TabPill
            tabs={tabItems}
            activeTab={activeTab}
            onChange={(key) => setActiveTab(key as ContentTab)}
            variant="simple"
            fillWidth={false}
            size="large"
          />
        }
      />

      <div className={DETAIL_PANEL_TOKENS.scrollContentNoTop}>
        {activeTab === "details" && (
          <>
            <div className={`${DETAIL_PANEL_TOKENS.sectionGap} min-h-[200px]`}>
              <ProjectContentEditor
                key={workItem.session_id}
                ref={editorRef}
                title={workItem.name || ""}
                onTitleChange={handleTitleChange}
                initialDescription={resolvedDescription ?? rawDescription}
                onDescriptionChange={handleDescriptionChange}
                onImageInsert={onUpdateWorkItem ? handleImageInsert : undefined}
                titleVisible={false}
                separatorVisible={false}
                descriptionPlaceholder={t("workItems.descriptionPlaceholder")}
                editable={!!onUpdateWorkItem}
                descriptionMaxHeight={600}
                descriptionClassName="no-bottom-border"
                repoPath={repoPath}
                className="w-full"
              />
            </div>
            <TodoChecklist
              todos={workItem.todos ?? []}
              onChange={handleTodosChange}
              disabled={!onUpdateWorkItem}
            />
            <LinkedSessionsList
              sessions={workItem.linkedSessions ?? []}
              onOpenSession={onOpenSession}
              onStartAgent={onStartAgent}
              isStartingAgent={isStartingAgent}
            />
          </>
        )}

        {activeTab === "execution" &&
          (workItem.orchestratorConfig ||
            workItem.orchestratorState ||
            workItem.executionLock ||
            (workItem.linkedSessions?.length ?? 0) > 0) && (
            <div className={DETAIL_PANEL_TOKENS.sectionGap}>
              <AgentWorkflow
                orchestratorState={workItem.orchestratorState}
                orchestratorConfig={workItem.orchestratorConfig}
                proofOfWork={workItem.proofOfWork}
                workItemStatus={
                  workItem.workItemStatus ?? (workItem.status as WorkItemStatus)
                }
                executionLock={workItem.executionLock}
                linkedSessions={workItem.linkedSessions}
                onStartAgent={onStartAgent}
                isStartingAgent={isStartingAgent}
                onCancel={onCancelAgent}
                onRetry={onRetry}
                onAcceptAsIs={onAcceptAsIs}
                onCreateFollowUp={onCreateFollowUp}
                onOpenSession={onOpenSession}
                onOpenFileAtLine={onOpenFileAtLine}
                onRefresh={onRefreshWorkflow}
                activeAgentSessionId={activeAgentSessionId}
                activeAgentRole={activeAgentRole}
              />
            </div>
          )}

        {activeTab === "output" && (
          <OutputTab
            workItem={workItem}
            repoPath={repoPath}
            onOpenFileDiff={onOpenFileDiff}
            onOpenFileAtLine={onOpenFileAtLine}
            onReviewAllFiles={onReviewAllFiles}
            onOpenSession={onOpenSession}
            onRetry={onRetry}
            onAcceptAsIs={onAcceptAsIs}
            onCreateFollowUp={onCreateFollowUp}
            onCancel={onCancelAgent}
            onCreatePr={onCreatePr}
          />
        )}

        {activeTab === "history" && (
          <HistoryTab
            timelineEntries={timelineEntries}
            currentUser={currentUser}
            isSubscribed={isSubscribed}
            onToggleSubscribe={() => setIsSubscribed(!isSubscribed)}
            commentText={commentText}
            onCommentTextChange={setCommentText}
            onCommentSubmit={handleCommentSubmit}
            isSubmittingComment={isSubmittingComment}
            formatRelativeTime={formatRelativeTime}
          />
        )}
      </div>
    </DetailPanelContainer>
  );
};

export default WorkItemContent;
