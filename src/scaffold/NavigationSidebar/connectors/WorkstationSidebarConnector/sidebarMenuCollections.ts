import type { TFunction } from "i18next";
import { useMemo } from "react";

import type { WorkspaceRecord } from "@src/api/tauri/workspace";
import type { AvailableAgent } from "@src/config/cliAgents";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";
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
  FOLDERS_ADD_WORKSPACE_ITEM_ID,
  FOLDERS_CREATE_WORKSPACE_ITEM_ID,
  FOLDERS_DASHBOARD_ITEM_ID,
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
  tCommon: TCommon;
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
  tCommon,
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
        addWorkspaceItemId: FOLDERS_ADD_WORKSPACE_ITEM_ID,
        addWorkspaceLabel: tCommon("actions.addWorkspace"),
        createWorkspaceItemId: FOLDERS_CREATE_WORKSPACE_ITEM_ID,
        createWorkspaceLabel: t("common:workspaceForm.createWorkspace"),
      }),
    [t, tCommon]
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
}

export function useFoldersSidebarMenuItems({
  builtInRustAgents,
  customRustAgents,
  installedCliAgents,
  localAccounts,
  repos,
  savedWorkspaces,
  t,
}: UseFoldersSidebarMenuItemsParams): NavigationMenuItem[] {
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
        myKeysLabel: t("labels.myKeys"),
        myAgentsLabel: t("labels.myAgents"),
      }),
    [
      builtInRustAgents,
      customRustAgents,
      installedCliAgents,
      localAccounts,
      repos,
      savedWorkspaces,
      t,
    ]
  );
}
