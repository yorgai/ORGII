import type { TFunction } from "i18next";
import { type MouseEvent, useMemo } from "react";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import type { AvailableAgent } from "@src/config/cliAgents";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
import { rustBuiltInVariantsFromDefinitions } from "@src/modules/shared/launchpad/hooks";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Repo } from "@src/store/repo";
import type { SessionCreatorDraft } from "@src/store/session";

import {
  buildDraftMenuItems,
  buildFoldersPinnedMenuItems,
  buildPinnedMenuItems,
  buildProjectsPinnedMenuItems,
} from "../workstationSidebarMenuItems";
import {
  FOLDERS_DASHBOARD_ITEM_ID,
  FOLDERS_EXPLORE_ITEM_ID,
  buildFoldersSidebarMenuItems,
} from "./foldersSidebarMenuItems";
import type { WorkstationSidebarKey } from "./types";

type TCommon = (key: string, defaultValue?: string) => string;

interface UsePinnedMenuItemsParams {
  activeSidebarKey: WorkstationSidebarKey;
  createProjectLabel: string;
  createWorkItemLabel: string;
  newSessionLabel: string;
  stickyNotesLabel: string;
  t: TFunction<"navigation">;
}

interface UsePinnedMenuItemsResult {
  pinnedMenuItems: NavigationMenuItem[];
  sessionPinnedMenuItems: NavigationMenuItem[];
}

export function usePinnedMenuItems({
  activeSidebarKey,
  createProjectLabel,
  createWorkItemLabel,
  newSessionLabel,
  stickyNotesLabel,
  t,
}: UsePinnedMenuItemsParams): UsePinnedMenuItemsResult {
  const sessionPinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildPinnedMenuItems({
        newSessionLabel,
        newSessionShortcut: getShortcutKeys("new_session"),
        kanbanLabel: t("routes.kanban"),
        kanbanRoutePath: ROUTES.workStation.kanban.path,
        stickyNotesLabel,
      }),
    [newSessionLabel, stickyNotesLabel, t]
  );
  const projectsPinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildProjectsPinnedMenuItems({ createProjectLabel, createWorkItemLabel }),
    [createProjectLabel, createWorkItemLabel]
  );
  const foldersPinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildFoldersPinnedMenuItems({
        dashboardItemId: FOLDERS_DASHBOARD_ITEM_ID,
        dashboardLabel: t("launchpad.dashboard"),
        exploreItemId: FOLDERS_EXPLORE_ITEM_ID,
        exploreLabel: t("explore.title", { defaultValue: "Explore" }),
      }),
    [t]
  );
  const pinnedMenuItems =
    activeSidebarKey === "projects"
      ? projectsPinnedMenuItems
      : activeSidebarKey === "folders"
        ? foldersPinnedMenuItems
        : sessionPinnedMenuItems;

  return { pinnedMenuItems, sessionPinnedMenuItems };
}

export function useSessionSidebarMenuItems({
  menuItems,
  sessionCreatorDrafts,
  t,
}: {
  menuItems: readonly NavigationMenuItem[];
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
  t: TFunction<"navigation">;
}): NavigationMenuItem[] {
  const draftMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildDraftMenuItems({
        sessionCreatorDrafts,
        draftsLabel: t("labels.drafts"),
      }),
    [sessionCreatorDrafts, t]
  );
  return useMemo(
    () => [...draftMenuItems, ...menuItems],
    [draftMenuItems, menuItems]
  );
}

interface UseFoldersSidebarMenuItemsParams {
  builtInRustAgents: readonly AgentDefinition[];
  customRustAgents: readonly AgentDefinition[];
  installedCliAgents: readonly AvailableAgent[];
  localAccounts: readonly KeyVaultAccount[];
  repos: readonly Repo[];
  savedWorkspaces: readonly WorkspaceRecord[];
  t: TFunction<"navigation">;
  tCommon: TCommon;
  onAddWorkspaceFolder: () => void;
  onCreateMultiRepoWorkspace: () => void;
  onMoreActionsForWorkspace: (
    event: MouseEvent<HTMLButtonElement>,
    workspace: WorkspaceRecord
  ) => void;
  onMoreActionsForRepo: (
    event: MouseEvent<HTMLButtonElement>,
    repo: Repo
  ) => void;
  activeMoreMenuId: string;
}

export function useFoldersSidebarMenuItems({
  builtInRustAgents,
  customRustAgents,
  installedCliAgents,
  localAccounts,
  repos,
  savedWorkspaces,
  t,
  tCommon,
  onAddWorkspaceFolder,
  onCreateMultiRepoWorkspace,
  onMoreActionsForWorkspace,
  onMoreActionsForRepo,
  activeMoreMenuId,
}: UseFoldersSidebarMenuItemsParams): NavigationMenuItem[] {
  // Total agents count — must mirror what buildFoldersAgentMenuItems
  // renders. Rust built-ins are deduped via the catalog helper so the
  // tile/row counts agree (one row per unique RustAgentType variant).
  const rustBuiltInVariantCount = useMemo(
    () => rustBuiltInVariantsFromDefinitions([...builtInRustAgents]).length,
    [builtInRustAgents]
  );
  const totalAgentsCount =
    installedCliAgents.length +
    rustBuiltInVariantCount +
    customRustAgents.length;

  return useMemo<NavigationMenuItem[]>(
    () =>
      buildFoldersSidebarMenuItems({
        savedWorkspaces,
        repos,
        localAccounts,
        installedCliAgents,
        builtInRustAgents,
        customRustAgents,
        multiRepoWorkspaceCountLabel: (count) =>
          t("sidebar.folderCounts.multiRepoWorkspace", { count }),
        repoCountLabel: (count) => t("sidebar.folderCounts.repo", { count }),
        myKeysLabel: t("sessions:controlTower.myApiKeys", {
          count: localAccounts.length,
        }),
        myAgentsLabel: t("sessions:controlTower.myAgents", {
          count: totalAgentsCount,
        }),
        onAddWorkspaceFolder,
        onCreateMultiRepoWorkspace,
        onMoreActionsForWorkspace,
        onMoreActionsForRepo,
        moreActionLabel: tCommon("actions.more"),
        addWorkspaceFolderLabel: tCommon(
          "ellipsisMenu.addWorkspace",
          "Add workspace..."
        ),
        createMultiRepoWorkspaceLabel: tCommon(
          "workspaceForm.createWorkspace",
          "Create Multi-repo Workspace"
        ),
        activeMoreMenuId,
      }),
    [
      totalAgentsCount,
      activeMoreMenuId,
      builtInRustAgents,
      customRustAgents,
      installedCliAgents,
      localAccounts,
      onAddWorkspaceFolder,
      onCreateMultiRepoWorkspace,
      onMoreActionsForRepo,
      onMoreActionsForWorkspace,
      repos,
      savedWorkspaces,
      t,
      tCommon,
    ]
  );
}
