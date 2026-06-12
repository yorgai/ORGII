import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import {
  MAX_WIDTH as CHAT_MAX_WIDTH,
  MIN_WIDTH as CHAT_MIN_WIDTH,
} from "@src/engines/ChatPanel/config";
import {
  clearSessionAtom,
  eventCountAtom,
  eventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import { ShareSessionDialog } from "@src/features/SessionSharing/ShareSessionDialog";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useShouldOffsetChatPanelHeader } from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs";
import { allAgentDefsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { getChatPanelBackgroundStyle } from "@src/modules/shared/layouts/viewContainerTokens";
import { VerticalResizeHandle } from "@src/scaffold/Resize";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials";
import { benchmarkAgentBatchStatusAtom } from "@src/store/benchmark";
import { projectListRefreshAtom } from "@src/store/project/projectAtom";
import { currentRepoAtom } from "@src/store/repo";
import {
  activeSessionIdAtom,
  sessionCreatorStateAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";
import {
  CHAT_PANEL_SURFACE_KIND,
  chatPanelContentModeAtom,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelExploreAgentSearchEnabledAtom,
  chatPanelExploreOpenAtom,
  chatPanelMaximizedAtom,
  chatPanelNavigateAtom,
  chatPanelSelectedProjectAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelSelectedWorkspaceAtom,
  chatPanelWorkspaceDashboardOpenAtom,
  chatTurnPaginationEnabledAtom,
  chatWidthAtom,
  toggleChatPanelMaximizedAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  collapseAllCommandAtom,
  setAllBlocksCollapsedAtom,
} from "@src/store/ui/collapseStateAtom";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import { createBenchmarkTab } from "@src/store/workstation/tabs";

import { useReloadSession } from "./ChatHistory/hooks/useReloadSession";
import { ChatPanelContent } from "./ChatPanelContent";
import { ChatPanelEmptyContent } from "./ChatPanelEmptyContent";
import { ChatPanelHeader } from "./ChatPanelHeader";
import { ChatPanelSurfaceHeaderPublisher } from "./header";
import { useAiWorkItemCreator } from "./hooks/useAiWorkItemCreator";
import { useChatPanelContentState } from "./hooks/useChatPanelContentState";
import { useChatPanelCreateTarget } from "./hooks/useChatPanelCreateTarget";
import { useChatPanelResize } from "./hooks/useChatPanelResize";
import { useChatPanelSessionModals } from "./hooks/useChatPanelSessionModals";
import { usePanelTitle } from "./hooks/usePanelTitle";
import { useProjectWorkItemHandlers } from "./hooks/useProjectWorkItemHandlers";
import { useBenchmarkSessionCreatorSlots } from "./panels/useBenchmarkSessionCreatorSlots";
import type { ChatPanelProps, ChatPanelRegionNotice } from "./types";

const ChatPanel: React.FC<ChatPanelProps> = memo(
  ({
    useExternalWidth = false,
    sessionSidebarWidth = 0,
    embedded = false,
    active = true,
    position = "right",
    sessionCreatorSlot: SessionCreatorSlot,
  }) => {
    const { t } = useTranslation([
      "sessions",
      "common",
      "projects",
      "navigation",
    ]);
    const isLeftPosition = position === "left";
    const shouldOffsetHeaderForCollapsedSidebar =
      useShouldOffsetChatPanelHeader({ position, useExternalWidth });
    const isCompactLayout = useIsCompactLayout();
    const viewMode = useRouteViewMode();

    const { currentSessionId, panelTitle, currentSession } = usePanelTitle();
    const activeSession = currentSession ?? undefined;
    const handleReloadSession = useReloadSession(currentSessionId ?? null);
    const { openTab: openWorkStationTab } = useWorkStationTabs();

    const [contentMode, setContentMode] = useAtom(chatPanelContentModeAtom);
    const [createTarget, setCreateTarget] = useAtom(chatPanelCreateTargetAtom);
    const [workItemCreateDraft, setWorkItemCreateDraft] =
      useState<WorkItemDraft | null>(null);
    const [showWorkItemAgentCreator, setShowWorkItemAgentCreator] = useState(
      Boolean(SessionCreatorSlot)
    );
    const [showProjectAgentCreator, setShowProjectAgentCreator] = useState(
      Boolean(SessionCreatorSlot)
    );
    const [shareDialogSessionId, setShareDialogSessionId] = useState<
      string | null
    >(null);

    const selectedWorkItem = useAtomValue(chatPanelSelectedWorkItemAtom);
    const selectedProject = useAtomValue(chatPanelSelectedProjectAtom);
    const selectedWorkspace = useAtomValue(chatPanelSelectedWorkspaceAtom);
    const workspaceDashboardOpen = useAtomValue(
      chatPanelWorkspaceDashboardOpenAtom
    );
    const exploreOpen = useAtomValue(chatPanelExploreOpenAtom);
    const createProjectContext = useAtomValue(
      chatPanelCreateProjectContextAtom
    );
    const currentRepo = useAtomValue(currentRepoAtom);
    const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? null;
    const currentRepoName = currentRepo?.name ?? undefined;

    const isChatFocus = useAtomValue(chatPanelMaximizedAtom);
    const toggleChatFocus = useSetAtom(toggleChatPanelMaximizedAtom);
    const showChatFocusToggle = viewMode === "workStation";
    const rawChatWidth = useAtomValue(chatWidthAtom);
    const backgroundConfig = useAtomValue(resolvedBackgroundConfigAtom);
    const chatPanelOpacityStyle = React.useMemo(
      () => getChatPanelBackgroundStyle(backgroundConfig.pageOpacity),
      [backgroundConfig.pageOpacity]
    );
    const chatWidth =
      rawChatWidth > 0 ? Math.min(rawChatWidth, CHAT_MAX_WIDTH) : rawChatWidth;
    const { isDragging, panelRef, handleMouseDown } = useChatPanelResize({
      useExternalWidth,
      embedded,
      position,
    });

    const handleChatFocusToggle = useCallback(() => {
      toggleChatFocus();
    }, [toggleChatFocus]);

    const openSearchRef = React.useRef<(() => void) | null>(null);
    const {
      isOpen: isHeaderActionsOpen,
      isPositioned: isHeaderActionsPositioned,
      toggle: toggleHeaderActionsMenu,
      close: closeHeaderActionsMenu,
      triggerRef: headerActionsTriggerRef,
      panelRef: headerActionsDropdownRef,
      panelPosition: headerActionsPosition,
    } = useDropdownEngine<HTMLButtonElement>({
      gap: 4,
      align: "right",
      placement: "bottom",
    });

    const [regionNotice, setRegionNotice] =
      React.useState<ChatPanelRegionNotice | null>(null);
    const handleRegionNoticeChange = useCallback(
      (notice: ChatPanelRegionNotice | null) => {
        setRegionNotice(notice);
      },
      []
    );

    const [paginationEnabled, setPaginationEnabled] = useAtom(
      chatTurnPaginationEnabledAtom
    );
    const [exploreAgentSearchEnabled, setExploreAgentSearchEnabled] = useAtom(
      chatPanelExploreAgentSearchEnabledAtom
    );
    const collapseAllCommand = useAtomValue(collapseAllCommandAtom);
    const setAllBlocksCollapsed = useSetAtom(setAllBlocksCollapsedAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);
    const setWorkstationActiveSessionId = useSetAtom(
      workstationActiveSessionIdAtom
    );
    const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);
    const setSelectedProject = useSetAtom(chatPanelSelectedProjectAtom);
    const dispatchClearSession = useSetAtom(clearSessionAtom);
    const creatorState = useAtomValue(sessionCreatorStateAtom);
    const setCreatorState = useSetAtom(sessionCreatorStateAtom);
    const bumpProjectListRefresh = useSetAtom(projectListRefreshAtom);
    const allAgentDefs = useAtomValue(allAgentDefsAtom);
    const benchmarkBatchStatus = useAtomValue(benchmarkAgentBatchStatusAtom);
    const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);

    const allBlocksCollapsed =
      collapseAllCommand.epoch > 0 ? collapseAllCommand.collapsed : false;
    const collapseToggleLabel = allBlocksCollapsed
      ? t("common:actions.expandAll")
      : t("common:actions.collapseAll");

    const handleToggleAllBlocksCollapsed = useCallback(() => {
      setAllBlocksCollapsed(!allBlocksCollapsed);
      closeHeaderActionsMenu();
    }, [allBlocksCollapsed, closeHeaderActionsMenu, setAllBlocksCollapsed]);

    const handleRegisterSearchOpen = useCallback(
      (handler: (() => void) | null) => {
        openSearchRef.current = handler;
      },
      []
    );

    const handleOpenSearch = useCallback(() => {
      openSearchRef.current?.();
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu]);

    const handleReloadFromMenu = useCallback(() => {
      handleReloadSession();
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu, handleReloadSession]);

    const handleOpenShareSession = useCallback(() => {
      if (!currentSessionId) return;
      setShareDialogSessionId(currentSessionId);
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu, currentSessionId]);

    const handlePaginationToggle = useCallback(
      (checked: boolean) => {
        setPaginationEnabled(checked);
      },
      [setPaginationEnabled]
    );

    const handleExploreAgentSearchToggle = useCallback(
      (checked: boolean) => {
        setExploreAgentSearchEnabled(checked);
      },
      [setExploreAgentSearchEnabled]
    );

    const handleNewSession = useCallback(() => {
      navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.SESSION });
      dispatchClearSession();
      setWorkstationActiveSessionId(null);
      setActiveSessionId(null);
    }, [
      dispatchClearSession,
      navigateChatPanel,
      setActiveSessionId,
      setWorkstationActiveSessionId,
    ]);

    const eventCount = useAtomValue(eventCountAtom);
    const events = useAtomValue(eventsAtom);
    const [copyEventJsonLabel, setCopyEventJsonLabel] = React.useState<
      "idle" | "copied" | "failed"
    >("idle");
    const handleCopyEventJson = useCallback(() => {
      const json = JSON.stringify(events, null, 2);
      navigator.clipboard
        .writeText(json)
        .then(() => {
          setCopyEventJsonLabel("copied");
          setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
        })
        .catch(() => {
          setCopyEventJsonLabel("failed");
          setTimeout(() => setCopyEventJsonLabel("idle"), 2000);
        });
      closeHeaderActionsMenu();
    }, [closeHeaderActionsMenu, events]);

    const {
      handleOpenExportSessionJson,
      handleOpenLinkWorkItem,
      sessionModals,
    } = useChatPanelSessionModals({
      activeSession,
      closeHeaderActionsMenu,
      currentSessionId: currentSessionId ?? null,
      t,
    });

    const { createTargetOptions, handleCreateTargetChange } =
      useChatPanelCreateTarget({
        allAgentDefs,
        handleNewSession,
        sessionCreatorAvailable: Boolean(SessionCreatorSlot),
        setCreateTarget,
        setCreatorState,
        setShowProjectAgentCreator,
        setShowWorkItemAgentCreator,
        setWorkItemCreateDraft,
        t,
      });

    const shareSessionAvailable =
      activeSession?.category === DISPATCH_CATEGORY.CLI_AGENT ||
      activeSession?.category === DISPATCH_CATEGORY.RUST_AGENT;
    const sessionSidebarVisible = sessionSidebarWidth > 0;
    const benchmarkMasterSessionId = benchmarkBatchStatus?.masterSessionId;
    const benchmarkSessionGroupTitle =
      benchmarkBatchStatus?.masterSessionName ??
      t("creator.benchmark.sessionGroupTitle");
    const contentState = useChatPanelContentState({
      active,
      activeSession,
      benchmarkMasterSessionId,
      benchmarkSessionGroupTitle,
      contentMode,
      createTarget,
      currentSessionId: currentSessionId ?? null,
      exploreOpen,
      isChatFocus,
      panelTitle,
      selectedProject,
      selectedWorkItem,
      selectedWorkspace,
      workspaceDashboardOpen,
      setActiveSessionId,
      setContentMode,
      setWorkstationActiveSessionId,
      showChatFocusToggle,
      sidebarCollapsed,
      sessionCreatorAvailable: Boolean(SessionCreatorSlot),
      sessionSidebarVisible,
      viewMode,
    });

    const handleOpenBenchmarkTab = useCallback(() => {
      openWorkStationTab(createBenchmarkTab());
      if (isChatFocus) {
        toggleChatFocus();
      }
    }, [isChatFocus, openWorkStationTab, toggleChatFocus]);
    const { bodySlot: benchmarkPanel, footerSlot: benchmarkFooter } =
      useBenchmarkSessionCreatorSlots({
        enabled: contentState.isBenchmarkTarget,
        onOpenBenchmarkTab: handleOpenBenchmarkTab,
      });

    const {
      handleCancelWorkItemCreate,
      handleChatPanelProjectCreated,
      handleChatPanelWorkItemCreated,
      handleProjectAgentCreatorToggle,
      handleProjectTitleChange,
      handleWorkItemAgentCreatorToggle,
      handleWorkItemTitleChange,
    } = useProjectWorkItemHandlers({
      bumpProjectListRefresh,
      dispatchClearSession,
      handleNewSession,
      selectedProject,
      selectedWorkItem,
      sessionCreatorAvailable: Boolean(SessionCreatorSlot),
      setActiveSessionId,
      setContentMode,
      setCreateTarget,
      setSelectedProject,
      setSelectedWorkItem,
      setShowProjectAgentCreator,
      setShowWorkItemAgentCreator,
      setWorkItemCreateDraft,
      setWorkstationActiveSessionId,
    });

    const {
      defaultAiWorkItemAssignee,
      handleAiWorkItemSessionStart,
      resolveAiWorkItemContext,
    } = useAiWorkItemCreator({
      allAgentDefs,
      creatorState,
      dispatchClearSession,
      setActiveSessionId,
      setContentMode,
      setCreateTarget,
      setSelectedProject,
      setSelectedWorkItem,
      setShowWorkItemAgentCreator,
      setWorkItemCreateDraft,
      setWorkstationActiveSessionId,
      sessionCreatorAvailable: Boolean(SessionCreatorSlot),
      workItemCreateDraft,
    });

    const showResizeHandle = !useExternalWidth;
    const borderClasses =
      embedded && !showResizeHandle
        ? isLeftPosition
          ? "border-r border-border-1"
          : "border-l border-border-1"
        : "";
    const dragHandle = showResizeHandle && (
      <VerticalResizeHandle
        onMouseDown={handleMouseDown}
        variant={embedded ? "border" : "transparent"}
        noAccent={!embedded}
      />
    );

    const chatFocusLabel = isChatFocus
      ? t("chat.showWorkstation")
      : t("chat.maximizeChatPanel");
    const useFullScreenCreator =
      isChatFocus || useExternalWidth || chatWidth >= CHAT_MAX_WIDTH;
    const creatorVariant = useFullScreenCreator ? "fullScreen" : "default";
    const creatorClassName = "min-h-0 flex-1";
    const emptyChatContent = (
      <ChatPanelEmptyContent
        benchmarkFooter={benchmarkFooter}
        benchmarkPanel={benchmarkPanel}
        createProjectContext={createProjectContext}
        createTarget={createTarget}
        creatorClassName={creatorClassName}
        creatorVariant={creatorVariant}
        currentRepoName={currentRepoName}
        currentRepoPath={currentRepoPath}
        defaultAiWorkItemAssignee={defaultAiWorkItemAssignee}
        handleAiWorkItemSessionStart={handleAiWorkItemSessionStart}
        handleCancelWorkItemCreate={handleCancelWorkItemCreate}
        handleChatPanelProjectCreated={handleChatPanelProjectCreated}
        handleChatPanelWorkItemCreated={handleChatPanelWorkItemCreated}
        handleRegionNoticeChange={handleRegionNoticeChange}
        handleWorkItemAgentCreatorToggle={handleWorkItemAgentCreatorToggle}
        resolveAiWorkItemContext={resolveAiWorkItemContext}
        SessionCreatorSlot={SessionCreatorSlot}
        setWorkItemCreateDraft={setWorkItemCreateDraft}
        showProjectAgentCreator={showProjectAgentCreator}
        showWorkItemAgentCreator={showWorkItemAgentCreator}
        t={t}
      />
    );

    const publishSurfaceHeader =
      contentState.showBenchmarkSessionGroupContent ||
      contentState.showExploreContent ||
      contentState.showWorkspaceDashboardContent ||
      contentState.showWorkspaceOverviewContent;

    const headerSection = (
      <>
        <ChatPanelSurfaceHeaderPublisher
          enabled={publishSurfaceHeader}
          title={contentState.headerTitle}
          titleContent={contentState.headerTitleContent}
          showAgentSwitch={contentState.showExploreContent}
          agentSwitchLabel={t("navigation:labels.agent", {
            defaultValue: "Agent",
          })}
          agentSwitchChecked={exploreAgentSearchEnabled}
          onAgentSwitchChange={handleExploreAgentSearchToggle}
        />
        <ChatPanelHeader
          activeSessionExists={Boolean(activeSession)}
          allBlocksCollapsed={allBlocksCollapsed}
          collapseToggleLabel={collapseToggleLabel}
          copyEventJsonLabel={copyEventJsonLabel}
          createTarget={createTarget}
          createTargetOptions={createTargetOptions}
          currentSessionId={currentSessionId ?? null}
          eventsLength={eventCount}
          exploreAgentSearchEnabled={exploreAgentSearchEnabled}
          handleChatFocusToggle={handleChatFocusToggle}
          handleCopyEventJson={handleCopyEventJson}
          handleCreateTargetChange={handleCreateTargetChange}
          handleExploreAgentSearchToggle={handleExploreAgentSearchToggle}
          handleOpenExportSessionJson={handleOpenExportSessionJson}
          handleOpenLinkWorkItem={handleOpenLinkWorkItem}
          handleOpenSearch={handleOpenSearch}
          handleOpenShareSession={handleOpenShareSession}
          handleNewSession={handleNewSession}
          handlePaginationToggle={handlePaginationToggle}
          handleProjectAgentCreatorToggle={handleProjectAgentCreatorToggle}
          handleProjectTitleChange={handleProjectTitleChange}
          handleReloadFromMenu={handleReloadFromMenu}
          handleToggleAllBlocksCollapsed={handleToggleAllBlocksCollapsed}
          handleWorkItemAgentCreatorToggle={handleWorkItemAgentCreatorToggle}
          handleWorkItemTitleChange={handleWorkItemTitleChange}
          headerActionsDropdownRef={headerActionsDropdownRef}
          headerActionsPosition={headerActionsPosition}
          headerActionsTriggerRef={headerActionsTriggerRef}
          headerTitle={contentState.headerTitle}
          headerTitleContent={contentState.headerTitleContent}
          isChatFocus={isChatFocus}
          isCompactLayout={isCompactLayout}
          isHeaderActionsOpen={isHeaderActionsOpen}
          isHeaderActionsPositioned={isHeaderActionsPositioned}
          isProjectTarget={contentState.isProjectTarget}
          paginationEnabled={paginationEnabled}
          shareSessionAvailable={shareSessionAvailable}
          selectedProjectVisible={Boolean(selectedProject)}
          selectedWorkItemVisible={Boolean(selectedWorkItem)}
          shouldOffsetHeaderForCollapsedSidebar={
            shouldOffsetHeaderForCollapsedSidebar
          }
          showBenchmarkSessionGroupContent={
            contentState.showBenchmarkSessionGroupContent
          }
          showChatFocusToggle={showChatFocusToggle}
          showCreatorPresenceInHeader={contentState.showCreatorPresenceInHeader}
          showHeader={contentState.showHeader}
          showExploreAgentSwitchInHeader={contentState.showExploreContent}
          showNewSessionButton={contentState.showNewSessionButton}
          showNonSessionContent={contentState.showNonSessionContent}
          showProjectAgentCreator={showProjectAgentCreator}
          showProjectAgentSwitchInHeader={
            contentState.showProjectAgentSwitchInHeader
          }
          showSessionContent={contentState.showSessionContent}
          showWorkItemAgentCreator={showWorkItemAgentCreator}
          showWorkItemAgentSwitchInHeader={
            contentState.showWorkItemAgentSwitchInHeader
          }
          t={t}
          toggleHeaderActionsMenu={toggleHeaderActionsMenu}
          visibleRegionNotice={regionNotice}
        />
      </>
    );

    const chatColumn = (
      <ChatPanelContent
        chatFocusLabel={chatFocusLabel}
        currentSessionId={currentSessionId ?? null}
        emptyChatContent={emptyChatContent}
        handleChatFocusToggle={handleChatFocusToggle}
        handleRegisterSearchOpen={handleRegisterSearchOpen}
        paginationEnabled={paginationEnabled}
        position={position}
        selectedProject={selectedProject}
        selectedWorkItem={selectedWorkItem}
        selectedWorkspace={selectedWorkspace}
        showBenchmarkSessionGroupContent={
          contentState.showBenchmarkSessionGroupContent
        }
        showEmptyChatFocusRestoreButton={
          contentState.showEmptyChatFocusRestoreButton
        }
        showExploreContent={contentState.showExploreContent}
        showPanelContent={contentState.showPanelContent}
        showProjectContent={contentState.showProjectContent}
        showSessionContent={contentState.showSessionContent}
        showWorkItemContent={contentState.showWorkItemContent}
        showWorkspaceDashboardContent={
          contentState.showWorkspaceDashboardContent
        }
        showWorkspaceOverviewContent={contentState.showWorkspaceOverviewContent}
      />
    );

    const mainPanel = (
      <div
        ref={panelRef}
        data-chat-panel
        data-testid="chat-panel"
        data-guide-target={GUIDE_TARGETS.CHAT_PANEL}
        className={`relative flex h-full max-w-full flex-col overflow-hidden bg-chat-pane text-sm ${
          useExternalWidth ? "min-w-0 flex-1" : "flex-shrink-0"
        } ${borderClasses}`}
        style={{
          ...(useExternalWidth ? { width: "100%" } : { width: chatWidth }),
          minWidth:
            !useExternalWidth && chatWidth > 0 ? CHAT_MIN_WIDTH : undefined,
          borderRadius: embedded ? 0 : "var(--radius-page)",
          contain: isDragging ? "strict" : undefined,
          willChange: isDragging ? "width" : undefined,
          ...chatPanelOpacityStyle,
        }}
      >
        {headerSection}
        {chatColumn}
      </div>
    );

    return (
      <>
        <div
          className={`relative flex h-full ${isLeftPosition ? "flex-row-reverse" : "flex-row"} ${useExternalWidth ? "w-full min-w-0" : "flex-shrink-0"}`}
        >
          {dragHandle}
          {mainPanel}
        </div>
        {sessionModals}
        {shareDialogSessionId && (
          <ShareSessionDialog
            sessionId={shareDialogSessionId}
            onClose={() => setShareDialogSessionId(null)}
          />
        )}
      </>
    );
  }
);

ChatPanel.displayName = "ChatPanel";

export default ChatPanel;
