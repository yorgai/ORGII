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
import type { WorkItemStatus } from "@src/types/core/workItem";

import AgentWorkflow from "../AgentWorkflow";
import TodoChecklist from "../TodoChecklist";
import HistoryTab from "./HistoryTab";
import OutputTab from "./OutputTab";
import { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { ContentTab, WorkItemContentProps } from "./types";

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
