import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import RichTextEditor from "@src/components/RichTextEditor";
import type { RichTextEditorRef } from "@src/components/RichTextEditor";
import TabPill from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { useWorkItemImageInsert } from "@src/hooks/project";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
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
  const editorRef = useRef<RichTextEditorRef>(null);

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
    editorRef,
  });

  return (
    <DetailPanelContainer className="relative">
      <div className="shrink-0 px-3 pt-4">
        <Input
          type="text"
          value={workItem.name || ""}
          onChange={handleTitleChange}
          placeholder={t("workItems.titlePlaceholder")}
          readOnly={!onUpdateWorkItem}
          borderless
          bgless
          autoHeight
          inputClassName={`text-[22px] font-semibold text-text-1 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
        />
        {headerProperties && <div className="mt-3">{headerProperties}</div>}
        <div className="mt-4 border-b border-border-2" />
      </div>

      <InternalHeader
        compactPadding
        className="pt-4"
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
            <div
              className={`${DETAIL_PANEL_TOKENS.sectionGap} min-h-[200px] cursor-text`}
              onClick={() => editorRef.current?.focus()}
            >
              <RichTextEditor
                ref={editorRef}
                placeholder={t("workItems.descriptionPlaceholder")}
                initialContent={resolvedDescription ?? rawDescription}
                onContentChange={handleDescriptionChange}
                onImageInsert={onUpdateWorkItem ? handleImageInsert : undefined}
                minHeight={200}
                editable={!!onUpdateWorkItem}
                className="text-[13px]"
                toolbarClassName="work-item-toolbar"
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
