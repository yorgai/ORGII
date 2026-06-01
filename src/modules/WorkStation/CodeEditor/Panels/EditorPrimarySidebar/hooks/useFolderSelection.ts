/**
 * useFolderSelection Hook
 *
 * Manages folder selection state in the file explorer.
 * Folders don't open in tabs, so they need separate local tracking.
 * Selection is invalidated when the active file changes (tab switch).
 *
 * Also provides the combined "effective selected path" and the
 * handleSelectNode callback for the tree.
 *
 * Extracted from EditorPrimarySidebar.
 */
import { type MutableRefObject, useCallback, useRef, useState } from "react";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";

export interface UseFolderSelectionOptions {
  /** The active file path from the editor tab (source of truth) */
  selectedFilePath: string | null;
  /** Callback when a file is selected */
  onFileSelect: (path: string) => void;
}

export interface UseFolderSelectionResult {
  /** The effective selected path (folder or file) for tree highlight */
  effectiveSelectedPath: string | null;
  /** The explicitly selected folder path (null if stale) */
  selectedFolderPath: string | null;
  /** Handle node selection in the tree */
  handleSelectNode: (path: string, node: TreePanelNode) => void;
  /** Ref to track explorer clicks (skip reveal when click came from explorer) */
  explorerClickPathRef: MutableRefObject<string | null>;
}

export function useFolderSelection({
  selectedFilePath,
  onFileSelect,
}: UseFolderSelectionOptions): UseFolderSelectionResult {
  // Local state for selected folder (folders don't open in tabs)
  // Store the file context to detect when folder selection becomes stale
  const [folderSelection, setFolderSelection] = useState<{
    folderPath: string;
    whenFilePath: string | null;
  } | null>(null);

  // PERFORMANCE: Track explorer clicks to skip unnecessary reveal operations
  const explorerClickPathRef = useRef<string | null>(null);

  // Folder selection is only valid if the file context hasn't changed (no tab switch)
  const selectedFolderPath =
    folderSelection?.whenFilePath === selectedFilePath
      ? folderSelection.folderPath
      : null;

  // Combined selection: file takes precedence, folder used for tree highlight
  const effectiveSelectedPath = selectedFolderPath ?? selectedFilePath;

  const handleSelectNode = useCallback(
    (path: string, node: TreePanelNode) => {
      if (node.type === "file") {
        // Mark this as an explorer click to skip reveal
        explorerClickPathRef.current = path;
        // Clear folder selection when file is selected
        setFolderSelection(null);
        onFileSelect(path);
      } else {
        // Directory selected - track locally with current file context
        setFolderSelection({
          folderPath: path,
          whenFilePath: selectedFilePath,
        });
      }
    },
    [onFileSelect, selectedFilePath]
  );

  return {
    effectiveSelectedPath,
    selectedFolderPath,
    handleSelectNode,
    explorerClickPathRef,
  };
}
