import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import { ROUTES } from "@src/config/routes";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Repo } from "@src/store/repo";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
} from "@src/store/ui/chatPanelAtom";
import type { WorkspaceFolder } from "@src/types/workspace";

import {
  FOLDERS_DASHBOARD_ITEM_ID,
  FOLDERS_EXPLORE_ITEM_ID,
  FOLDERS_REPO_ITEM_PREFIX,
  FOLDERS_WORKSPACE_ITEM_PREFIX,
  getRepoDisplayName,
} from "./foldersSidebarMenuItems";

type WorkspaceFoldersSetter = (
  folders: WorkspaceFolder[],
  workspaceId?: string | null
) => void;
type NullableSetter<T> = (value: T | null) => void;

interface UseFoldersMenuItemClickParams {
  dispatchSetWorkspaceFolders: WorkspaceFoldersSetter;
  navigate: NavigateFunction;
  repos: readonly Repo[];
  resetOpsControlStateForProjectsContent: () => void;
  resolveWorkspaceRepoName: (
    folder: WorkspaceRecord["folders"][number]
  ) => string;
  savedWorkspaces: readonly WorkspaceRecord[];
  selectRepo: (repoId: string) => void;
  setActiveWorkspaceName: NullableSetter<string>;
  setChatPanelContentMode: (mode: ChatPanelContentMode) => void;
  setChatPanelCreateProjectContext: NullableSetter<ChatPanelCreateProjectContext>;
  setChatPanelCreateTarget: (target: ChatPanelCreateTarget) => void;
  setChatPanelSelectedProject: NullableSetter<ChatPanelSelectedProject>;
  setChatPanelSelectedWorkItem: NullableSetter<ChatPanelSelectedWorkItem>;
  setChatPanelSelectedWorkspace: NullableSetter<ChatPanelSelectedWorkspace>;
  setChatPanelExploreOpen: (open: boolean) => void;
  setChatPanelStickyNotesOpen: (open: boolean) => void;
  setChatPanelWorkspaceDashboardOpen: (open: boolean) => void;
  setChatPanelWorkspaceOverviewTab: (tab: WorkspaceOverviewTab) => void;
  setFoldersDashboardSelected: (selected: boolean) => void;
  setFoldersExploreSelected: (selected: boolean) => void;
  setProjectsSelectedMenuItemId: (id: string) => void;
}

export function useFoldersMenuItemClick({
  dispatchSetWorkspaceFolders,
  navigate,
  repos,
  resetOpsControlStateForProjectsContent,
  resolveWorkspaceRepoName,
  savedWorkspaces,
  selectRepo,
  setActiveWorkspaceName,
  setChatPanelContentMode,
  setChatPanelCreateProjectContext,
  setChatPanelCreateTarget,
  setChatPanelSelectedProject,
  setChatPanelSelectedWorkItem,
  setChatPanelExploreOpen,
  setChatPanelSelectedWorkspace,
  setChatPanelStickyNotesOpen,
  setChatPanelWorkspaceDashboardOpen,
  setChatPanelWorkspaceOverviewTab,
  setFoldersDashboardSelected,
  setFoldersExploreSelected,
  setProjectsSelectedMenuItemId,
}: UseFoldersMenuItemClickParams): (
  key: string,
  item: NavigationMenuItem
) => void {
  return useCallback(
    (_key: string, item: NavigationMenuItem) => {
      if (item.id === FOLDERS_DASHBOARD_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId("");
        setFoldersDashboardSelected(true);
        setFoldersExploreSelected(false);
        setChatPanelWorkspaceDashboardOpen(true);
        setChatPanelExploreOpen(false);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateProjectContext(null);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        navigate(ROUTES.workStation.code.path);
        return;
      }

      if (item.id === FOLDERS_EXPLORE_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId("");
        setFoldersDashboardSelected(false);
        setFoldersExploreSelected(true);
        setChatPanelExploreOpen(true);
        setChatPanelWorkspaceDashboardOpen(false);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateProjectContext(null);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        navigate(ROUTES.workStation.code.path);
        return;
      }

      const workspaceId = item.id.startsWith(FOLDERS_WORKSPACE_ITEM_PREFIX)
        ? item.id.slice(FOLDERS_WORKSPACE_ITEM_PREFIX.length)
        : "";
      if (workspaceId) {
        const workspace = savedWorkspaces.find(
          (candidate) => candidate.workspaceId === workspaceId
        );
        if (!workspace) return;
        const folders: WorkspaceFolder[] = workspace.folders.map((folder) => ({
          id: crypto.randomUUID(),
          name: resolveWorkspaceRepoName(folder),
          path: folder.folderPath,
          uri: `file://${folder.folderPath}`,
          isPrimary: folder.isPrimary,
          repoId: folder.repoId ?? undefined,
          kind: folder.kind === "folder" ? "folder" : "git",
        }));
        dispatchSetWorkspaceFolders(folders, workspace.workspaceId);
        setActiveWorkspaceName(workspace.name);
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId("");
        setFoldersDashboardSelected(false);
        setFoldersExploreSelected(false);
        setChatPanelExploreOpen(false);
        setChatPanelWorkspaceDashboardOpen(false);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelSelectedWorkspace(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateProjectContext(null);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        setChatPanelSelectedWorkspace({
          kind: "workspace",
          id: workspace.workspaceId,
          name: workspace.name,
          folderCount: folders.length,
          repoIds: folders
            .map((folder) => folder.repoId)
            .filter((repoId): repoId is string => Boolean(repoId)),
        });
        setChatPanelWorkspaceOverviewTab(WORKSPACE_OVERVIEW_TAB.OVERVIEW);
        navigate(ROUTES.workStation.code.path);
        return;
      }

      const repoId = item.id.startsWith(FOLDERS_REPO_ITEM_PREFIX)
        ? item.id.slice(FOLDERS_REPO_ITEM_PREFIX.length)
        : "";
      if (!repoId) return;
      const repo = repos.find((candidate) => candidate.id === repoId);
      selectRepo(repoId);
      dispatchSetWorkspaceFolders([], null);
      setActiveWorkspaceName(null);
      resetOpsControlStateForProjectsContent();
      setProjectsSelectedMenuItemId("");
      setFoldersDashboardSelected(false);
      setFoldersExploreSelected(false);
      setChatPanelExploreOpen(false);
      setChatPanelWorkspaceDashboardOpen(false);
      setChatPanelSelectedWorkItem(null);
      setChatPanelSelectedProject(null);
      setChatPanelStickyNotesOpen(false);
      setChatPanelCreateProjectContext(null);
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
      setChatPanelSelectedWorkspace({
        kind: "repo",
        id: repoId,
        name: repo ? getRepoDisplayName(repo) : item.label,
        path: repo?.path ?? undefined,
      });
      setChatPanelWorkspaceOverviewTab(WORKSPACE_OVERVIEW_TAB.OVERVIEW);
      navigate(ROUTES.workStation.code.path);
    },
    [
      dispatchSetWorkspaceFolders,
      navigate,
      repos,
      resetOpsControlStateForProjectsContent,
      resolveWorkspaceRepoName,
      savedWorkspaces,
      selectRepo,
      setActiveWorkspaceName,
      setChatPanelContentMode,
      setChatPanelCreateProjectContext,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelExploreOpen,
      setChatPanelSelectedWorkspace,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
      setChatPanelWorkspaceDashboardOpen,
      setChatPanelWorkspaceOverviewTab,
      setFoldersDashboardSelected,
      setFoldersExploreSelected,
      setProjectsSelectedMenuItemId,
    ]
  );
}
