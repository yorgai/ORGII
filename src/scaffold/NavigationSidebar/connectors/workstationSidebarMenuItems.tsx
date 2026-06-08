import {
  Box,
  LayoutDashboard,
  Plus,
  Radar,
  SquarePen,
  StickyNote,
} from "lucide-react";
import React from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { SessionCreatorDraft } from "@src/store/session";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import {
  NEW_SESSION_MENU_ITEM_ID,
  PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
  QUICKSTART_KANBAN_MENU_ITEM_ID,
  STICKY_NOTES_MENU_ITEM_ID,
  getDraftMenuItemId,
  getDraftPreviewText,
} from "./sidebarConnectorUtils";

interface BuildPinnedMenuItemsParams {
  newSessionLabel: string;
  newSessionShortcut: string;
  kanbanLabel: string;
  kanbanRoutePath: string;
  stickyNotesLabel: string;
}

interface BuildProjectsPinnedMenuItemsParams {
  createProjectLabel: string;
  createWorkItemLabel: string;
}

interface BuildFoldersPinnedMenuItemsParams {
  dashboardItemId: string;
  dashboardLabel: string;
}

export function buildPinnedMenuItems({
  newSessionLabel,
  newSessionShortcut,
  kanbanLabel,
  kanbanRoutePath,
  stickyNotesLabel,
}: BuildPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: NEW_SESSION_MENU_ITEM_ID,
      key: NEW_SESSION_MENU_ITEM_ID,
      label: newSessionLabel,
      icon: Plus,
      iconName: "plus",
      shortcut: newSessionShortcut,
    },
    {
      id: STICKY_NOTES_MENU_ITEM_ID,
      key: STICKY_NOTES_MENU_ITEM_ID,
      label: stickyNotesLabel,
      icon: StickyNote,
      iconName: "sticky-note",
    },
    {
      id: QUICKSTART_KANBAN_MENU_ITEM_ID,
      key: QUICKSTART_KANBAN_MENU_ITEM_ID,
      label: kanbanLabel,
      icon: Radar,
      iconName: "radar",
      routePath: kanbanRoutePath,
    },
  ];
}

export function buildProjectsPinnedMenuItems({
  createProjectLabel,
  createWorkItemLabel,
}: BuildProjectsPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      key: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      label: createWorkItemLabel,
      icon: SquarePen,
      iconName: "square-pen",
    },
    {
      id: PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
      key: PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
      label: createProjectLabel,
      icon: Box,
      iconName: "box",
    },
  ];
}

export function buildFoldersPinnedMenuItems({
  dashboardItemId,
  dashboardLabel,
}: BuildFoldersPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: dashboardItemId,
      key: dashboardItemId,
      label: dashboardLabel,
      icon: LayoutDashboard,
      iconName: "layout-dashboard",
    },
  ];
}

interface BuildDraftMenuItemsParams {
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
  draftsLabel: string;
}

export function buildDraftMenuItems({
  sessionCreatorDrafts,
  draftsLabel,
}: BuildDraftMenuItemsParams): NavigationMenuItem[] {
  if (sessionCreatorDrafts.length === 0) return [];
  return [
    {
      id: "separator-drafts",
      key: "separator-drafts",
      label: draftsLabel,
    },
    ...sessionCreatorDrafts.map((draft) => {
      const menuItemId = getDraftMenuItemId(draft.id);
      return {
        id: menuItemId,
        key: menuItemId,
        label: getDraftPreviewText(draft),
        icon: resolveSessionRowIcon({
          session_id: draft.id,
          agentIconId: draft.agentIconId ?? undefined,
          cliAgentType: draft.cliAgentType ?? undefined,
        }),
        shortcut: formatRelativeTime(draft.createdAt, "nano"),
        trailingElement: (
          <span className="h-1.5 w-1.5 rounded-full border border-border-3 bg-transparent" />
        ),
      } satisfies NavigationMenuItem;
    }),
  ];
}
