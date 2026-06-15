import { useCallback } from "react";
import type { NavigateFunction } from "react-router-dom";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import { ROUTES } from "@src/config/routes";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Repo } from "@src/store/repo";
import {
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelNavigateCommand,
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

interface OpenWorkspaceTargetParams {
  dispatchSetWorkspaceFolders: WorkspaceFoldersSetter;
  resetOpsControlStateForProjectsContent: () => void;
  resolveWorkspaceRepoName: (
    folder: WorkspaceRecord["folders"][number]
  ) => string;
  setActiveWorkspaceName: NullableSetter<string>;
  workspace: WorkspaceRecord;
}

interface OpenRepoTargetParams {
  dispatchSetWorkspaceFolders: WorkspaceFoldersSetter;
  resetOpsControlStateForProjectsContent: () => void;
  selectRepo: (repoId: string) => void;
  setActiveWorkspaceName: NullableSetter<string>;
  repoId: string;
}

export function openWorkspaceTarget({
  dispatchSetWorkspaceFolders,
  resetOpsControlStateForProjectsContent,
  resolveWorkspaceRepoName,
  setActiveWorkspaceName,
  workspace,
}: OpenWorkspaceTargetParams): void {
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
}

export function openRepoTarget({
  dispatchSetWorkspaceFolders,
  resetOpsControlStateForProjectsContent,
  selectRepo,
  setActiveWorkspaceName,
  repoId,
}: OpenRepoTargetParams): void {
  selectRepo(repoId);
  dispatchSetWorkspaceFolders([], null);
  setActiveWorkspaceName(null);
  resetOpsControlStateForProjectsContent();
}

interface UseFoldersMenuItemClickParams {
  navigate: NavigateFunction;
  repos: readonly Repo[];
  resetOpsControlStateForProjectsContent: () => void;
  savedWorkspaces: readonly WorkspaceRecord[];
  navigateChatPanel: (command: ChatPanelNavigateCommand) => void;
  setFoldersDashboardSelected: (selected: boolean) => void;
  setFoldersExploreSelected: (selected: boolean) => void;
  setProjectsSelectedMenuItemId: (id: string) => void;
}

export function useFoldersMenuItemClick({
  navigate,
  repos,
  resetOpsControlStateForProjectsContent,
  savedWorkspaces,
  navigateChatPanel,
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
        navigateChatPanel({
          kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_DASHBOARD,
        });
        navigate(ROUTES.workStation.code.path);
        return;
      }

      if (item.id === FOLDERS_EXPLORE_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId("");
        setFoldersDashboardSelected(false);
        setFoldersExploreSelected(true);
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_EXPLORE });
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
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId("");
        setFoldersDashboardSelected(false);
        setFoldersExploreSelected(false);
        navigateChatPanel({
          kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW,
          workspace: {
            kind: "workspace",
            id: workspace.workspaceId,
            name: workspace.name,
            folderCount: workspace.folders.length,
            repoIds: workspace.folders
              .map((folder) => folder.repoId)
              .filter((repoId): repoId is string => Boolean(repoId)),
          },
        });
        navigate(ROUTES.workStation.code.path);
        return;
      }

      const repoId = item.id.startsWith(FOLDERS_REPO_ITEM_PREFIX)
        ? item.id.slice(FOLDERS_REPO_ITEM_PREFIX.length)
        : "";
      if (!repoId) return;
      const repo = repos.find((candidate) => candidate.id === repoId);
      resetOpsControlStateForProjectsContent();
      setProjectsSelectedMenuItemId("");
      setFoldersDashboardSelected(false);
      setFoldersExploreSelected(false);
      navigateChatPanel({
        kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW,
        workspace: {
          kind: "repo",
          id: repoId,
          name: repo ? getRepoDisplayName(repo) : item.label,
          path: repo?.path ?? undefined,
        },
      });
      navigate(ROUTES.workStation.code.path);
    },
    [
      navigate,
      repos,
      navigateChatPanel,
      resetOpsControlStateForProjectsContent,
      savedWorkspaces,
      setFoldersDashboardSelected,
      setFoldersExploreSelected,
      setProjectsSelectedMenuItemId,
    ]
  );
}
