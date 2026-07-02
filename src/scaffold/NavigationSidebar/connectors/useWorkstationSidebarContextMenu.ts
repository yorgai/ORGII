import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import { type MouseEvent, useCallback } from "react";

import { createLogger } from "@src/hooks/logger";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";
import {
  isCliSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

import {
  getDraftIdFromMenuItemId,
  isDraftMenuItemId,
} from "./sidebarConnectorUtils";
import type { UseRenameSessionModalResult } from "./useRenameSessionModal";

const log = createLogger("WorkstationSidebar");

interface UseWorkstationSidebarContextMenuParams {
  sessionMap: Map<string, Session>;
  rename: UseRenameSessionModalResult;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleDeleteDraft: (draftId: string) => void;
  handleExportMarkdown: (sessionId: string) => Promise<void>;
  handleTogglePin: (sessionId: string) => Promise<void>;
  /** Owner-side share dialog gate + opener (design §6.3, M4b). */
  isShareEligible: (session: Session) => boolean;
  handleOpenShareSettings: (session: Session) => void;
  shareSettingsLabel: string;
  tCommon: (key: string, defaultValue?: string) => string;
}

export function useWorkstationSidebarContextMenu({
  sessionMap,
  rename,
  handleDeleteSession,
  handleDeleteDraft,
  handleExportMarkdown,
  handleTogglePin,
  isShareEligible,
  handleOpenShareSettings,
  shareSettingsLabel,
  tCommon,
}: UseWorkstationSidebarContextMenuParams): (
  event: MouseEvent,
  _key: string,
  item: NavigationMenuItem
) => Promise<void> {
  return useCallback(
    async (event: MouseEvent, _key: string, item: NavigationMenuItem) => {
      event.preventDefault();
      event.stopPropagation();

      if (isDraftMenuItemId(item.id)) {
        const draftId = getDraftIdFromMenuItemId(item.id);
        if (!draftId) return;
        const removeDraftItem = await MenuItem.new({
          text: tCommon("sessions:sidebar.removeDraft", "Remove draft"),
          action: () => handleDeleteDraft(draftId),
        });
        const menu = await TauriMenu.new({ items: [removeDraftItem] });
        await menu.popup();
        return;
      }

      if (!sessionMap.has(item.id)) return;

      if (isCursorIdeSession(item.id)) return;

      const session = sessionMap.get(item.id);
      const isCliSessionItem = isCliSession(item.id);

      try {
        const renameItem = await MenuItem.new({
          text: tCommon("actions.rename"),
          action: () => rename.open(item.id, sessionMap),
        });
        const exportItem = await MenuItem.new({
          text: tCommon("sessions:chat.exportAsMarkdown", "Export as Markdown"),
          action: () => handleExportMarkdown(item.id),
        });
        const pinLabel = session?.pinned
          ? tCommon("sessions:chat.unpinSession", "Unpin")
          : tCommon("sessions:chat.pinSession", "Pin");
        const pinItem = await MenuItem.new({
          text: pinLabel,
          action: () => handleTogglePin(item.id),
        });
        const deleteItem = await MenuItem.new({
          text: tCommon("actions.delete"),
          action: () => handleDeleteSession(item.id),
        });
        const menuSeparator = await PredefinedMenuItem.new({
          item: "Separator",
        });
        const primaryItems = [renameItem, exportItem];
        // Owner-side per-session sharing entry (design §6.3): only for the
        // user's OWN sessions whose repo sits in ≥1 connected supabase org's
        // repoScopes — teammate imports and out-of-scope repos get no item.
        if (session && isShareEligible(session)) {
          primaryItems.push(
            await MenuItem.new({
              text: shareSettingsLabel,
              action: () => handleOpenShareSettings(session),
            })
          );
        }
        const menuItems = isCliSessionItem
          ? [...primaryItems, menuSeparator, deleteItem]
          : [...primaryItems, pinItem, menuSeparator, deleteItem];
        const menu = await TauriMenu.new({ items: menuItems });
        await menu.popup();
      } catch (error) {
        log.error("[WorkstationSidebar] Context menu failed:", error);
      }
    },
    [
      sessionMap,
      tCommon,
      rename,
      handleDeleteSession,
      handleDeleteDraft,
      handleExportMarkdown,
      handleTogglePin,
      handleOpenShareSettings,
      isShareEligible,
      shareSettingsLabel,
    ]
  );
}
