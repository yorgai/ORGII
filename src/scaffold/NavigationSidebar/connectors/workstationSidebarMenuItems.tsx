import { Plus, Radar, SquarePen, X } from "lucide-react";
import React from "react";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { SessionCreatorDraft } from "@src/store/session";
import { formatCompactTimeAgo } from "@src/util/data/formatters/date";
import { resolveSessionRowIcon } from "@src/util/session/sessionSidebarRow";

import {
  NEW_SESSION_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
  QUICKSTART_KANBAN_MENU_ITEM_ID,
  getDraftMenuItemId,
  getDraftPreviewText,
} from "./sidebarConnectorUtils";

interface BuildPinnedMenuItemsParams {
  newSessionLabel: string;
  kanbanLabel: string;
  kanbanRoutePath: string;
}

interface BuildProjectsPinnedMenuItemsParams {
  newWorkItemLabel: string;
}

export function buildPinnedMenuItems({
  newSessionLabel,
  kanbanLabel,
  kanbanRoutePath,
}: BuildPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: NEW_SESSION_MENU_ITEM_ID,
      key: NEW_SESSION_MENU_ITEM_ID,
      label: newSessionLabel,
      icon: Plus,
      iconName: "plus",
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
  newWorkItemLabel,
}: BuildProjectsPinnedMenuItemsParams): NavigationMenuItem[] {
  return [
    {
      id: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      key: PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
      label: newWorkItemLabel,
      icon: SquarePen,
      iconName: "square-pen",
    },
  ];
}

interface BuildDraftMenuItemsParams {
  sessionCreatorDrafts: readonly SessionCreatorDraft[];
  draftsLabel: string;
  deleteLabel: string;
  onDeleteDraft: (event: React.MouseEvent, draftId: string) => void;
}

export function buildDraftMenuItems({
  sessionCreatorDrafts,
  draftsLabel,
  deleteLabel,
  onDeleteDraft,
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
        shortcut: formatCompactTimeAgo(draft.createdAt),
        trailingElement: (
          <span className="h-1.5 w-1.5 rounded-full border border-border-3 bg-transparent" />
        ),
        showMoreActions: true,
        rowActionIcon: X,
        rowActionLabel: deleteLabel,
        onRowActionClick: (event) => onDeleteDraft(event, draft.id),
      } satisfies NavigationMenuItem;
    }),
  ];
}
