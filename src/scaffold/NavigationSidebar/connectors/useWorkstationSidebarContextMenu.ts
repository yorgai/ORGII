import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import { type MouseEvent, useCallback } from "react";

import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
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

interface UseWorkstationSidebarContextMenuParams {
  sessionMap: Map<string, Session>;
  rename: UseRenameSessionModalResult;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleDeleteDraft: (draftId: string) => void;
  handleExportMarkdown: (sessionId: string) => Promise<void>;
  handleTogglePin: (sessionId: string) => Promise<void>;
  handleAddTag: (sessionId: string) => Promise<void>;
  onShareSession: (sessionId: string) => void;
  tCommon: (key: string, defaultValue?: string) => string;
}

export function useWorkstationSidebarContextMenu({
  sessionMap,
  rename,
  handleDeleteSession,
  handleDeleteDraft,
  handleExportMarkdown,
  handleTogglePin,
  handleAddTag,
  onShareSession,
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
        const shareItem = await MenuItem.new({
          text: tCommon("sessions:sharing.shareSession", "Share Session…"),
          action: () => onShareSession(item.id),
        });
        const pinLabel = session?.pinned
          ? tCommon("sessions:chat.unpinSession", "Unpin")
          : tCommon("sessions:chat.pinSession", "Pin");
        const pinItem = await MenuItem.new({
          text: pinLabel,
          action: () => handleTogglePin(item.id),
        });
        const addTagItem = await MenuItem.new({
          text: tCommon("sessions:chat.addTag", "Add Tag…"),
          action: () => handleAddTag(item.id),
        });
        const deleteItem = await MenuItem.new({
          text: tCommon("actions.delete"),
          action: () => handleDeleteSession(item.id),
        });
        const menuSeparator = await PredefinedMenuItem.new({
          item: "Separator",
        });
        const shareableSession =
          session?.category === DISPATCH_CATEGORY.CLI_AGENT ||
          session?.category === DISPATCH_CATEGORY.RUST_AGENT;
        const primaryItems = shareableSession
          ? [renameItem, exportItem, shareItem]
          : [renameItem, exportItem];
        const menuItems = isCliSessionItem
          ? [...primaryItems, menuSeparator, deleteItem]
          : [...primaryItems, pinItem, addTagItem, menuSeparator, deleteItem];
        const menu = await TauriMenu.new({ items: menuItems });
        await menu.popup();
      } catch (error) {
        console.error("[WorkstationSidebar] Context menu failed:", error);
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
      handleAddTag,
      onShareSession,
    ]
  );
}
