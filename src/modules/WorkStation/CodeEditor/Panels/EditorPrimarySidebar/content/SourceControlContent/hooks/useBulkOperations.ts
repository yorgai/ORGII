/**
 * Hook for handling bulk file operations with multi-select support
 *
 * Provides:
 * - Bulk stage/unstage/discard operations
 * - Multi-select aware file selection and toggle
 */
import { type MouseEvent, useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { GitFile } from "@src/types/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

export interface UseBulkOperationsOptions {
  selectedFileIds: Set<string>;
  getSelectedFiles: () => GitFile[];
  clearSelection: () => void;
  onStageToggle?: (fileId: string, stage: boolean) => Promise<void>;
  onDiscard?: (fileId: string) => Promise<void>;
  onFileSelect: (fileId: string) => void;
  handleFileClick: (fileId: string, event?: MouseEvent) => void;
  navigateWithoutSelecting?: boolean;
}

export interface UseBulkOperationsResult {
  handleBulkStage: () => Promise<void>;
  handleBulkUnstage: () => Promise<void>;
  handleBulkDiscard: () => Promise<void>;
  handleFileSelectWithMultiSelect: (fileId: string, event?: MouseEvent) => void;
  handleStageToggleWithMultiSelect: (
    fileId: string,
    stage: boolean
  ) => Promise<void>;
  handleDiscardWithMultiSelect: (fileId: string) => Promise<void>;
}

export function useBulkOperations(
  options: UseBulkOperationsOptions
): UseBulkOperationsResult {
  const { t } = useTranslation();
  const {
    selectedFileIds,
    getSelectedFiles,
    clearSelection,
    onStageToggle,
    onDiscard,
    onFileSelect,
    handleFileClick,
    navigateWithoutSelecting = false,
  } = options;

  // Handle bulk stage
  const handleBulkStage = useCallback(async () => {
    const selected = getSelectedFiles();
    const toStage = selected.filter((file) => !file.staged);
    if (toStage.length > 0 && onStageToggle) {
      await Promise.all(toStage.map((file) => onStageToggle(file.id, true)));
      clearSelection();
      showGitActionDialogSafely(`Staged ${toStage.length} file(s)`, "info");
    }
  }, [getSelectedFiles, onStageToggle, clearSelection]);

  // Handle bulk unstage
  const handleBulkUnstage = useCallback(async () => {
    const selected = getSelectedFiles();
    const toUnstage = selected.filter((file) => file.staged);
    if (toUnstage.length > 0 && onStageToggle) {
      await Promise.all(toUnstage.map((file) => onStageToggle(file.id, false)));
      clearSelection();
      showGitActionDialogSafely(`Unstaged ${toUnstage.length} file(s)`, "info");
    }
  }, [getSelectedFiles, onStageToggle, clearSelection]);

  // Handle bulk discard with confirmation
  const handleBulkDiscard = useCallback(async () => {
    const selected = getSelectedFiles();
    if (selected.length > 0 && onDiscard) {
      const fileCount = selected.length;
      const fileText = fileCount === 1 ? "1 file" : `${fileCount} files`;
      const shouldDiscard = await confirmDestructiveAction({
        title: t("workstation.discardChanges"),
        message: t("workstation.discardChangesConfirm", { files: fileText }),
        okLabel: t("workstation.discardChanges"),
        cancelLabel: t("actions.cancel"),
      });

      if (shouldDiscard) {
        await Promise.all(selected.map((file) => onDiscard(file.id)));
        clearSelection();
        showGitActionDialogSafely(
          `Discarded ${selected.length} file(s)`,
          "info"
        );
      }
    }
  }, [getSelectedFiles, onDiscard, clearSelection, t]);

  // Handle file selection with multi-select support
  const handleFileSelectWithMultiSelect = useCallback(
    (fileId: string, event?: MouseEvent) => {
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) {
        // Multi-select mode
        handleFileClick(fileId, event);
      } else {
        onFileSelect(fileId);
        if (!navigateWithoutSelecting) {
          handleFileClick(fileId, event);
        }
      }
    },
    [onFileSelect, handleFileClick, navigateWithoutSelecting]
  );

  // Wrap stage toggle to handle multi-selection
  const handleStageToggleWithMultiSelect = useCallback(
    async (fileId: string, stage: boolean) => {
      if (!onStageToggle) return;

      // Check if this file is part of a multi-selection
      if (selectedFileIds.size > 1 && selectedFileIds.has(fileId)) {
        // Apply to all selected files
        const selected = getSelectedFiles();
        await Promise.all(
          selected.map((file) => onStageToggle(file.id, stage))
        );
        clearSelection();
        showGitActionDialogSafely(
          `${stage ? "Staged" : "Unstaged"} ${selected.length} file(s)`,
          "info"
        );
      } else {
        // Single file operation
        await onStageToggle(fileId, stage);
      }
    },
    [onStageToggle, selectedFileIds, getSelectedFiles, clearSelection]
  );

  // Wrap discard to handle multi-selection
  const handleDiscardWithMultiSelect = useCallback(
    async (fileId: string) => {
      if (!onDiscard) return;

      // Check if this file is part of a multi-selection
      if (selectedFileIds.size > 1 && selectedFileIds.has(fileId)) {
        // Apply to all selected files with confirmation
        await handleBulkDiscard();
      } else {
        // Single file operation
        await onDiscard(fileId);
      }
    },
    [onDiscard, selectedFileIds, handleBulkDiscard]
  );

  return {
    handleBulkStage,
    handleBulkUnstage,
    handleBulkDiscard,
    handleFileSelectWithMultiSelect,
    handleStageToggleWithMultiSelect,
    handleDiscardWithMultiSelect,
  };
}
