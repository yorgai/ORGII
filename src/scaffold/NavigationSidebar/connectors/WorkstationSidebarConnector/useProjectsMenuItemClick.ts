import { useCallback } from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { SESSION_SIDEBAR_PAGE_SIZE } from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
} from "@src/store/ui/chatPanelAtom";

import {
  PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
} from "../sidebarConnectorUtils";
import {
  getProjectsLinearLoadOrgId,
  getProjectsLinearWorkItemId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
} from "../useProjectsWorkItemMenuItems";

type NullableSetter<T> = (value: T | null) => void;

interface UseProjectsMenuItemClickParams<Project, WorkItem, LinearWorkItem> {
  activateMyStationRouteForProjectsContent: () => void;
  getProjectsLoadMoreGroupId: (id: string) => string | null;
  loadProjectsLinearOrgWorkItems: (orgId: string) => void;
  openProjectsLinearWorkItem: (workItem: LinearWorkItem) => void;
  projectsLinearWorkItemMap: ReadonlyMap<string, LinearWorkItem>;
  projectsProjectMap: ReadonlyMap<string, Project>;
  projectsWorkItemMap: ReadonlyMap<string, WorkItem>;
  resetOpsControlStateForProjectsContent: () => void;
  setChatPanelContentMode: (mode: ChatPanelContentMode) => void;
  setChatPanelCreateProjectContext: NullableSetter<ChatPanelCreateProjectContext>;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
  setChatPanelSelectedProject: NullableSetter<ChatPanelSelectedProject>;
  setChatPanelSelectedWorkItem: NullableSetter<ChatPanelSelectedWorkItem>;
  setChatPanelSelectedWorkspace: NullableSetter<ChatPanelSelectedWorkspace>;
  setChatPanelStickyNotesOpen: (open: boolean) => void;
  setProjectsGroupVisibleCounts: React.Dispatch<
    React.SetStateAction<Map<string, number>>
  >;
  setProjectsSelectedMenuItemId: (id: string) => void;
  toChatPanelProject: (project: Project) => ChatPanelSelectedProject;
  toChatPanelWorkItem: (workItem: WorkItem) => ChatPanelSelectedWorkItem;
}

export function useProjectsMenuItemClick<Project, WorkItem, LinearWorkItem>({
  activateMyStationRouteForProjectsContent,
  getProjectsLoadMoreGroupId,
  loadProjectsLinearOrgWorkItems,
  openProjectsLinearWorkItem,
  projectsLinearWorkItemMap,
  projectsProjectMap,
  projectsWorkItemMap,
  resetOpsControlStateForProjectsContent,
  setChatPanelContentMode,
  setChatPanelCreateProjectContext,
  setChatPanelCreateTarget,
  setChatPanelSelectedProject,
  setChatPanelSelectedWorkItem,
  setChatPanelSelectedWorkspace,
  setChatPanelStickyNotesOpen,
  setProjectsGroupVisibleCounts,
  setProjectsSelectedMenuItemId,
  toChatPanelProject,
  toChatPanelWorkItem,
}: UseProjectsMenuItemClickParams<Project, WorkItem, LinearWorkItem>): (
  key: string,
  item: NavigationMenuItem
) => void {
  return useCallback(
    (_key: string, item: NavigationMenuItem) => {
      if (item.id === PROJECTS_NEW_PROJECT_MENU_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(PROJECTS_NEW_PROJECT_MENU_ITEM_ID);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateProjectContext(null);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.PROJECT);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      if (item.id === PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const createWorkItemOrgId = getProjectsWorkItemCreateOrgId(item.id);
      if (createWorkItemOrgId) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const linearLoadOrgId = getProjectsLinearLoadOrgId(item.id);
      if (linearLoadOrgId) {
        loadProjectsLinearOrgWorkItems(linearLoadOrgId);
        return;
      }

      const loadMoreGroupId = getProjectsLoadMoreGroupId(item.id);
      if (loadMoreGroupId) {
        setProjectsGroupVisibleCounts((previousCounts) => {
          const nextCounts = new Map(previousCounts);
          const current =
            nextCounts.get(loadMoreGroupId) ?? SESSION_SIDEBAR_PAGE_SIZE;
          nextCounts.set(loadMoreGroupId, current + SESSION_SIDEBAR_PAGE_SIZE);
          return nextCounts;
        });
        return;
      }

      const projectOverviewSlug = getProjectsProjectOverviewSlug(item.id);
      if (projectOverviewSlug) {
        const project = projectsProjectMap.get(projectOverviewSlug);
        if (!project) return;
        activateMyStationRouteForProjectsContent();
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(toChatPanelProject(project));
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const linearWorkItemId = getProjectsLinearWorkItemId(item.id);
      if (linearWorkItemId) {
        const linearWorkItem = projectsLinearWorkItemMap.get(linearWorkItemId);
        if (!linearWorkItem) return;
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        openProjectsLinearWorkItem(linearWorkItem);
        return;
      }

      const workItemId = getProjectsWorkItemId(item.id);
      if (!workItemId) return;
      const workItem = projectsWorkItemMap.get(workItemId);
      if (!workItem) return;
      const chatPanelWorkItem = toChatPanelWorkItem(workItem);
      activateMyStationRouteForProjectsContent();
      setProjectsSelectedMenuItemId(item.id);
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      setChatPanelSelectedProject(null);
      setChatPanelSelectedWorkspace(null);
      setChatPanelSelectedWorkItem(chatPanelWorkItem);
      setChatPanelStickyNotesOpen(false);
      setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
    },
    [
      activateMyStationRouteForProjectsContent,
      getProjectsLoadMoreGroupId,
      loadProjectsLinearOrgWorkItems,
      openProjectsLinearWorkItem,
      projectsLinearWorkItemMap,
      projectsProjectMap,
      projectsWorkItemMap,
      resetOpsControlStateForProjectsContent,
      setChatPanelContentMode,
      setChatPanelCreateProjectContext,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelSelectedWorkspace,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
      setProjectsGroupVisibleCounts,
      setProjectsSelectedMenuItemId,
      toChatPanelProject,
      toChatPanelWorkItem,
    ]
  );
}
