import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import SessionHoverCard from "@src/components/SessionHoverCard";
import type { Session } from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

interface UseChatPanelContentStateOptions {
  active: boolean;
  activeSession: Session | undefined;
  benchmarkMasterSessionId: string | undefined;
  benchmarkSessionGroupTitle: string;
  contentMode: ChatPanelContentMode;
  createTarget: ChatPanelCreateTarget;
  currentSessionId: string | null;
  exploreOpen: boolean;
  isChatFocus: boolean;
  panelTitle: string;
  selectedProject: ChatPanelSelectedProject | null;
  selectedWorkItem: ChatPanelSelectedWorkItem | null;
  selectedWorkspace: ChatPanelSelectedWorkspace | null;
  workspaceDashboardOpen: boolean;
  setActiveSessionId: (sessionId: string | null) => void;
  setContentMode: (mode: ChatPanelContentMode) => void;
  setWorkstationActiveSessionId: (sessionId: string | null) => void;
  showChatFocusToggle: boolean;
  sidebarCollapsed: boolean;
  sessionCreatorAvailable: boolean;
  sessionSidebarVisible: boolean;
  stickyNotesOpen: boolean;
  viewMode: string;
}

export interface ChatPanelContentState {
  handleBenchmarkSessionGroupHeaderClick: () => void;
  headerTitle: string;
  headerTitleContent: React.ReactNode | undefined;
  isBenchmarkTarget: boolean;
  isProjectTarget: boolean;
  isWorkItemTarget: boolean;
  showBenchmarkChildSessionContent: boolean;
  showBenchmarkSessionGroupContent: boolean;
  showCreatorPresenceInHeader: boolean;
  showEmptyChatFocusRestoreButton: boolean;
  showExploreContent: boolean;
  showExplicitNonSessionContent: boolean;
  showHeader: boolean;
  showNewSessionButton: boolean;
  showNonSessionContent: boolean;
  showPanelContent: boolean;
  showProjectAgentSwitchInHeader: boolean;
  showProjectContent: boolean;
  showSessionContent: boolean;
  showStickyNotesContent: boolean;
  showWorkItemAgentSwitchInHeader: boolean;
  showWorkItemContent: boolean;
  showWorkspaceDashboardContent: boolean;
  showWorkspaceOverviewContent: boolean;
}

const BENCHMARK_HEADER_SEGMENT_CLASS =
  "flex h-7 min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-text-1 transition-colors hover:bg-surface-hover";

export function useChatPanelContentState({
  active,
  activeSession,
  benchmarkMasterSessionId,
  benchmarkSessionGroupTitle,
  contentMode,
  createTarget,
  currentSessionId,
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
  sessionCreatorAvailable,
  sessionSidebarVisible,
  stickyNotesOpen,
  viewMode,
}: UseChatPanelContentStateOptions): ChatPanelContentState {
  const { t } = useTranslation([
    "sessions",
    "common",
    "projects",
    "navigation",
  ]);

  const showBenchmarkSessionGroupContent =
    active && contentMode === CHAT_PANEL_CONTENT_MODE.BENCHMARK_SESSION_GROUP;
  const showSessionContent =
    active &&
    !showBenchmarkSessionGroupContent &&
    contentMode === CHAT_PANEL_CONTENT_MODE.SESSION &&
    Boolean(currentSessionId);
  const showWorkItemContent =
    Boolean(selectedWorkItem) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent;
  const showProjectContent =
    Boolean(selectedProject) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent;
  const showWorkspaceDashboardContent =
    workspaceDashboardOpen &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent;
  const showExploreContent =
    exploreOpen &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showWorkspaceDashboardContent;
  const showWorkspaceOverviewContent =
    Boolean(selectedWorkspace) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent;
  const showStickyNotesContent =
    stickyNotesOpen &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent &&
    !showWorkspaceOverviewContent;
  const showExplicitNonSessionContent =
    contentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION;
  const showNonSessionContent =
    !showBenchmarkSessionGroupContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent &&
    !showWorkspaceOverviewContent &&
    !showStickyNotesContent &&
    !showSessionContent;
  const showPanelContent =
    active ||
    showBenchmarkSessionGroupContent ||
    showWorkItemContent ||
    showProjectContent ||
    showWorkspaceDashboardContent ||
    showExploreContent ||
    showWorkspaceOverviewContent ||
    showStickyNotesContent ||
    showExplicitNonSessionContent;
  const showHeader =
    showBenchmarkSessionGroupContent ||
    showStickyNotesContent ||
    showWorkItemContent ||
    showProjectContent ||
    showWorkspaceDashboardContent ||
    showExploreContent ||
    showWorkspaceOverviewContent ||
    showExplicitNonSessionContent ||
    (active && (showSessionContent || viewMode === "workStation"));

  const workItemTitle = selectedWorkItem?.workItem.name || "Work item";
  const projectTitle = selectedProject?.project.name || t("projects.project");
  const workspaceTitle =
    selectedWorkspace?.name || t("navigation:labels.workspace");
  const showBenchmarkChildSessionContent =
    showSessionContent &&
    Boolean(activeSession?.parentSessionId) &&
    activeSession?.parentSessionId === benchmarkMasterSessionId;
  const headerTitle = showBenchmarkSessionGroupContent
    ? benchmarkSessionGroupTitle
    : showBenchmarkChildSessionContent
      ? `${benchmarkSessionGroupTitle} > ${panelTitle}`
      : showStickyNotesContent
        ? t("navigation:stickyNotes.boardTitle")
        : selectedWorkItem
          ? currentSessionId
            ? `${workItemTitle} » ${panelTitle}`
            : workItemTitle
          : selectedProject
            ? projectTitle
            : showWorkspaceDashboardContent
              ? t("navigation:launchpad.dashboard")
              : showExploreContent
                ? t("navigation:explore.title", { defaultValue: "Explore" })
                : selectedWorkspace
                  ? workspaceTitle
                  : panelTitle;

  const handleBenchmarkSessionGroupHeaderClick = useCallback(() => {
    if (!benchmarkMasterSessionId) return;
    setActiveSessionId(benchmarkMasterSessionId);
    setWorkstationActiveSessionId(benchmarkMasterSessionId);
    setContentMode(CHAT_PANEL_CONTENT_MODE.BENCHMARK_SESSION_GROUP);
  }, [
    benchmarkMasterSessionId,
    setActiveSessionId,
    setContentMode,
    setWorkstationActiveSessionId,
  ]);

  const headerTitleContent = showBenchmarkChildSessionContent ? (
    <span className="flex min-w-0 max-w-full items-center gap-1.5">
      <button
        type="button"
        className={`${BENCHMARK_HEADER_SEGMENT_CLASS} cursor-pointer`}
        onClick={(event) => {
          event.stopPropagation();
          handleBenchmarkSessionGroupHeaderClick();
        }}
      >
        <span className="min-w-0 -translate-y-px truncate">
          {benchmarkSessionGroupTitle}
        </span>
      </button>
      <span className="shrink-0 text-text-4">&gt;</span>
      {currentSessionId ? (
        <SessionHoverCard sessionId={currentSessionId}>
          <span className={`${BENCHMARK_HEADER_SEGMENT_CLASS} cursor-default`}>
            <span className="min-w-0 -translate-y-px truncate">
              {panelTitle}
            </span>
          </span>
        </SessionHoverCard>
      ) : (
        <span className={`${BENCHMARK_HEADER_SEGMENT_CLASS} cursor-default`}>
          <span className="min-w-0 -translate-y-px truncate">{panelTitle}</span>
        </span>
      )}
    </span>
  ) : showWorkspaceDashboardContent ||
    showExploreContent ||
    showWorkspaceOverviewContent ? (
    <span className={`${BENCHMARK_HEADER_SEGMENT_CLASS} cursor-default`}>
      <span className="min-w-0 -translate-y-px truncate">{headerTitle}</span>
    </span>
  ) : undefined;

  const showNewSessionButton =
    showSessionContent && sidebarCollapsed && !sessionSidebarVisible;
  const isBenchmarkTarget = createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK;
  const isProjectTarget = createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT;
  const isWorkItemTarget = createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM;
  const showCreatorPresenceInHeader =
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedWorkspace &&
    !showStickyNotesContent &&
    !showExploreContent &&
    !isBenchmarkTarget &&
    !isProjectTarget &&
    !isWorkItemTarget;
  const showWorkItemAgentSwitchInHeader =
    showNonSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedWorkspace &&
    !showStickyNotesContent &&
    !showExploreContent &&
    isWorkItemTarget &&
    sessionCreatorAvailable;
  const showProjectAgentSwitchInHeader =
    showNonSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedWorkspace &&
    !showStickyNotesContent &&
    !showExploreContent &&
    isProjectTarget &&
    sessionCreatorAvailable;
  const showEmptyChatFocusRestoreButton =
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedWorkspace &&
    !showStickyNotesContent &&
    !showExploreContent &&
    isChatFocus &&
    showChatFocusToggle;

  return {
    handleBenchmarkSessionGroupHeaderClick,
    headerTitle,
    headerTitleContent,
    isBenchmarkTarget,
    isProjectTarget,
    isWorkItemTarget,
    showBenchmarkChildSessionContent,
    showBenchmarkSessionGroupContent,
    showCreatorPresenceInHeader,
    showEmptyChatFocusRestoreButton,
    showExploreContent,
    showExplicitNonSessionContent,
    showHeader,
    showNewSessionButton,
    showNonSessionContent,
    showPanelContent,
    showProjectAgentSwitchInHeader,
    showProjectContent,
    showSessionContent,
    showStickyNotesContent,
    showWorkItemAgentSwitchInHeader,
    showWorkItemContent,
    showWorkspaceDashboardContent,
    showWorkspaceOverviewContent,
  };
}
