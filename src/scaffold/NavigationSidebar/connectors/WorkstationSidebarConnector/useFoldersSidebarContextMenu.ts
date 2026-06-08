import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import { useCallback } from "react";

import { repoApi } from "@src/api/tauri/repo";
import {
  type WorkspaceRecord,
  deleteWorkspace,
  listWorkspaces,
} from "@src/api/tauri/workspace";
import Message from "@src/components/Toast";
import { createLogger } from "@src/hooks/logger";
import type { Repo } from "@src/store/repo";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

const logger = createLogger("FoldersSidebarContextMenu");

type TCommon = (key: string, defaultValue?: string) => string;

interface UseFoldersSidebarContextMenuParams {
  activeWorkspaceId: string | null;
  clearActiveWorkspace: () => void;
  forceRefreshRepos: () => Promise<void>;
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

  const removeRepo = useCallback(
    async (repo: Repo) => {
      const confirmed = await confirmDestructiveAction({
        title: tCommon("ellipsisMenu.removeRepo", "Remove repo"),
        message: tCommon(
          "confirmation.deleteSelectedMessage",
          "This unlinks the repo. Files on disk are not deleted."
        ),
        okLabel: tCommon("actions.delete"),
        cancelLabel: tCommon("actions.cancel"),
      });
      if (!confirmed) return;
      try {
        await repoApi.deleteRepo(repo.id);
        await forceRefreshRepos();
        Message.success(
          tCommon("selectors.spotlight.toast.repoRemoved", "Repo removed")
        );
      } catch (error) {
        logger.error("Failed to remove repo", error);
        Message.error(
          error instanceof Error
            ? error.message
            : tCommon(
                "selectors.spotlight.toast.repoRemoveFailed",
                "Failed to remove repo"
              )
        );
      }
    },
    [forceRefreshRepos, tCommon]
  );

  const openWorkspaceMenu = useCallback(
    async (workspace: WorkspaceRecord) => {
      try {
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
          items: [menuSeparator, deleteItem],
        });
        await menu.popup();
      } catch (error) {
        logger.error("Workspace context menu failed", error);
      }
    },
    [removeWorkspace, tCommon]
  );

  const openRepoMenu = useCallback(
    async (repo: Repo) => {
      try {
        const removeItem = await MenuItem.new({
          text: tCommon("ellipsisMenu.removeRepo", "Remove repo"),
          action: () => {
            void removeRepo(repo);
          },
        });
        const menuSeparator = await PredefinedMenuItem.new({
          item: "Separator",
        });
        const menu = await TauriMenu.new({
          items: [menuSeparator, removeItem],
        });
        await menu.popup();
      } catch (error) {
        logger.error("Repo context menu failed", error);
      }
    },
    [removeRepo, tCommon]
  );

  return { openWorkspaceMenu, openRepoMenu };
}
