import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import ComposerInput from "@src/components/ComposerInput";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import Input from "@src/components/Input";
import TabPill from "@src/components/TabPill";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import ContextMenuPortal from "@src/engines/ChatPanel/InputArea/components/ContextMenuPortal";
import { useWorkItemImageInsert } from "@src/hooks/project";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
import { DetailPanelContainer } from "@src/modules/shared/layouts/blocks";
import InternalHeader from "@src/modules/shared/layouts/blocks/InternalHeader";
import type { MenuItemId } from "@src/scaffold/ContextMenu/config";
import type { WorkItemStatus } from "@src/types/core/workItem";

import AgentWorkflow from "../AgentWorkflow";
import TodoChecklist from "../TodoChecklist";
import HistoryTab from "./HistoryTab";
import OutputTab from "./OutputTab";
import { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { ContentTab, WorkItemContentProps } from "./types";

interface WorkItemDescriptionImageInsertRef {
  insertImage: (src: string, alt?: string) => void;
}

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
  const editorRef = useRef<ComposerInputRef>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const contextMenuKeyboardHandlerRef = useRef<
    ((event: React.KeyboardEvent) => boolean) | null
  >(null);
  const imageInsertRef = useRef<WorkItemDescriptionImageInsertRef | null>(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextSearchQuery, setContextSearchQuery] = useState("");
  const [contextAnchorPosition, setContextAnchorPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    imageInsertRef.current = {
      insertImage: (src: string, alt?: string) => {
        const label = alt?.trim() || "image";
        editorRef.current
          ?.getEditor()
          ?.chain()
          .focus()
          .insertContent(`\n![${label}](${src})\n`)
          .run();
      },
    };

    return () => {
      imageInsertRef.current = null;
    };
  }, []);

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: projectSlug ?? null,
    editorRef: imageInsertRef,
  });

  const handleContextTrigger = useCallback(
    (query: string, position?: { x: number; y: number }) => {
      setContextSearchQuery(query);
      if (position) setContextAnchorPosition(position);
      setShowContextMenu(true);
    },
    []
  );

  const handleContextMenuClose = useCallback(() => {
    setShowContextMenu(false);
    setContextSearchQuery("");
    setContextAnchorPosition(null);
  }, []);

  const handleContextSelect = useCallback(
    (type: MenuItemId, value?: string, displayName?: string) => {
      if (!editorRef.current || !value) return;
      const resolvedDisplayName =
        displayName || value.split("/").pop() || value;
      const isFolder = type === "folder";
      editorRef.current.insertFilePill(
        value,
        isFolder,
        isFolder ? "folder" : "file",
        resolvedDisplayName
      );
      handleContextMenuClose();
    },
    [handleContextMenuClose]
  );

  const handleContextKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (showContextMenu && contextMenuKeyboardHandlerRef.current) {
        const reactEvent = {
          key: event.key,
          code: event.code,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation(),
          nativeEvent: event,
        } as unknown as React.KeyboardEvent;
        return contextMenuKeyboardHandlerRef.current(reactEvent);
      }
      return false;
    },
    [showContextMenu]
  );

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
              ref={editorContainerRef}
              className={`${DETAIL_PANEL_TOKENS.sectionGap} min-h-[200px]`}
            >
              <ComposerInput
                key={workItem.session_id}
                ref={editorRef}
                placeholder={t("workItems.descriptionPlaceholder")}
                initialContent={resolvedDescription ?? rawDescription}
                onContentChange={handleDescriptionChange}
                onAtMention={handleContextTrigger}
                onAtMentionClose={handleContextMenuClose}
                onSlashCommand={handleContextTrigger}
                onSlashCommandClose={handleContextMenuClose}
                onKeyDownForDropdown={handleContextKeyDown}
                onKeyDownForSlashDropdown={handleContextKeyDown}
                onImagePaste={onUpdateWorkItem ? handleImageInsert : undefined}
                minHeight={200}
                maxHeight={600}
                editable={!!onUpdateWorkItem}
                requireCmdEnter
                slashTriggerMode="context"
                className="noDrag border-b border-border-2 py-2 text-[13px] [&_.composer-input-content]:px-0 [&_.composer-input-content]:pb-0 [&_.composer-input-content]:text-[13px] [&_.composer-input-content]:leading-[1.6]"
              />
              <ContextMenuPortal
                visible={showContextMenu}
                containerRef={editorContainerRef}
                anchorPosition={contextAnchorPosition}
                onClose={handleContextMenuClose}
                onSelect={handleContextSelect}
                searchQuery={contextSearchQuery}
                inlineSearchOnEmpty
                recentFiles={[]}
                repoPath={repoPath ?? undefined}
                keyboardHandlerRef={contextMenuKeyboardHandlerRef}
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
