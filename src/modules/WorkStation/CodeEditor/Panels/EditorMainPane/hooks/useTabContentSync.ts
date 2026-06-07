/**
 * useTabContentSync Hook
 *
 * Synchronizes tab state with file content state:
 * - Syncs hasUnsavedChanges between tab and file content
 * - Handles target line navigation (from search results)
 *
 * This hook has no return value - it performs side effects only.
 */
import { useEffect, useRef } from "react";

import { ACTION_ID, useActionSystem } from "@src/ActionSystem";
import type { PanelState } from "@src/store/workstation/tabs";

import type { UseTabContentSyncOptions } from "../types";

// ============================================
// Hook Implementation
// ============================================

export function useTabContentSync(options: UseTabContentSyncOptions): void {
  const {
    activeTab,
    hasUnsavedChanges,
    fileLoading,
    fileContent,
    updatePaneState,
  } = options;

  // ActionSystem dispatch for goToLine
  const { dispatch } = useActionSystem();

  const activeTabId = activeTab?.id;
  const activeTabType = activeTab?.type;
  const tabShowsUnsaved = activeTab?.hasUnsavedChanges === true;

  // ============================================
  // Sync Tab Unsaved Changes State
  // ============================================

  // Keep the active file tab's `hasUnsavedChanges` aligned with useFileContent.
  // Do not gate on a ref vs file state: that can skip updates when the tab row
  // is already wrong (e.g. saved on disk but tab still shows unsaved).
  useEffect(() => {
    if (!activeTabId || activeTabType !== "file") return;
    if (tabShowsUnsaved === hasUnsavedChanges) return;

    updatePaneState((state: PanelState) => {
      const tabs = state?.tabs ?? [];
      const currentActiveTabId = state?.activeTabId ?? null;
      return {
        tabs: tabs.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, hasUnsavedChanges: hasUnsavedChanges }
            : tab
        ),
        activeTabId: currentActiveTabId,
      };
    });
  }, [
    activeTabId,
    activeTabType,
    tabShowsUnsaved,
    hasUnsavedChanges,
    updatePaneState,
  ]);

  // ============================================
  // Target Line Navigation
  // ============================================

  // Navigate to target line when file with targetLine opens
  // This handles search result clicks that need to jump to a specific line
  const targetLine = activeTab?.data?.targetLine as number | undefined;
  const prevTargetLineRef = useRef<{ tabId: string; line: number } | null>(
    null
  );

  useEffect(() => {
    // Skip if no target line, or if file is still loading
    if (!targetLine || !activeTabId || fileLoading) {
      return;
    }

    // Skip if we already navigated to this line for this tab
    if (
      prevTargetLineRef.current?.tabId === activeTabId &&
      prevTargetLineRef.current?.line === targetLine
    ) {
      return;
    }

    // Wait for editor to be ready and content to be loaded
    if (!fileContent) {
      return;
    }

    // Navigate to line with a small delay to ensure editor is rendered
    const timeoutId = setTimeout(() => {
      // Use dispatch instead of direct service call (follows GUI action system)
      dispatch(ACTION_ID.EDITOR_GO_TO_LINE, { line: targetLine }, "user");
      prevTargetLineRef.current = {
        tabId: activeTabId,
        line: targetLine,
      };

      // Clear targetLine from tab data to prevent re-navigation
      updatePaneState((state: PanelState) => {
        const tabs = state?.tabs ?? [];
        const currentActiveTabId = state?.activeTabId ?? null;
        return {
          tabs: tabs.map((tab) =>
            tab.id === activeTabId
              ? {
                  ...tab,
                  data: { ...tab.data, targetLine: undefined },
                }
              : tab
          ),
          activeTabId: currentActiveTabId,
        };
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [
    targetLine,
    activeTabId,
    fileLoading,
    fileContent,
    updatePaneState,
    dispatch,
  ]);
}

export default useTabContentSync;
