import { emit } from "@tauri-apps/api/event";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { GalleryThumbnails } from "lucide-react";
import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  enrichedWorkItemToUI,
  projectApi,
  workItemDataToUI,
} from "@src/api/http/project";
import Button from "@src/components/Button";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import {
  MAX_WIDTH as CHAT_MAX_WIDTH,
  MIN_WIDTH as CHAT_MIN_WIDTH,
} from "@src/engines/ChatPanel/config";
import {
  clearSessionAtom,
  eventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useShouldOffsetChatPanelHeader } from "@src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset";
import { useWorkStationTabs } from "@src/hooks/workStation/tabs";
import { allAgentDefsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import type { CreatedWorkItemResult } from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { VerticalResizeHandle } from "@src/scaffold/Resize";
import { projectListRefreshAtom } from "@src/store/project/projectAtom";
import { currentRepoAtom } from "@src/store/repo";
import {
  activeSessionIdAtom,
  sessionCreatorStateAtom,
  sessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { addSectionAtom } from "@src/store/stickyNotes/stickyNotesAtom";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  chatPanelContentModeAtom,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelMaximizedAtom,
  chatPanelSelectedProjectAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelStickyNotesOpenAtom,
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
import { ChatPanelEmptyContent } from "./ChatPanelEmptyContent";
import { ChatPanelHeader } from "./ChatPanelHeader";
import ChatView from "./ChatView";
import ProjectPanelView from "./ProjectPanelView";
import StickyNotesPanelView from "./StickyNotesPanelView";
import WorkItemPanelView from "./WorkItemPanelView";
import { useAiWorkItemCreator } from "./hooks/useAiWorkItemCreator";
import { useChatPanelCreateTarget } from "./hooks/useChatPanelCreateTarget";
import { useChatPanelResize } from "./hooks/useChatPanelResize";
import { useChatPanelSessionModals } from "./hooks/useChatPanelSessionModals";
import { usePanelTitle } from "./hooks/usePanelTitle";
import type { ChatPanelProps, ChatPanelRegionNotice } from "./types";
import { useBenchmarkSessionCreatorSlots } from "./useBenchmarkSessionCreatorSlots";

// ============================================
// ChatPanel
// ============================================

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
      useShouldOffsetChatPanelHeader({
        position,
        useExternalWidth,
      });
    const isCompactLayout = useIsCompactLayout();

    // ── Session state ───────────────────────────────────────────────
    const { currentSessionId, panelTitle } = usePanelTitle();
    const sessions = useAtomValue(sessionsAtom);
    const activeSession = useMemo(
      () =>
        currentSessionId
          ? sessions.find((session) => session.session_id === currentSessionId)
          : undefined,
      [currentSessionId, sessions]
    );
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
    const selectedWorkItem = useAtomValue(chatPanelSelectedWorkItemAtom);
    const selectedProject = useAtomValue(chatPanelSelectedProjectAtom);
    const stickyNotesOpen = useAtomValue(chatPanelStickyNotesOpenAtom);
    const createProjectContext = useAtomValue(
      chatPanelCreateProjectContextAtom
    );
    const currentRepo = useAtomValue(currentRepoAtom);
    const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? null;
    const currentRepoName = currentRepo?.name ?? undefined;
    // ── Header mode ─────────────────────────────────────────────────
    const viewMode = useRouteViewMode();
    const isChatFocus = useAtomValue(chatPanelMaximizedAtom);
    const toggleChatFocus = useSetAtom(toggleChatPanelMaximizedAtom);
    /**
     * Maximize/dock toggle: in WorkStation the chat panel can grow to fill the
     * entire content area. The button shows in WorkStation regardless of
     * session or station-mode state.
     */
    const showChatFocusToggle = viewMode === "workStation";

    // ── Width ────────────────────────────────────────────────────────
    const rawChatWidth = useAtomValue(chatWidthAtom);
    const chatWidth =
      rawChatWidth > 0 ? Math.min(rawChatWidth, CHAT_MAX_WIDTH) : rawChatWidth;

    // ── Resize ──────────────────────────────────────────────────────
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
    const visibleRegionNotice = regionNotice;
    const handleRegionNoticeChange = useCallback(
      (notice: ChatPanelRegionNotice | null) => {
        setRegionNotice(notice);
      },
      []
    );

    const [paginationEnabled, setPaginationEnabled] = useAtom(
      chatTurnPaginationEnabledAtom
    );
    const collapseAllCommand = useAtomValue(collapseAllCommandAtom);
    const setAllBlocksCollapsed = useSetAtom(setAllBlocksCollapsedAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setWorkstationActiveSessionId = useSetAtom(
      workstationActiveSessionIdAtom
    );
    const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);
    const setSelectedProject = useSetAtom(chatPanelSelectedProjectAtom);
    const setStickyNotesOpen = useSetAtom(chatPanelStickyNotesOpenAtom);
    const addStickyNotesSection = useSetAtom(addSectionAtom);
    const dispatchClearSession = useSetAtom(clearSessionAtom);
    const creatorState = useAtomValue(sessionCreatorStateAtom);
    const setCreatorState = useSetAtom(sessionCreatorStateAtom);
    const bumpProjectListRefresh = useSetAtom(projectListRefreshAtom);
    const allAgentDefs = useAtomValue(allAgentDefsAtom);

    const allBlocksCollapsed =
      collapseAllCommand.epoch > 0 ? collapseAllCommand.collapsed : false;
    const collapseToggleLabel = allBlocksCollapsed
      ? t("common:actions.expandAll")
      : t("common:actions.collapseAll");

    const handleToggleAllBlocksCollapsed = useCallback(() => {
      setAllBlocksCollapsed(!allBlocksCollapsed);
      closeHeaderActionsMenu();
    }, [allBlocksCollapsed, setAllBlocksCollapsed, closeHeaderActionsMenu]);

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
    }, [handleReloadSession, closeHeaderActionsMenu]);

    const handlePaginationToggle = useCallback(
      (checked: boolean) => {
        setPaginationEnabled(checked);
      },
      [setPaginationEnabled]
    );

    const handleNewSession = useCallback(() => {
      setContentMode(CHAT_PANEL_CONTENT_MODE.SESSION);
      setSelectedWorkItem(null);
      setSelectedProject(null);
      setStickyNotesOpen(false);
      dispatchClearSession();
      setWorkstationActiveSessionId(null);
      setActiveSessionId(null);
    }, [
      dispatchClearSession,
      setActiveSessionId,
      setContentMode,
      setSelectedProject,
      setSelectedWorkItem,
      setStickyNotesOpen,
      setWorkstationActiveSessionId,
    ]);

    const handleAddStickyNotesSection = useCallback(() => {
      addStickyNotesSection();
    }, [addStickyNotesSection]);

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
    }, [events, closeHeaderActionsMenu]);

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

    // ── Render ───────────────────────────────────────────────────────
    /** When the resize handle is shown, it already draws the 1px seam — avoid border + handle (double line). */
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

    const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
    const sessionSidebarVisible = sessionSidebarWidth > 0;
    const showSessionContent =
      active &&
      contentMode === CHAT_PANEL_CONTENT_MODE.SESSION &&
      !!currentSessionId;
    const showWorkItemContent = !!selectedWorkItem && !showSessionContent;
    const showProjectContent =
      !!selectedProject && !showSessionContent && !showWorkItemContent;
    // Sticky-notes board sits at the same precedence rank as project /
    // work-item — render it only when no session / work-item / project is
    // active. The atom is mutually exclusive at write time (entry points
    // null out the sibling atoms), so we just gate read-side here.
    const showStickyNotesContent =
      stickyNotesOpen &&
      !showSessionContent &&
      !showWorkItemContent &&
      !showProjectContent;
    const showExplicitNonSessionContent =
      contentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION;
    const showNonSessionContent =
      !showWorkItemContent &&
      !showProjectContent &&
      !showStickyNotesContent &&
      !showSessionContent;
    const showPanelContent =
      active ||
      showWorkItemContent ||
      showProjectContent ||
      showStickyNotesContent ||
      showExplicitNonSessionContent;
    const showHeader =
      showStickyNotesContent ||
      showWorkItemContent ||
      showProjectContent ||
      showExplicitNonSessionContent ||
      (active && (showSessionContent || viewMode === "workStation"));
    const workItemTitle = selectedWorkItem?.workItem.name || "Work item";
    const projectTitle = selectedProject?.project.name || t("projects.project");
    const headerTitle = showStickyNotesContent
      ? t("navigation:stickyNotes.boardTitle")
      : selectedWorkItem
        ? currentSessionId
          ? `${workItemTitle} » ${panelTitle}`
          : workItemTitle
        : selectedProject
          ? projectTitle
          : panelTitle;
    // The "+" (new session) button is redundant when the session sidebar is
    // visible, so only surface it in the chat header when that sidebar is off.
    const showNewSessionButton =
      showSessionContent && sidebarCollapsed && !sessionSidebarVisible;
    const isBenchmarkTarget =
      createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK;
    const isProjectTarget = createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT;
    const isWorkItemTarget =
      createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM;
    const showCreatorPresenceInHeader =
      !showSessionContent &&
      !selectedWorkItem &&
      !selectedProject &&
      !showStickyNotesContent &&
      !isBenchmarkTarget &&
      !isProjectTarget &&
      !isWorkItemTarget;
    const showWorkItemAgentSwitchInHeader =
      showNonSessionContent &&
      !selectedWorkItem &&
      !selectedProject &&
      !showStickyNotesContent &&
      isWorkItemTarget &&
      Boolean(SessionCreatorSlot);
    const showProjectAgentSwitchInHeader =
      showNonSessionContent &&
      !selectedWorkItem &&
      !selectedProject &&
      !showStickyNotesContent &&
      isProjectTarget &&
      Boolean(SessionCreatorSlot);
    const chatFocusLabel = isChatFocus
      ? t("chat.showWorkstation")
      : t("chat.maximizeChatPanel");
    const chatFocusShortcut = getShortcutKeys("maximize_chat");
    const chatFocusTooltip = (
      <KeyboardShortcutTooltipContent
        label={chatFocusLabel}
        shortcut={chatFocusShortcut}
      />
    );
    const showEmptyChatFocusRestoreButton =
      !showSessionContent &&
      !selectedWorkItem &&
      !selectedProject &&
      !showStickyNotesContent &&
      isChatFocus &&
      showChatFocusToggle;

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

    const handleOpenBenchmarkTab = useCallback(() => {
      openWorkStationTab(createBenchmarkTab());
      if (isChatFocus) {
        toggleChatFocus();
      }
    }, [isChatFocus, openWorkStationTab, toggleChatFocus]);
    const { footerSlot: benchmarkPanel } = useBenchmarkSessionCreatorSlots({
      enabled: isBenchmarkTarget,
      onOpenBenchmarkTab: handleOpenBenchmarkTab,
    });

    const handleChatPanelProjectCreated = useCallback(
      (options?: { keepOpen?: boolean }) => {
        bumpProjectListRefresh((prev) => prev + 1);
        if (options?.keepOpen) return;
        setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        handleNewSession();
      },
      [bumpProjectListRefresh, handleNewSession, setCreateTarget]
    );

    const handleCancelWorkItemCreate = useCallback(() => {
      setWorkItemCreateDraft(null);
      setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
      setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      handleNewSession();
    }, [SessionCreatorSlot, handleNewSession, setCreateTarget]);

    const handleWorkItemAgentCreatorToggle = useCallback(
      (enabled: boolean) => {
        setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot) && enabled);
      },
      [SessionCreatorSlot]
    );

    const handleProjectAgentCreatorToggle = useCallback(
      (enabled: boolean) => {
        setShowProjectAgentCreator(Boolean(SessionCreatorSlot) && enabled);
      },
      [SessionCreatorSlot]
    );

    const handleChatPanelWorkItemCreated = useCallback(
      (result?: CreatedWorkItemResult) => {
        if (!result) return;
        const workItem =
          result.workItem ??
          (result.item
            ? workItemDataToUI(result.item, {
                labelMap: new Map(),
                memberMap: new Map(),
              })
            : null);
        if (!workItem) return;
        setSelectedProject(null);
        setSelectedWorkItem({
          shortId: result.shortId,
          projectSlug: result.projectSlug ?? "",
          projectId:
            result.item?.frontmatter.project ?? workItem.project?.id ?? "",
          projectName: workItem.project?.name ?? "",
          workItem,
        });
        if (!result.keepOpen) {
          setWorkItemCreateDraft(null);
          setShowWorkItemAgentCreator(Boolean(SessionCreatorSlot));
          setCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
          setContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
          dispatchClearSession();
          setWorkstationActiveSessionId(null);
          setActiveSessionId(null);
        }
      },
      [
        SessionCreatorSlot,
        dispatchClearSession,
        setActiveSessionId,
        setContentMode,
        setCreateTarget,
        setSelectedProject,
        setSelectedWorkItem,
        setWorkstationActiveSessionId,
      ]
    );

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

    const handleWorkItemTitleChange = useCallback(
      (title: string) => {
        if (!selectedWorkItem || title === selectedWorkItem.workItem.name) {
          return;
        }

        const previousSelectedWorkItem = selectedWorkItem;
        setSelectedWorkItem({
          ...selectedWorkItem,
          workItem: {
            ...selectedWorkItem.workItem,
            name: title,
          },
        });

        projectApi
          .updateWorkItemPartial(
            selectedWorkItem.projectSlug,
            selectedWorkItem.shortId,
            {
              title,
            }
          )
          .then((updatedWorkItem) => {
            setSelectedWorkItem((currentSelectedWorkItem) => {
              if (
                !currentSelectedWorkItem ||
                currentSelectedWorkItem.projectSlug !==
                  selectedWorkItem.projectSlug ||
                currentSelectedWorkItem.shortId !== selectedWorkItem.shortId
              ) {
                return currentSelectedWorkItem;
              }

              return {
                ...currentSelectedWorkItem,
                workItem: enrichedWorkItemToUI(updatedWorkItem),
              };
            });
            return emit("orgii-data-changed");
          })
          .catch(() => {
            setSelectedWorkItem((currentSelectedWorkItem) => {
              if (
                !currentSelectedWorkItem ||
                currentSelectedWorkItem.projectSlug !==
                  previousSelectedWorkItem.projectSlug ||
                currentSelectedWorkItem.shortId !==
                  previousSelectedWorkItem.shortId
              ) {
                return currentSelectedWorkItem;
              }
              return previousSelectedWorkItem;
            });
          });
      },
      [selectedWorkItem, setSelectedWorkItem]
    );

    const handleProjectTitleChange = useCallback(
      (title: string) => {
        if (!selectedProject || title === selectedProject.project.name) {
          return;
        }

        const projectSlug =
          selectedProject.projectSlug || selectedProject.project.slug;
        if (!projectSlug) return;

        const previousSelectedProject = selectedProject;
        const previousDescription = selectedProject.project.description;
        setSelectedProject({
          ...selectedProject,
          project: {
            ...selectedProject.project,
            name: title,
            description:
              previousDescription === selectedProject.project.name
                ? title
                : previousDescription,
          },
        });

        projectApi
          .readProject(projectSlug)
          .then((currentProject) =>
            projectApi.writeProject(
              projectSlug,
              {
                ...currentProject.meta,
                name: title,
                updated_at: new Date().toISOString(),
              },
              currentProject.description
            )
          )
          .then(() => {
            bumpProjectListRefresh((previous) => previous + 1);
            return emit("orgii-data-changed");
          })
          .catch(() => {
            setSelectedProject((currentSelectedProject) => {
              if (
                !currentSelectedProject ||
                currentSelectedProject.project.id !==
                  previousSelectedProject.project.id
              ) {
                return currentSelectedProject;
              }
              return previousSelectedProject;
            });
          });
      },
      [bumpProjectListRefresh, selectedProject, setSelectedProject]
    );

    const headerSection = (
      <ChatPanelHeader
        activeSessionExists={Boolean(activeSession)}
        allBlocksCollapsed={allBlocksCollapsed}
        collapseToggleLabel={collapseToggleLabel}
        copyEventJsonLabel={copyEventJsonLabel}
        createTarget={createTarget}
        createTargetOptions={createTargetOptions}
        currentSessionId={currentSessionId ?? null}
        eventsLength={events.length}
        handleAddStickyNotesSection={handleAddStickyNotesSection}
        handleChatFocusToggle={handleChatFocusToggle}
        handleCopyEventJson={handleCopyEventJson}
        handleCreateTargetChange={handleCreateTargetChange}
        handleOpenExportSessionJson={handleOpenExportSessionJson}
        handleOpenLinkWorkItem={handleOpenLinkWorkItem}
        handleOpenSearch={handleOpenSearch}
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
        headerTitle={headerTitle}
        isChatFocus={isChatFocus}
        isCompactLayout={isCompactLayout}
        isHeaderActionsOpen={isHeaderActionsOpen}
        isHeaderActionsPositioned={isHeaderActionsPositioned}
        isProjectTarget={isProjectTarget}
        paginationEnabled={paginationEnabled}
        selectedProjectVisible={Boolean(selectedProject)}
        selectedWorkItemVisible={Boolean(selectedWorkItem)}
        shouldOffsetHeaderForCollapsedSidebar={
          shouldOffsetHeaderForCollapsedSidebar
        }
        showChatFocusToggle={showChatFocusToggle}
        showCreatorPresenceInHeader={showCreatorPresenceInHeader}
        showHeader={showHeader}
        showNewSessionButton={showNewSessionButton}
        showNonSessionContent={showNonSessionContent}
        showProjectAgentCreator={showProjectAgentCreator}
        showProjectAgentSwitchInHeader={showProjectAgentSwitchInHeader}
        showSessionContent={showSessionContent}
        showStickyNotesContent={showStickyNotesContent}
        showWorkItemAgentCreator={showWorkItemAgentCreator}
        showWorkItemAgentSwitchInHeader={showWorkItemAgentSwitchInHeader}
        t={t}
        toggleHeaderActionsMenu={toggleHeaderActionsMenu}
        visibleRegionNotice={visibleRegionNotice}
      />
    );

    const useFullScreenCreator =
      isChatFocus || useExternalWidth || chatWidth >= CHAT_MAX_WIDTH;
    const creatorVariant = useFullScreenCreator ? "fullScreen" : "default";
    const creatorClassName = "min-h-0 flex-1";
    const emptyChatContent = (
      <ChatPanelEmptyContent
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

    const chatColumn = (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!showPanelContent ? null : showWorkItemContent ? (
          <WorkItemPanelView selectedWorkItem={selectedWorkItem} />
        ) : showProjectContent && selectedProject ? (
          <ProjectPanelView selectedProject={selectedProject} />
        ) : showStickyNotesContent ? (
          <StickyNotesPanelView />
        ) : showSessionContent ? (
          <ChatView
            sessionId={currentSessionId}
            onRegisterSearchOpen={handleRegisterSearchOpen}
            turnPaginationEnabled={paginationEnabled}
            position={position}
          />
        ) : (
          emptyChatContent
        )}
        {showEmptyChatFocusRestoreButton && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center px-4">
            <Tooltip
              content={chatFocusTooltip}
              position="top"
              mouseEnterDelay={200}
              framedPanel
            >
              <span className="pointer-events-auto inline-flex">
                <Button
                  htmlType="button"
                  variant="secondary"
                  appearance="outline"
                  size="default"
                  shape="round"
                  onClick={handleChatFocusToggle}
                  aria-label={chatFocusLabel}
                  icon={<GalleryThumbnails size={15} strokeWidth={2} />}
                >
                  {chatFocusLabel}
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    );

    const mainPanel = (
      <div
        ref={panelRef}
        data-chat-panel
        data-testid="chat-panel"
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
      </>
    );
  }
);

ChatPanel.displayName = "ChatPanel";

export default ChatPanel;
