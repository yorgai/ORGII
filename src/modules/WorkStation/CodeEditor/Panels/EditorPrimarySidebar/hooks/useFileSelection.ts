/**
 * Hook for managing file selection with multi-select support
 *
 * Supports:
 * - Single click: Select one file
 * - Cmd/Ctrl + Click: Toggle selection
 * - Shift + Click: Range selection
 * - Cmd/Ctrl + A: Select all
 */
import { type MouseEvent, useCallback, useState } from "react";

import type { GitFile } from "@src/types/git/types";

export interface UseFileSelectionOptions {
  /** All files in the list (in display order) */
  files: GitFile[];
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

export interface UseFileSelectionResult {
  /** Currently selected file IDs */
  selectedFileIds: Set<string>;
  /** Last clicked file ID (for range selection) */
  lastSelectedId: string | null;
  /** Handle file click with multi-select support */
  handleFileClick: (fileId: string, event?: MouseEvent) => void;
  /** Select all files */
  selectAll: () => void;
  /** Clear selection */
  clearSelection: () => void;
  /** Check if a file is selected */
  isFileSelected: (fileId: string) => boolean;
  /** Get selected files */
  getSelectedFiles: () => GitFile[];
}

export function useFileSelection(
  options: UseFileSelectionOptions
): UseFileSelectionResult {
  const { files, onSelectionChange } = options;

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    new Set()
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Handle file click with multi-select support
  const handleFileClick = useCallback(
    (fileId: string, event?: MouseEvent) => {
      const isMod = Boolean(event?.metaKey || event?.ctrlKey);
      const isShift = Boolean(event?.shiftKey);

      // Use functional update to avoid stale closure issues
      setSelectedFileIds((prevSelection) => {
        let newSelection: Set<string>;

        if (isMod) {
          // Cmd/Ctrl + Click - Toggle selection
          newSelection = new Set(prevSelection);
          if (newSelection.has(fileId)) {
            newSelection.delete(fileId);
          } else {
            newSelection.add(fileId);
          }
          setLastSelectedId(fileId);
        } else if (isShift && lastSelectedId) {
          // Shift + Click - Range selection
          const fileIds = files.map((file) => file.id);
          const startIdx = fileIds.indexOf(lastSelectedId);
          const endIdx = fileIds.indexOf(fileId);

          if (startIdx !== -1 && endIdx !== -1) {
            const [start, end] =
              startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            const rangeIds = fileIds.slice(start, end + 1);
            newSelection = new Set(rangeIds);
          } else {
            newSelection = new Set([fileId]);
          }
          // Don't update lastSelectedId on shift-click
        } else {
          // Normal click - Single selection
          newSelection = new Set([fileId]);
          setLastSelectedId(fileId);
        }

        if (onSelectionChange) {
          onSelectionChange(newSelection);
        }

        return newSelection;
      });
    },
    [files, lastSelectedId, onSelectionChange]
  );

  // Select all files
  const selectAll = useCallback(() => {
    const allIds = new Set(files.map((file) => file.id));
    setSelectedFileIds(allIds);
    if (onSelectionChange) {
      onSelectionChange(allIds);
    }
  }, [files, onSelectionChange]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedFileIds(new Set());
    setLastSelectedId(null);
    if (onSelectionChange) {
      onSelectionChange(new Set());
    }
  }, [onSelectionChange]);

  // Check if file is selected
  const isFileSelected = useCallback(
    (fileId: string) => selectedFileIds.has(fileId),
    [selectedFileIds]
  );

  // Get selected files
  const getSelectedFiles = useCallback(() => {
    return files.filter((file) => selectedFileIds.has(file.id));
  }, [files, selectedFileIds]);

  return {
    selectedFileIds,
    lastSelectedId,
    handleFileClick,
    selectAll,
    clearSelection,
    isFileSelected,
    getSelectedFiles,
  };
}
