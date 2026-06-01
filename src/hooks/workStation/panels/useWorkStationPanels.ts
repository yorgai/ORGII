/**
 * useWorkStationPanels Hook
 *
 * React bindings for panel state management.
 * Core actions delegate to PanelService (singleton).
 *
 * Shared by: CodeEditor, DatabaseManager, Browser
 *
 * - Uses useAtomValue for read-only subscriptions (no setter = no extra closure)
 * - Uses useSetAtom for write-only operations (no re-render on value change)
 * - This prevents unnecessary re-renders when unrelated panel state changes
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  type BottomPanelTab,
  type LayoutMode,
  type PrimarySidebarTabKey,
  workStationBottomPanelHeightAtom,
  workStationBottomPanelHeightPersistAtom,
  workStationBottomPanelMaximizedAtom,
  workStationBottomPanelTabAtom,
  workStationBottomPanelTabPersistAtom,
  workStationDevToolsCollapsedAtom,
  workStationDevToolsCollapsedPersistAtom,
  workStationEditorSecondaryCollapsedAtom,
  workStationEditorSecondaryCollapsedPersistAtom,
  workStationLayoutModeAtom,
  workStationLayoutModePersistAtom,
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
  workStationPrimarySidebarTabAtom,
  workStationPrimarySidebarWidthAtom,
  workStationPrimarySidebarWidthPersistAtom,
  workStationTerminalSidebarWidthAtom,
  workStationTerminalSidebarWidthPersistAtom,
} from "@src/store/ui/workStationAtom";

export interface UseWorkStationPanelsReturn {
  // Layout mode
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  toggleLayoutMode: () => void;

  // Primary sidebar (one rail, visually left or right via CSS swap)
  primarySidebarTab: PrimarySidebarTabKey;
  setPrimarySidebarTab: (tab: PrimarySidebarTabKey) => void;
  primarySidebarCollapsed: boolean;
  setPrimarySidebarCollapsed: (collapsed: boolean) => void;
  togglePrimarySidebar: () => void;
  closePrimarySidebar: () => void;
  primarySidebarWidth: number;
  setPrimarySidebarWidth: (width: number) => void;

  // Bottom panel
  bottomPanelTab: BottomPanelTab;
  setBottomPanelTab: (tab: BottomPanelTab) => void;
  bottomPanelCollapsed: boolean;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  toggleBottomPanel: () => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (height: number) => void;
  bottomPanelMaximized: boolean;
  setBottomPanelMaximized: (maximized: boolean) => void;
  toggleBottomPanelMaximize: () => void;

  // Terminal sidebar (in bottom panel)
  terminalSidebarWidth: number;
  setTerminalSidebarWidth: (width: number) => void;

  // Browser DevTools panel
  devToolsCollapsed: boolean;
  setDevToolsCollapsed: (collapsed: boolean) => void;
  toggleDevTools: () => void;
}

export function useWorkStationPanels(): UseWorkStationPanelsReturn {
  // PERFORMANCE: Use useAtomValue for read-only (subscribes to base atom only)
  // Use useSetAtom for write-only (no subscription, no re-render on change)

  const layoutMode = useAtomValue(workStationLayoutModeAtom);
  const setLayoutModePersist = useSetAtom(workStationLayoutModePersistAtom);

  // Primary sidebar — one atom regardless of left/right layout mode.
  const primarySidebarTab = useAtomValue(workStationPrimarySidebarTabAtom);
  const setPrimarySidebarTab = useSetAtom(workStationPrimarySidebarTabAtom);
  const primarySidebarCollapsed = useAtomValue(
    workStationPrimarySidebarCollapsedAtom
  );
  const setPrimarySidebarCollapsedPersist = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );
  const primarySidebarWidth = useAtomValue(workStationPrimarySidebarWidthAtom);
  const setPrimarySidebarWidthPersist = useSetAtom(
    workStationPrimarySidebarWidthPersistAtom
  );

  // Bottom panel
  const bottomPanelTab = useAtomValue(workStationBottomPanelTabAtom);
  const setBottomPanelTabPersist = useSetAtom(
    workStationBottomPanelTabPersistAtom
  );
  const bottomPanelCollapsed = useAtomValue(
    workStationEditorSecondaryCollapsedAtom
  );
  const setBottomPanelCollapsedPersist = useSetAtom(
    workStationEditorSecondaryCollapsedPersistAtom
  );
  const bottomPanelHeight = useAtomValue(workStationBottomPanelHeightAtom);
  const setBottomPanelHeightPersist = useSetAtom(
    workStationBottomPanelHeightPersistAtom
  );
  const [bottomPanelMaximized, setBottomPanelMaximized] = useAtom(
    workStationBottomPanelMaximizedAtom
  );

  const terminalSidebarWidth = useAtomValue(
    workStationTerminalSidebarWidthAtom
  );
  const setTerminalSidebarWidthPersist = useSetAtom(
    workStationTerminalSidebarWidthPersistAtom
  );

  const devToolsCollapsed = useAtomValue(workStationDevToolsCollapsedAtom);
  const setDevToolsCollapsedPersist = useSetAtom(
    workStationDevToolsCollapsedPersistAtom
  );

  const toggleLayoutMode = useCallback(() => {
    setLayoutModePersist(layoutMode === "left" ? "right" : "left");
  }, [layoutMode, setLayoutModePersist]);

  const togglePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsedPersist(!primarySidebarCollapsed);
  }, [primarySidebarCollapsed, setPrimarySidebarCollapsedPersist]);

  const closePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsedPersist(true);
  }, [setPrimarySidebarCollapsedPersist]);

  const toggleBottomPanel = useCallback(() => {
    if (bottomPanelMaximized) {
      setBottomPanelMaximized(false);
    }
    setBottomPanelCollapsedPersist(!bottomPanelCollapsed);
  }, [
    bottomPanelCollapsed,
    bottomPanelMaximized,
    setBottomPanelCollapsedPersist,
    setBottomPanelMaximized,
  ]);

  const toggleBottomPanelMaximize = useCallback(() => {
    setBottomPanelMaximized(!bottomPanelMaximized);
  }, [bottomPanelMaximized, setBottomPanelMaximized]);

  const toggleDevTools = useCallback(() => {
    setDevToolsCollapsedPersist(!devToolsCollapsed);
  }, [devToolsCollapsed, setDevToolsCollapsedPersist]);

  return {
    layoutMode,
    setLayoutMode: setLayoutModePersist,
    toggleLayoutMode,

    primarySidebarTab,
    setPrimarySidebarTab,
    primarySidebarCollapsed,
    setPrimarySidebarCollapsed: setPrimarySidebarCollapsedPersist,
    togglePrimarySidebar,
    closePrimarySidebar,
    primarySidebarWidth,
    setPrimarySidebarWidth: setPrimarySidebarWidthPersist,

    bottomPanelTab,
    setBottomPanelTab: setBottomPanelTabPersist,
    bottomPanelCollapsed,
    setBottomPanelCollapsed: setBottomPanelCollapsedPersist,
    toggleBottomPanel,
    bottomPanelHeight,
    setBottomPanelHeight: setBottomPanelHeightPersist,
    bottomPanelMaximized,
    setBottomPanelMaximized,
    toggleBottomPanelMaximize,

    terminalSidebarWidth,
    setTerminalSidebarWidth: setTerminalSidebarWidthPersist,

    devToolsCollapsed,
    setDevToolsCollapsed: setDevToolsCollapsedPersist,
    toggleDevTools,
  };
}

// ============================================
// Focused Hooks for Better Performance
// ============================================

/**
 * Hook for primary sidebar state. Use this instead of
 * `useWorkStationPanels` when you only need the primary sidebar.
 */
export function usePrimarySidebarState() {
  const layoutMode = useAtomValue(workStationLayoutModeAtom);
  const primarySidebarCollapsed = useAtomValue(
    workStationPrimarySidebarCollapsedAtom
  );
  const primarySidebarWidth = useAtomValue(workStationPrimarySidebarWidthAtom);
  const setPrimarySidebarWidth = useSetAtom(
    workStationPrimarySidebarWidthPersistAtom
  );
  const setPrimarySidebarCollapsed = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );

  const togglePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsed("toggle");
  }, [setPrimarySidebarCollapsed]);

  const closePrimarySidebar = useCallback(() => {
    setPrimarySidebarCollapsed(true);
  }, [setPrimarySidebarCollapsed]);

  return {
    layoutMode,
    primarySidebarCollapsed,
    primarySidebarWidth,
    setPrimarySidebarWidth,
    setPrimarySidebarCollapsed,
    togglePrimarySidebar,
    closePrimarySidebar,
  };
}

/**
 * Hook for bottom panel state only.
 * Use this instead of useWorkStationPanels when you only need bottom panel.
 */
export function useBottomPanelState() {
  const bottomPanelTab = useAtomValue(workStationBottomPanelTabAtom);
  const setBottomPanelTab = useSetAtom(workStationBottomPanelTabPersistAtom);
  const bottomPanelCollapsed = useAtomValue(
    workStationEditorSecondaryCollapsedAtom
  );
  const setBottomPanelCollapsed = useSetAtom(
    workStationEditorSecondaryCollapsedPersistAtom
  );
  const bottomPanelHeight = useAtomValue(workStationBottomPanelHeightAtom);
  const setBottomPanelHeight = useSetAtom(
    workStationBottomPanelHeightPersistAtom
  );
  const [bottomPanelMaximized, setBottomPanelMaximized] = useAtom(
    workStationBottomPanelMaximizedAtom
  );

  const toggleBottomPanel = useCallback(() => {
    if (bottomPanelMaximized) {
      setBottomPanelMaximized(false);
    }
    setBottomPanelCollapsed(!bottomPanelCollapsed);
  }, [
    bottomPanelCollapsed,
    bottomPanelMaximized,
    setBottomPanelCollapsed,
    setBottomPanelMaximized,
  ]);

  const toggleBottomPanelMaximize = useCallback(() => {
    setBottomPanelMaximized(!bottomPanelMaximized);
  }, [bottomPanelMaximized, setBottomPanelMaximized]);

  return {
    bottomPanelTab,
    setBottomPanelTab,
    bottomPanelCollapsed,
    setBottomPanelCollapsed,
    toggleBottomPanel,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelMaximized,
    setBottomPanelMaximized,
    toggleBottomPanelMaximize,
  };
}
