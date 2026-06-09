import { useCallback } from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { SESSION_SIDEBAR_PAGE_SIZE } from "@src/store/session";
import {
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelNavigateCommand,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
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

interface UseProjectsMenuItemClickParams<Project, WorkItem, LinearWorkItem> {
  activateMyStationRouteForProjectsContent: () => void;
  getProjectsLoadMoreGroupId: (id: string) => string | null;
  loadProjectsLinearOrgWorkItems: (orgId: string) => void;
  navigateChatPanel: (command: ChatPanelNavigateCommand) => void;
  openProjectsLinearWorkItem: (workItem: LinearWorkItem) => void;
  projectsLinearWorkItemMap: ReadonlyMap<string, LinearWorkItem>;
  projectsProjectMap: ReadonlyMap<string, Project>;
  projectsWorkItemMap: ReadonlyMap<string, WorkItem>;
  resetOpsControlStateForProjectsContent: () => void;
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
  navigateChatPanel,
  openProjectsLinearWorkItem,
  projectsLinearWorkItemMap,
  projectsProjectMap,
  projectsWorkItemMap,
  resetOpsControlStateForProjectsContent,
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
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_PROJECT });
        return;
      }

      if (item.id === PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID);
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM });
        return;
      }

      const createWorkItemOrgId = getProjectsWorkItemCreateOrgId(item.id);
      if (createWorkItemOrgId) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(item.id);
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM });
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
        navigateChatPanel({
          kind: CHAT_PANEL_SURFACE_KIND.PROJECT,
          project: toChatPanelProject(project),
        });
        return;
      }

      const linearWorkItemId = getProjectsLinearWorkItemId(item.id);
      if (linearWorkItemId) {
        const linearWorkItem = projectsLinearWorkItemMap.get(linearWorkItemId);
        if (!linearWorkItem) return;
        setProjectsSelectedMenuItemId(item.id);
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.SESSION });
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
      navigateChatPanel({
        kind: CHAT_PANEL_SURFACE_KIND.WORK_ITEM,
        workItem: chatPanelWorkItem,
      });
    },
    [
      activateMyStationRouteForProjectsContent,
      getProjectsLoadMoreGroupId,
      loadProjectsLinearOrgWorkItems,
      navigateChatPanel,
      openProjectsLinearWorkItem,
      projectsLinearWorkItemMap,
      projectsProjectMap,
      projectsWorkItemMap,
      resetOpsControlStateForProjectsContent,
      setProjectsGroupVisibleCounts,
      setProjectsSelectedMenuItemId,
      toChatPanelProject,
      toChatPanelWorkItem,
    ]
  );
}
