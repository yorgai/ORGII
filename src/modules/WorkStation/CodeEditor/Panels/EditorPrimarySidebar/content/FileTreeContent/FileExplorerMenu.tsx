/**
 * FileExplorerContextMenu Component
 *
 * Native OS context menu for file explorer using Tauri v2 Menu API.
 * Provides file operations like new file, new folder, rename, delete, copy, paste.
 *
 * Uses dispatch() for actions per GUI Action System guidelines.
 */
import {
  MenuItem,
  PredefinedMenuItem,
  Submenu,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import i18next from "i18next";
import { useEffect, useRef } from "react";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";
import { createLogger } from "@src/hooks/logger";
import { fileClipboardAtom } from "@src/store/workstation/codeEditor/file";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { copyText } from "@src/util/data/clipboard";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

const logger = createLogger("WorkStationFileExplorerMenu");

// ============================================
// Types
// ============================================

/** Dispatch function type for GUI actions */
type DispatchFn = (
  actionType: string,
  payload: Record<string, unknown>,
  source: "user" | "ai" | "system"
) => Promise<unknown>;

export interface FileExplorerContextMenuProps {
  /** The node that was right-clicked (null for background click) */
  node: TreePanelNode | null;
  /** Repository path for relative path calculation */
  repoPath: string;
  /** Callback when menu is closed */
  onClose: () => void;
  /** Callback to enter rename mode for a node */
  onStartRename?: (path: string) => void;
  /** Callback to start creating a new file/folder (VS Code inline pattern) */
  onStartCreateNew?: (parentDir: string, isFolder: boolean) => void;
  /** Dispatch function for GUI actions */
  dispatch: DispatchFn;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get the target directory for new file/folder operations
 */
function getTargetDirectory(
  node: TreePanelNode | null,
  repoPath: string
): string {
  if (!node) return repoPath;
  if (node.type === "directory") return node.path;
  // For files, use parent directory
  return node.path.substring(0, node.path.lastIndexOf("/")) || repoPath;
}

/**
 * Copy text to clipboard
 */
function copyToClipboard(text: string): void {
  copyText(text).catch((err) => {
    logger.error("Failed to copy to clipboard:", err);
  });
}

/**
 * Get relative path from absolute path
 */
function getRelativePath(absolutePath: string, repoPath: string): string {
  if (!absolutePath || !repoPath) return absolutePath;
  const normalizedRepo = repoPath.replace(/\/$/, "");
  const normalizedPath = absolutePath.replace(/\/$/, "");
  if (normalizedPath.startsWith(normalizedRepo)) {
    const relative = normalizedPath.slice(normalizedRepo.length);
    return relative.startsWith("/") ? relative.slice(1) : relative;
  }
  return absolutePath;
}

// ============================================
// Module-level ref for menu callbacks
// Same pattern as TabContextMenu
// ============================================

const contextMenuRef: { current: FileExplorerContextMenuProps | null } = {
  current: null,
};

// ============================================
// Main Component
// ============================================

export function FileExplorerContextMenu(props: FileExplorerContextMenuProps) {
  const { node, repoPath, onClose, dispatch } = props;
  const hasShownMenu = useRef(false);

  // Store props in module-level ref for menu callbacks
  useEffect(() => {
    contextMenuRef.current = props;
    return () => {
      contextMenuRef.current = null;
    };
  }, [props]);

  // Show native Tauri menu once on mount
  useEffect(() => {
    if (hasShownMenu.current) return;
    hasShownMenu.current = true;

    async function showNativeMenu() {
      try {
        const items: (MenuItem | PredefinedMenuItem | Submenu)[] = [];
        const t = i18next.t.bind(i18next);

        // --- New File / New Folder (created in parallel) ---
        const [newFileItem, newFolderItem] = await Promise.all([
          MenuItem.new({
            text: t("actions.newFile", { defaultValue: "New File" }),
            accelerator: "CmdOrCtrl+N",
            action: () => {
              if (contextMenuRef.current) {
                const dir = getTargetDirectory(
                  contextMenuRef.current.node,
                  contextMenuRef.current.repoPath
                );
                const closeMenu = contextMenuRef.current.onClose;
                const startCreateNew = contextMenuRef.current.onStartCreateNew;
                closeMenu();
                if (startCreateNew) {
                  requestAnimationFrame(() => startCreateNew(dir, false));
                }
              }
            },
          }),
          MenuItem.new({
            text: t("actions.newFolder", { defaultValue: "New Folder" }),
            accelerator: "CmdOrCtrl+Shift+N",
            action: () => {
              if (contextMenuRef.current) {
                const dir = getTargetDirectory(
                  contextMenuRef.current.node,
                  contextMenuRef.current.repoPath
                );
                const closeMenu = contextMenuRef.current.onClose;
                const startCreateNew = contextMenuRef.current.onStartCreateNew;
                closeMenu();
                if (startCreateNew) {
                  requestAnimationFrame(() => startCreateNew(dir, true));
                }
              }
            },
          }),
        ]);

        items.push(newFileItem, newFolderItem);

        // If a node is selected, add node-specific actions
        if (node) {
          // Create all node-specific items in parallel
          const store = getInstrumentedStore();
          const clipboard = store.get(fileClipboardAtom);
          const hasPasteItems = clipboard && clipboard.paths.length > 0;

          const [
            separator1,
            renameItem,
            deleteItem,
            duplicateItem,
            separator2,
            copyItem,
            pasteItem,
            separator3,
            copyPathItem,
            copyRelativePathItem,
            separator4,
            revealFinderItem,
          ] = await Promise.all([
            // separator1
            PredefinedMenuItem.new({ item: "Separator" }),
            // renameItem
            MenuItem.new({
              text: t("actions.rename", { defaultValue: "Rename" }),
              accelerator: "Enter",
              action: () => {
                if (contextMenuRef.current?.node) {
                  if (contextMenuRef.current.onStartRename) {
                    contextMenuRef.current.onStartRename(
                      contextMenuRef.current.node.path
                    );
                  }
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // deleteItem
            MenuItem.new({
              text: t("actions.delete", { defaultValue: "Delete" }),
              accelerator: "CmdOrCtrl+Backspace",
              action: async () => {
                if (contextMenuRef.current?.node) {
                  const nodePath = contextMenuRef.current.node.path;
                  const nodeName = contextMenuRef.current.node.name;
                  const closeMenu = contextMenuRef.current.onClose;
                  const dispatchAction = contextMenuRef.current.dispatch;
                  closeMenu();
                  const confirmed = await confirmDestructiveAction({
                    title: t("actions.confirmDelete", {
                      defaultValue: "Confirm Delete",
                    }),
                    message: `${t("actions.delete", { defaultValue: "Delete" })} "${nodeName}"?`,
                    okLabel: t("actions.delete", { defaultValue: "Delete" }),
                  });
                  if (confirmed) {
                    await dispatchAction(
                      "file.delete",
                      { path: nodePath },
                      "user"
                    );
                  }
                }
              },
            }),
            // duplicateItem
            MenuItem.new({
              text: t("actions.duplicate", { defaultValue: "Duplicate" }),
              accelerator: "CmdOrCtrl+D",
              action: () => {
                if (contextMenuRef.current?.node) {
                  contextMenuRef.current.dispatch(
                    "file.duplicate",
                    { path: contextMenuRef.current.node.path },
                    "user"
                  );
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // separator2
            PredefinedMenuItem.new({ item: "Separator" }),
            // copyItem
            MenuItem.new({
              text: t("actions.copy", { defaultValue: "Copy" }),
              accelerator: "CmdOrCtrl+C",
              action: () => {
                if (contextMenuRef.current?.node) {
                  contextMenuRef.current.dispatch(
                    "file.copy",
                    { paths: [contextMenuRef.current.node.path] },
                    "user"
                  );
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // pasteItem
            MenuItem.new({
              text: t("actions.paste", { defaultValue: "Paste" }),
              accelerator: "CmdOrCtrl+V",
              enabled: hasPasteItems ?? false,
              action: () => {
                if (contextMenuRef.current?.node) {
                  const dir = getTargetDirectory(
                    contextMenuRef.current.node,
                    contextMenuRef.current.repoPath
                  );
                  contextMenuRef.current.dispatch(
                    "file.paste",
                    { targetDir: dir },
                    "user"
                  );
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // separator3
            PredefinedMenuItem.new({ item: "Separator" }),
            // copyPathItem
            MenuItem.new({
              text: t("actions.copyPath", { defaultValue: "Copy Path" }),
              action: () => {
                if (contextMenuRef.current?.node) {
                  copyToClipboard(contextMenuRef.current.node.path);
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // copyRelativePathItem
            MenuItem.new({
              text: t("actions.copyRelativePath", {
                defaultValue: "Copy Relative Path",
              }),
              action: () => {
                if (contextMenuRef.current?.node) {
                  const rel = getRelativePath(
                    contextMenuRef.current.node.path,
                    contextMenuRef.current.repoPath
                  );
                  copyToClipboard(rel);
                  contextMenuRef.current.onClose();
                }
              },
            }),
            // separator4
            PredefinedMenuItem.new({ item: "Separator" }),
            // revealFileManagerItem
            MenuItem.new({
              text: t(getFileManagerRevealLabelKey()),
              action: () => {
                if (contextMenuRef.current?.node) {
                  contextMenuRef.current.dispatch(
                    "file.revealInFinder",
                    { path: contextMenuRef.current.node.path },
                    "user"
                  );
                  contextMenuRef.current.onClose();
                }
              },
            }),
          ]);

          items.push(
            separator1,
            renameItem,
            deleteItem,
            duplicateItem,
            separator2,
            copyItem,
            pasteItem,
            separator3,
            copyPathItem,
            copyRelativePathItem,
            separator4,
            revealFinderItem
          );
        } else {
          // Background click - only paste if available
          const store = getInstrumentedStore();
          const clipboard = store.get(fileClipboardAtom);
          const hasPasteItems = clipboard && clipboard.paths.length > 0;

          // Create background items in parallel
          const bgItems = await Promise.all([
            ...(hasPasteItems
              ? [
                  PredefinedMenuItem.new({ item: "Separator" }),
                  MenuItem.new({
                    text: t("actions.paste", { defaultValue: "Paste" }),
                    accelerator: "CmdOrCtrl+V",
                    action: () => {
                      if (contextMenuRef.current) {
                        contextMenuRef.current.dispatch(
                          "file.paste",
                          { targetDir: contextMenuRef.current.repoPath },
                          "user"
                        );
                        contextMenuRef.current.onClose();
                      }
                    },
                  }),
                ]
              : []),
            PredefinedMenuItem.new({ item: "Separator" }),
            MenuItem.new({
              text: t("actions.refresh", { defaultValue: "Refresh" }),
              action: () => {
                if (contextMenuRef.current) {
                  contextMenuRef.current.dispatch("file.refresh", {}, "user");
                  contextMenuRef.current.onClose();
                }
              },
            }),
          ]);
          items.push(...bgItems);
        }

        // Create and show the menu
        const menu = await TauriMenu.new({ items });
        await menu.popup();

        // After popup closes, ensure we clean up
        setTimeout(() => {
          onClose();
        }, 50);
      } catch (error) {
        console.error(
          "[FileExplorerContextMenu] Failed to show native context menu:",
          error
        );
        onClose();
      }
    }

    showNativeMenu();
  }, [node, repoPath, dispatch, onClose]);

  // Native menu doesn't render anything in React
  return null;
}

export default FileExplorerContextMenu;
