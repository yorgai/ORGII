/**
 * Hook for Source Control keyboard shortcuts
 *
 * Implements VS Code-style keyboard shortcuts for git operations:
 * - Cmd/Ctrl + Enter: Commit changes
 * - Cmd/Ctrl + K: Stage All
 * - Cmd/Ctrl + Shift + K: Unstage All
 * - Cmd/Ctrl + R: Refresh git status
 * - Space: Stage/unstage selected file
 * - Enter: Open diff for selected file
 * - Delete/Backspace: Discard selected file (with confirmation)
 */
import { useEffect } from "react";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

export interface UseSourceControlShortcutsOptions {
  /** Callback to commit changes */
  onCommit: () => void;
  /** Callback to stage all files */
  onStageAll?: () => void;
  /** Callback to unstage all files */
  onUnstageAll?: () => void;
  /** Callback to refresh git status */
  onRefresh?: () => void;
  /** Callback to stage/unstage selected file */
  onToggleStageSelected?: () => void;
  /** Callback to open diff for selected file */
  onOpenSelected?: () => void;
  /** Callback to discard selected file */
  onDiscardSelected?: () => void;
  /** Whether commit action is currently allowed */
  canCommit: boolean;
  /** Whether there are selected files */
  hasSelection: boolean;
  /** Whether the panel is currently focused/active */
  isActive: boolean;
}

export function useSourceControlShortcuts(
  options: UseSourceControlShortcutsOptions
) {
  const {
    onCommit,
    onStageAll,
    onUnstageAll,
    onRefresh,
    onToggleStageSelected,
    onOpenSelected,
    onDiscardSelected,
    canCommit,
    hasSelection,
    isActive,
  } = options;

  useEffect(() => {
    // Only listen to shortcuts when panel is active
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keyboard events during IME composition
      if (e.isComposing) return;

      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target;

      // Check if target is an editable element (input, textarea, or contenteditable)
      // Also check for CodeMirror editor elements and XTerm terminal
      const isEditableElement =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.getAttribute("contenteditable") === "true" ||
          target.closest(".cm-editor") !== null ||
          target.closest(".cm-content") !== null ||
          target.closest('[contenteditable="true"]') !== null ||
          target.closest(".xterm") !== null);

      // Cmd/Ctrl + Enter - Commit
      if (isMod && e.key === "Enter" && canCommit) {
        e.preventDefault();
        onCommit();
        return;
      }

      // Cmd/Ctrl + K - Stage All
      if (isMod && !e.shiftKey && e.key === "k") {
        e.preventDefault();
        if (onStageAll) onStageAll();
        return;
      }

      // Cmd/Ctrl + Shift + K - Unstage All
      if (isMod && e.shiftKey && e.key === "K") {
        e.preventDefault();
        if (onUnstageAll) onUnstageAll();
        return;
      }

      // Cmd/Ctrl + R - Refresh
      if (isMod && e.key === "r") {
        e.preventDefault();
        if (onRefresh) onRefresh();
        return;
      }

      // Don't handle file-specific shortcuts if no selection
      if (!hasSelection) return;

      // Don't intercept Space/Enter/Backspace when user is typing in an editable element
      if (isEditableElement) return;

      // Space - Stage/unstage selected file
      if (e.key === " " && !isMod) {
        e.preventDefault();
        if (onToggleStageSelected) onToggleStageSelected();
        return;
      }

      // Enter - Open diff for selected file
      if (e.key === "Enter" && !isMod) {
        e.preventDefault();
        if (onOpenSelected) onOpenSelected();
        return;
      }

      // Delete/Backspace - Discard selected file
      if ((e.key === "Delete" || e.key === "Backspace") && !isMod) {
        e.preventDefault();
        if (onDiscardSelected) onDiscardSelected();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isActive,
    canCommit,
    hasSelection,
    onCommit,
    onStageAll,
    onUnstageAll,
    onRefresh,
    onToggleStageSelected,
    onOpenSelected,
    onDiscardSelected,
  ]);
}

/**
 * Keyboard shortcuts reference for tooltips.
 * Values are looked up from the centralized shortcut catalog.
 */
export const SHORTCUTS = {
  commit: getShortcutKeys("git_commit"),
  stageAll: getShortcutKeys("git_stage_all"),
  unstageAll: getShortcutKeys("git_unstage_all"),
  refresh: getShortcutKeys("git_refresh"),
  toggleStage: getShortcutKeys("git_toggle_stage"),
  openDiff: getShortcutKeys("git_open_diff"),
  discard: getShortcutKeys("git_discard"),
} as const;
