/**
 * SourceControlContextMenu Component
 *
 * Native OS context menu for source control files using Tauri v2 Menu API.
 * Provides git operations: stage, discard, open changes, copy path, reveal in finder.
 * For conflict files: accept ours, accept theirs.
 *
 * Uses dispatch() for actions per GUI Action System guidelines.
 */
import {
  MenuItem,
  PredefinedMenuItem,
  Menu as TauriMenu,
} from "@tauri-apps/api/menu";
import i18next from "i18next";
import { useEffect, useRef } from "react";

import type { GitFile } from "@src/types/git/types";
import { copyText } from "@src/util/data/clipboard";
import { getFileManagerRevealLabelKey } from "@src/util/platform/fileManagerLabels";

import { GIT_LABELS } from "../config";

// ============================================
// Types
// ============================================

type DispatchFn = (
  actionType: string,
  payload: Record<string, unknown>,
  source: "user" | "ai" | "system"
) => Promise<unknown>;

export interface SourceControlContextMenuProps {
  file: GitFile;
  repoPath: string;
  isConflictFile: boolean;
  dispatch: DispatchFn;
  onSelect?: (fileId: string) => void;
  onStageToggle?: (fileId: string, stage: boolean) => Promise<void>;
  onDiscard?: (fileId: string) => Promise<void>;
  onStageResolved?: (fileId: string) => Promise<void>;
  onClose: () => void;
}

// Module-level ref for menu callbacks (Tauri menu actions run outside React)
const contextMenuRef: { current: SourceControlContextMenuProps | null } = {
  current: null,
};

// ============================================
// Component
// ============================================

export default function SourceControlContextMenu(
  props: SourceControlContextMenuProps
) {
  const { onClose } = props;
  const hasShownMenu = useRef(false);

  useEffect(() => {
    contextMenuRef.current = props;
    return () => {
      contextMenuRef.current = null;
    };
  }, [props]);

  useEffect(() => {
    if (hasShownMenu.current) return;
    hasShownMenu.current = true;

    async function showNativeMenu() {
      try {
        const ctx = contextMenuRef.current;
        if (!ctx) {
          onClose();
          return;
        }

        const { file, repoPath: _repoPath, isConflictFile } = ctx;
        const t = i18next.t.bind(i18next);

        const items: (MenuItem | PredefinedMenuItem)[] = [];

        // --- Open Changes (diff view) ---
        items.push(
          await MenuItem.new({
            text: GIT_LABELS.openChanges,
            action: () => {
              const ref = contextMenuRef.current;
              if (ref?.onSelect) {
                ref.onSelect(ref.file.id);
              }
            },
          })
        );

        // --- Open File ---
        items.push(
          await MenuItem.new({
            text: t("common:actions.openFile"),
            action: () => {
              const ref = contextMenuRef.current;
              if (ref) {
                const absPath = ref.repoPath
                  ? `${ref.repoPath}/${ref.file.path}`
                  : ref.file.path;
                ref.dispatch(
                  "file.openAtLine",
                  { path: absPath, line: 1 },
                  "user"
                );
              }
            },
          })
        );

        // --- Separator ---
        items.push(await PredefinedMenuItem.new({ item: "Separator" }));

        // --- Stage / Unstage ---
        if (!isConflictFile) {
          const isStaged = file.staged;
          items.push(
            await MenuItem.new({
              text: isStaged
                ? GIT_LABELS.unstageChanges
                : GIT_LABELS.stageChanges,
              action: () => {
                const ref = contextMenuRef.current;
                if (ref?.onStageToggle) {
                  ref.onStageToggle(ref.file.id, !ref.file.staged);
                }
              },
            })
          );
        }

        // --- Stage Resolved (conflict files) ---
        if (isConflictFile) {
          items.push(
            await MenuItem.new({
              text: GIT_LABELS.markAsResolved,
              action: () => {
                const ref = contextMenuRef.current;
                if (ref?.onStageResolved) {
                  ref.onStageResolved(ref.file.id);
                }
              },
            })
          );
        }

        // --- Discard Changes ---
        items.push(
          await MenuItem.new({
            text: GIT_LABELS.discardChanges,
            action: () => {
              const ref = contextMenuRef.current;
              if (ref?.onDiscard) {
                ref.onDiscard(ref.file.id);
              }
            },
          })
        );

        // --- Conflict resolution options ---
        if (isConflictFile) {
          items.push(await PredefinedMenuItem.new({ item: "Separator" }));

          items.push(
            await MenuItem.new({
              text: GIT_LABELS.acceptCurrentChange,
              action: () => {
                const ref = contextMenuRef.current;
                if (ref) {
                  ref.dispatch(
                    "git.resolveConflict",
                    { path: ref.file.path, strategy: "ours" },
                    "user"
                  );
                }
              },
            })
          );

          items.push(
            await MenuItem.new({
              text: GIT_LABELS.acceptIncomingChange,
              action: () => {
                const ref = contextMenuRef.current;
                if (ref) {
                  ref.dispatch(
                    "git.resolveConflict",
                    { path: ref.file.path, strategy: "theirs" },
                    "user"
                  );
                }
              },
            })
          );
        }

        // --- Separator ---
        items.push(await PredefinedMenuItem.new({ item: "Separator" }));

        // --- Copy Path ---
        items.push(
          await MenuItem.new({
            text: t("common:actions.copyPath"),
            accelerator: "CmdOrCtrl+Alt+C",
            action: async () => {
              const ref = contextMenuRef.current;
              if (ref) {
                const absPath = ref.repoPath
                  ? `${ref.repoPath}/${ref.file.path}`
                  : ref.file.path;
                await copyText(absPath);
              }
            },
          })
        );

        // --- Copy Relative Path ---
        items.push(
          await MenuItem.new({
            text: t("common:actions.copyRelativePath"),
            accelerator: "CmdOrCtrl+Shift+C",
            action: async () => {
              const ref = contextMenuRef.current;
              if (ref) {
                await copyText(ref.file.path);
              }
            },
          })
        );

        // --- Separator ---
        items.push(await PredefinedMenuItem.new({ item: "Separator" }));

        // --- Reveal in OS file manager ---
        items.push(
          await MenuItem.new({
            text: t(getFileManagerRevealLabelKey()),
            action: () => {
              const ref = contextMenuRef.current;
              if (ref) {
                const absPath = ref.repoPath
                  ? `${ref.repoPath}/${ref.file.path}`
                  : ref.file.path;
                ref.dispatch("file.revealInFinder", { path: absPath }, "user");
              }
            },
          })
        );

        // Build and show menu — popup() resolves when the menu closes
        // (whether an item was selected or dismissed by clicking elsewhere)
        const menu = await TauriMenu.new({ items });
        await menu.popup();
      } catch (error) {
        console.error("[SourceControlContextMenu] Failed to show menu:", error);
      } finally {
        // Always close so the parent resets showContextMenu → allows re-open
        onClose();
      }
    }

    showNativeMenu();
  }, [onClose]);

  // Native menu renders nothing in React
  return null;
}
