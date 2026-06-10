import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelContentMode,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelNavigateCommand,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
} from "@src/store/ui/chatPanelAtom";

export interface ChatPanelSurfaceSnapshot {
  contentMode: ChatPanelContentMode;
  createTarget: ChatPanelCreateTarget;
  createProjectContext: ChatPanelCreateProjectContext | null;
  selectedWorkItem: ChatPanelSelectedWorkItem | null;
  selectedProject: ChatPanelSelectedProject | null;
  selectedWorkspace: ChatPanelSelectedWorkspace | null;
  workspaceDashboardOpen: boolean;
  exploreOpen: boolean;
  workspaceOverviewTab: WorkspaceOverviewTab;
}

export const EMPTY_CHAT_PANEL_SURFACE_SNAPSHOT: ChatPanelSurfaceSnapshot = {
  contentMode: CHAT_PANEL_CONTENT_MODE.SESSION,
  createTarget: DEFAULT_CHAT_PANEL_CREATE_TARGET,
  createProjectContext: null,
  selectedWorkItem: null,
  selectedProject: null,
  selectedWorkspace: null,
  workspaceDashboardOpen: false,
  exploreOpen: false,
  workspaceOverviewTab: WORKSPACE_OVERVIEW_TAB.OVERVIEW,
};

export function reduceChatPanelSurfaceCommand(
  command: ChatPanelNavigateCommand
): ChatPanelSurfaceSnapshot {
  const next: ChatPanelSurfaceSnapshot = {
    ...EMPTY_CHAT_PANEL_SURFACE_SNAPSHOT,
    contentMode: CHAT_PANEL_CONTENT_MODE.NON_SESSION,
  };

  switch (command.kind) {
    case CHAT_PANEL_SURFACE_KIND.SESSION:
      return {
        ...next,
        contentMode: CHAT_PANEL_CONTENT_MODE.SESSION,
      };
    case CHAT_PANEL_SURFACE_KIND.BENCHMARK_SESSION_GROUP:
      return {
        ...next,
        contentMode: CHAT_PANEL_CONTENT_MODE.BENCHMARK_SESSION_GROUP,
      };
    case CHAT_PANEL_SURFACE_KIND.NEW_PROJECT:
      return {
        ...next,
        createTarget: CHAT_PANEL_CREATE_TARGET.PROJECT,
        createProjectContext: command.createProjectContext ?? null,
      };
    case CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM:
      return {
        ...next,
        createTarget: CHAT_PANEL_CREATE_TARGET.WORK_ITEM,
        createProjectContext: command.createProjectContext ?? null,
      };
    case CHAT_PANEL_SURFACE_KIND.PROJECT:
      return {
        ...next,
        selectedProject: command.project,
      };
    case CHAT_PANEL_SURFACE_KIND.WORK_ITEM:
      return {
        ...next,
        selectedWorkItem: command.workItem,
      };
    case CHAT_PANEL_SURFACE_KIND.WORKSPACE_DASHBOARD:
      return {
        ...next,
        workspaceDashboardOpen: true,
      };
    case CHAT_PANEL_SURFACE_KIND.WORKSPACE_EXPLORE:
      return {
        ...next,
        exploreOpen: true,
      };
    case CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW:
      return {
        ...next,
        selectedWorkspace: command.workspace,
        workspaceOverviewTab: command.tab ?? WORKSPACE_OVERVIEW_TAB.OVERVIEW,
      };
  }
}
