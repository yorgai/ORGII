import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import SessionHoverCard from "@src/components/SessionHoverCard";
import { ChatPanelHeaderBreadcrumb } from "@src/engines/ChatPanel/header";
import type { Session } from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedCollabOrg,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedProjectOrg,
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
  collabOrgHeaderTitle?: string;
  collabOrgHeaderTitleContent?: React.ReactNode;
  selectedCollabOrg: ChatPanelSelectedCollabOrg | null;
  selectedProject: ChatPanelSelectedProject | null;
  selectedProjectOrg: ChatPanelSelectedProjectOrg | null;
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
  showCollabOrgContent: boolean;
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
  showProjectOrgContent: boolean;
  showSessionContent: boolean;
  showWorkItemAgentSwitchInHeader: boolean;
  showWorkItemContent: boolean;
  showWorkspaceDashboardContent: boolean;
  showWorkspaceOverviewContent: boolean;
}

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
  collabOrgHeaderTitle,
  collabOrgHeaderTitleContent,
  selectedCollabOrg,
  selectedProject,
  selectedProjectOrg,
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
  const showProjectOrgContent =
    Boolean(selectedProjectOrg) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent;
  const showWorkspaceDashboardContent =
    workspaceDashboardOpen &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showProjectOrgContent;
  const showExploreContent =
    exploreOpen &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showProjectOrgContent &&
    !showWorkspaceDashboardContent;
  const showCollabOrgContent =
    Boolean(selectedCollabOrg) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showProjectOrgContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent;
  const showWorkspaceOverviewContent =
    Boolean(selectedWorkspace) &&
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showProjectOrgContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent &&
    !showCollabOrgContent;
  const showExplicitNonSessionContent =
    contentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION;
  const showNonSessionContent =
    !showBenchmarkSessionGroupContent &&
    !showWorkItemContent &&
    !showProjectContent &&
    !showProjectOrgContent &&
    !showWorkspaceDashboardContent &&
    !showExploreContent &&
    !showCollabOrgContent &&
    !showWorkspaceOverviewContent &&
    !showSessionContent;
  const showPanelContent =
    active ||
    showBenchmarkSessionGroupContent ||
    showWorkItemContent ||
    showProjectContent ||
    showProjectOrgContent ||
    showWorkspaceDashboardContent ||
    showExploreContent ||
    showCollabOrgContent ||
    showWorkspaceOverviewContent ||
    showExplicitNonSessionContent;
  const showHeader =
    showBenchmarkSessionGroupContent ||
    showWorkItemContent ||
    showProjectContent ||
    showProjectOrgContent ||
    showWorkspaceDashboardContent ||
    showExploreContent ||
    showCollabOrgContent ||
    showWorkspaceOverviewContent ||
    showExplicitNonSessionContent ||
    (active && (showSessionContent || viewMode === "workStation"));

  const workItemTitle = selectedWorkItem?.workItem.name || "Work item";
  const projectTitle = selectedProject?.project.name || t("projects.project");
  const projectOrgTitle =
    selectedProjectOrg?.orgName || t("projects:orgs.title");
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
      : selectedWorkItem
        ? currentSessionId
          ? `${workItemTitle} » ${panelTitle}`
          : workItemTitle
        : selectedProject
          ? projectTitle
          : selectedProjectOrg
            ? projectOrgTitle
            : showWorkspaceDashboardContent
              ? t("navigation:launchpad.dashboard")
              : showExploreContent
                ? t("navigation:explore.title", { defaultValue: "Explore" })
                : showCollabOrgContent
                  ? (collabOrgHeaderTitle ??
                    t("navigation:collaboration.orgDemoTitle"))
                  : createTarget === CHAT_PANEL_CREATE_TARGET.COLLAB_ORG
                    ? t("navigation:collaboration.addOrg")
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
    <ChatPanelHeaderBreadcrumb
      items={[
        {
          key: "benchmark-group",
          label: benchmarkSessionGroupTitle,
          onClick: (event) => {
            event.stopPropagation();
            handleBenchmarkSessionGroupHeaderClick();
          },
        },
        {
          key: "benchmark-session",
          label: currentSessionId ? (
            <SessionHoverCard sessionId={currentSessionId}>
              <span className="min-w-0 truncate">{panelTitle}</span>
            </SessionHoverCard>
          ) : (
            panelTitle
          ),
        },
      ]}
    />
  ) : showWorkItemContent && selectedWorkItem ? (
    <ChatPanelHeaderBreadcrumb
      items={[
        {
          key: "org",
          label: selectedWorkItem.orgName || t("projects:orgs.personalOrg"),
        },
        {
          key: "project",
          label:
            selectedWorkItem.projectName ||
            selectedWorkItem.workItem.project?.name ||
            t("projects.dashboardTitle"),
        },
        {
          key: "work-item",
          label: workItemTitle,
        },
      ]}
    />
  ) : showProjectOrgContent && selectedProjectOrg ? (
    <ChatPanelHeaderBreadcrumb
      items={[{ key: "org", label: selectedProjectOrg.orgName }]}
    />
  ) : showCollabOrgContent && collabOrgHeaderTitleContent ? (
    collabOrgHeaderTitleContent
  ) : showWorkspaceDashboardContent ||
    showExploreContent ||
    showCollabOrgContent ||
    showWorkspaceOverviewContent ? (
    <ChatPanelHeaderBreadcrumb
      items={[{ key: "surface", label: headerTitle }]}
    />
  ) : undefined;

  const showNewSessionButton =
    showSessionContent && sidebarCollapsed && !sessionSidebarVisible;
  const isBenchmarkTarget = createTarget === CHAT_PANEL_CREATE_TARGET.BENCHMARK;
  const isProjectTarget = createTarget === CHAT_PANEL_CREATE_TARGET.PROJECT;
  const isWorkItemTarget = createTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM;
  const isCollabOrgTarget =
    createTarget === CHAT_PANEL_CREATE_TARGET.COLLAB_ORG;
  const showCreatorPresenceInHeader =
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedProjectOrg &&
    !selectedWorkspace &&
    !selectedCollabOrg &&
    !showExploreContent &&
    !isBenchmarkTarget &&
    !isProjectTarget &&
    !isWorkItemTarget &&
    !isCollabOrgTarget;
  const showWorkItemAgentSwitchInHeader =
    showNonSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedProjectOrg &&
    !selectedWorkspace &&
    !selectedCollabOrg &&
    !showExploreContent &&
    isWorkItemTarget &&
    sessionCreatorAvailable;
  const showProjectAgentSwitchInHeader =
    showNonSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedProjectOrg &&
    !selectedWorkspace &&
    !selectedCollabOrg &&
    !showExploreContent &&
    isProjectTarget &&
    sessionCreatorAvailable;
  const showEmptyChatFocusRestoreButton =
    !showBenchmarkSessionGroupContent &&
    !showSessionContent &&
    !selectedWorkItem &&
    !selectedProject &&
    !selectedProjectOrg &&
    !selectedWorkspace &&
    !selectedCollabOrg &&
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
    showCollabOrgContent,
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
    showProjectOrgContent,
    showSessionContent,
    showWorkItemAgentSwitchInHeader,
    showWorkItemContent,
    showWorkspaceDashboardContent,
    showWorkspaceOverviewContent,
  };
}
