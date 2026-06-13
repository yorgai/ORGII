import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";

import { repoApi } from "@src/api/tauri/repo";
import {
  type WorkspaceRecord,
  deleteWorkspace,
  listWorkspaces,
} from "@src/api/tauri/workspace";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import type { Repo } from "@src/store/repo";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

const logger = createLogger("FoldersSidebarContextMenu");

type TCommon = (key: string, defaultValue?: string) => string;

function stripFileUri(path: string): string {
  return path.replace(/^file:\/\//, "");
}

function getRepoPath(repo: Repo): string {
  return repo.fs_uri ? stripFileUri(repo.fs_uri) : (repo.path ?? "");
}

function getWorkspacePrimaryPath(workspace: WorkspaceRecord): string {
  const primaryFolder =
    workspace.folders.find((folder) => folder.isPrimary) ??
    workspace.folders[0];
  return primaryFolder?.folderPath ?? "";
}

interface UseFoldersSidebarContextMenuParams {
  activeWorkspaceId: string | null;
  clearActiveWorkspace: () => void;
  forceRefreshRepos: () => Promise<void>;
  onOpenWorkspace: (workspace: WorkspaceRecord) => void;
  onOpenRepo: (repo: Repo) => void;
  setSavedWorkspaces: (workspaces: WorkspaceRecord[]) => void;
  tCommon: TCommon;
}

export interface FoldersSidebarContextMenuHandlers {
  openWorkspaceMenu: (workspace: WorkspaceRecord) => Promise<void>;
  openRepoMenu: (repo: Repo) => Promise<void>;
}

export function useFoldersSidebarContextMenu({
  activeWorkspaceId,
  clearActiveWorkspace,
  forceRefreshRepos,
  onOpenWorkspace,
  onOpenRepo,
  setSavedWorkspaces,
  tCommon,
}: UseFoldersSidebarContextMenuParams): FoldersSidebarContextMenuHandlers {
  const removeWorkspace = useCallback(
    async (workspace: WorkspaceRecord) => {
      const confirmed = await confirmDestructiveAction({
        title: workspace.name,
        message: tCommon(
          "confirmation.deleteWorkspaceMessage",
          "This removes the workspace preset. Repo files on disk are not deleted."
        ),
        okLabel: tCommon("actions.delete"),
        cancelLabel: tCommon("actions.cancel"),
      });
      if (!confirmed) return;
      try {
        await deleteWorkspace(workspace.workspaceId);
        if (workspace.workspaceId === activeWorkspaceId) {
          clearActiveWorkspace();
        }
        const refreshed = await listWorkspaces();
        setSavedWorkspaces(refreshed);
        Message.success(
          tCommon(
            "selectors.spotlight.toast.workspaceRemoved",
            "Workspace deleted"
          )
        );
      } catch (error) {
        logger.error("Failed to delete workspace", error);
        Message.error(
          error instanceof Error
            ? error.message
            : tCommon(
                "selectors.spotlight.toast.workspaceRemoveFailed",
                "Failed to delete workspace"
              )
        );
      }
    },
    [activeWorkspaceId, clearActiveWorkspace, setSavedWorkspaces, tCommon]
  );

  const locatePath = useCallback(
    async (path: string) => {
      if (!path) {
        Message.warning(
          tCommon("errors.noLocalPath", "No local path available")
        );
        return;
      }
      try {
        await openPath(path);
      } catch (error) {
        logger.error("Failed to locate path", error);
        Message.error(
          error instanceof Error
            ? error.message
            : tCommon("errors.openInFinderFailed", "Failed to open in Finder")
        );
      }
    },
    [tCommon]
  );

  const removeRepo = useCallback(
    async (repo: Repo) => {
      const confirmed = await confirmDestructiveAction({
        title: tCommon("ellipsisMenu.removeRepo", "Remove from ORGII"),
        message: tCommon(
          "confirmation.deleteSelectedMessage",
          "This only removes their linkage to ORGII. Nothing will be removed from disk."
        ),
        okLabel: tCommon("actions.removeFromOrgii"),
        cancelLabel: tCommon("actions.cancel"),
      });
      if (!confirmed) return;
      try {
        await repoApi.deleteRepo(repo.id);
        await forceRefreshRepos();
        Message.success(
          tCommon(
            "selectors.spotlight.toast.repoRemoved",
            "Linkage to ORGII removed"
          )
        );
      } catch (error) {
        logger.error("Failed to remove linkage to ORGII", error);
        Message.error(
          error instanceof Error
            ? error.message
            : tCommon(
                "selectors.spotlight.toast.repoRemoveFailed",
                "Failed to remove linkage to ORGII"
              )
        );
      }
    },
    [forceRefreshRepos, tCommon]
  );

  const openWorkspaceMenu = useCallback(
    async (workspace: WorkspaceRecord) => {
      try {
        const openItem = await MenuItem.new({
          text: `${tCommon("actions.open")} ${tCommon(
            "workspaceForm.multiRepoWorkspace",
            "Workspace"
          )}`,
          action: () => {
            onOpenWorkspace(workspace);
          },
        });
        const locateItem = await MenuItem.new({
          text: tCommon(getFileManagerRevealLabelKey()),
          action: () => {
            void locatePath(getWorkspacePrimaryPath(workspace));
          },
        });
        const deleteItem = await MenuItem.new({
          text: tCommon("actions.delete"),
          action: () => {
            void removeWorkspace(workspace);
          },
        });
        const menuSeparator = await PredefinedMenuItem.new({
          item: "Separator",
        });
        const menu = await TauriMenu.new({
          items: [openItem, locateItem, menuSeparator, deleteItem],
        });
        await menu.popup();
      } catch (error) {
        logger.error("Workspace context menu failed", error);
      }
    },
    [locatePath, onOpenWorkspace, removeWorkspace, tCommon]
  );

  const openRepoMenu = useCallback(
    async (repo: Repo) => {
      try {
        const openItem = await MenuItem.new({
          text: `${tCommon("actions.open")} ${tCommon(
            "selectors.repo.sections.repo",
            "Repo"
          )}`,
          action: () => {
            onOpenRepo(repo);
          },
        });
        const locateItem = await MenuItem.new({
          text: tCommon(getFileManagerRevealLabelKey()),
          action: () => {
            void locatePath(getRepoPath(repo));
          },
        });
        const removeItem = await MenuItem.new({
          text: tCommon("ellipsisMenu.removeRepo", "Remove from ORGII"),
          action: () => {
            void removeRepo(repo);
          },
        });
        const menuSeparator = await PredefinedMenuItem.new({
          item: "Separator",
        });
        const menu = await TauriMenu.new({
          items: [openItem, locateItem, menuSeparator, removeItem],
        });
        await menu.popup();
      } catch (error) {
        logger.error("Repo context menu failed", error);
      }
    },
    [locatePath, onOpenRepo, removeRepo, tCommon]
  );

  return { openWorkspaceMenu, openRepoMenu };
}
