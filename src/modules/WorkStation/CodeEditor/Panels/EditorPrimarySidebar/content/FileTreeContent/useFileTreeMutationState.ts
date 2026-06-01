/**
 * useFileTreeMutationState
 *
 * Encapsulates all file-tree mutation state:
 * - Inline rename (F2 / Enter, Backspace/Delete keyboard shortcuts)
 * - VS Code-style new file/folder creation via inline placeholder
 * - Placeholder insertion into the flattened node list
 * - Scroll-to-placeholder after insertion
 *
 * Extracted from FileTreeContent/index.tsx to keep the component file
 * under 600 lines.
 */
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { VirtuosoHandle } from "react-virtuoso";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";
import type { FlattenedTreeNode } from "@src/components/VirtualizedStickyTree";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

import type { DispatchFn, FlattenedNode } from "./types";

const NEW_ITEM_PLACEHOLDER_ID = "__new_item_placeholder__";

export interface UseFileTreeMutationStateOptions {
  selectedPath: string | null;
  baseFlattenedNodes: FlattenedNode[];
  onToggleDirectory: (path: string) => void;
  dispatch: DispatchFn;
  virtuosoRef: RefObject<VirtuosoHandle>;
}

export interface UseFileTreeMutationStateReturn {
  renamingPath: string | null;
  creatingNew: { parentDir: string; isFolder: boolean } | null;
  flattenedNodes: FlattenedNode[];
  handleStartRename: (path: string) => void;
  handleRenameConfirm: (oldPath: string, newName: string) => Promise<void>;
  handleRenameCancel: () => void;
  handleStartCreateNew: (parentDir: string, isFolder: boolean) => void;
  handleCreateNewConfirm: (name: string) => Promise<void>;
  handleCreateNewCancel: () => void;
  handleKeyDown: (event: KeyboardEvent) => Promise<void>;
}

export function useFileTreeMutationState({
  selectedPath,
  baseFlattenedNodes,
  onToggleDirectory,
  dispatch,
  virtuosoRef,
}: UseFileTreeMutationStateOptions): UseFileTreeMutationStateReturn {
  const { t } = useTranslation();

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState<{
    parentDir: string;
    isFolder: boolean;
  } | null>(null);

  // ── Rename handlers ─────────────────────────────────────────────────────────

  const handleStartRename = useCallback((path: string) => {
    setRenamingPath(path);
  }, []);

  const handleRenameConfirm = useCallback(
    async (oldPath: string, newName: string) => {
      const parentDir = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${parentDir}/${newName}`;
      await dispatch("file.rename", { oldPath, newPath }, "user");
      setRenamingPath(null);
    },
    [dispatch]
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  // ── Creation handlers ────────────────────────────────────────────────────────

  const pendingScrollToPlaceholderRef = useRef(false);

  const handleCreateNewConfirm = useCallback(
    async (name: string) => {
      if (!creatingNew || !name.trim()) {
        setCreatingNew(null);
        return;
      }
      const fullPath = `${creatingNew.parentDir}/${name.trim()}`;
      if (creatingNew.isFolder) {
        await dispatch("folder.create", { path: fullPath }, "user");
      } else {
        await dispatch("file.create", { path: fullPath, content: "" }, "user");
      }
      setCreatingNew(null);
    },
    [creatingNew, dispatch]
  );

  const handleCreateNewCancel = useCallback(() => {
    setCreatingNew(null);
  }, []);

  // ── Placeholder insertion ────────────────────────────────────────────────────

  const flattenedNodes = useMemo(() => {
    if (!creatingNew) return baseFlattenedNodes;

    const { parentDir, isFolder } = creatingNew;
    const nodes = [...baseFlattenedNodes];

    let parentIndex = -1;
    let parentDepth = 0;

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.node.path === parentDir && node.node.type === "directory") {
        parentIndex = index;
        parentDepth = node.depth + 1;
        break;
      }
    }

    let insertIndex: number;

    if (parentIndex === -1) {
      if (isFolder) {
        insertIndex = 0;
      } else {
        insertIndex = 0;
        for (let idx = 0; idx < nodes.length; idx++) {
          const node = nodes[idx];
          if (node.depth === 0 && node.node.type === "directory") {
            insertIndex = idx + 1;
            while (insertIndex < nodes.length && nodes[insertIndex].depth > 0) {
              insertIndex++;
            }
          } else if (node.depth === 0) {
            break;
          }
        }
      }
      parentDepth = 0;
    } else {
      if (isFolder) {
        insertIndex = parentIndex + 1;
      } else {
        insertIndex = parentIndex + 1;
        while (insertIndex < nodes.length) {
          const node = nodes[insertIndex];
          if (node.depth < parentDepth) break;
          if (node.depth > parentDepth) {
            insertIndex++;
            continue;
          }
          if (node.node.type === "directory") {
            insertIndex++;
          } else {
            break;
          }
        }
      }
    }

    const placeholderNode: FlattenedTreeNode<TreePanelNode> = {
      node: {
        id: NEW_ITEM_PLACEHOLDER_ID,
        name: "",
        path: NEW_ITEM_PLACEHOLDER_ID,
        type: isFolder ? "directory" : "file",
        expanded: false,
      },
      depth: parentDepth,
    };

    nodes.splice(insertIndex, 0, placeholderNode);
    return nodes;
  }, [baseFlattenedNodes, creatingNew]);

  const handleStartCreateNew = useCallback(
    (parentDir: string, isFolder: boolean) => {
      const parentNode = baseFlattenedNodes.find(
        (node) => node.node.path === parentDir && node.node.type === "directory"
      );
      if (parentNode && !parentNode.node.expanded) {
        onToggleDirectory(parentDir);
      }
      setCreatingNew({ parentDir, isFolder });
      pendingScrollToPlaceholderRef.current = true;
    },
    [baseFlattenedNodes, onToggleDirectory]
  );

  useEffect(() => {
    if (!pendingScrollToPlaceholderRef.current || !creatingNew) return;
    pendingScrollToPlaceholderRef.current = false;

    const placeholderIndex = flattenedNodes.findIndex(
      (node) => node.node.path === NEW_ITEM_PLACEHOLDER_ID
    );

    if (placeholderIndex >= 0 && virtuosoRef.current) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: placeholderIndex,
          align: "center",
          behavior: "smooth",
        });
      });
    }
  }, [creatingNew, flattenedNodes, virtuosoRef]);

  // ── Keyboard handler ─────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    async (event: KeyboardEvent) => {
      if (!selectedPath || renamingPath) return;

      switch (event.key) {
        case "F2":
        case "Enter":
          event.preventDefault();
          setRenamingPath(selectedPath);
          break;
        case "Delete":
        case "Backspace":
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            const fileName = selectedPath.split("/").pop() || "";
            const confirmed = await confirmDestructiveAction({
              title: t("actions.confirmDeleteTitle", { name: fileName }),
              message: t("confirmation.delete"),
              okLabel: t("actions.delete"),
              cancelLabel: t("actions.cancel"),
            });
            if (!confirmed) break;
            dispatch("file.delete", { path: selectedPath }, "user");
          }
          break;
      }
    },
    [selectedPath, renamingPath, dispatch, t]
  );

  return {
    renamingPath,
    creatingNew,
    flattenedNodes,
    handleStartRename,
    handleRenameConfirm,
    handleRenameCancel,
    handleStartCreateNew,
    handleCreateNewConfirm,
    handleCreateNewCancel,
    handleKeyDown,
  };
}

export { NEW_ITEM_PLACEHOLDER_ID };
