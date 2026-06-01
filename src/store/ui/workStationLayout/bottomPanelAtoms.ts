import { atom } from "jotai";

import { getStoredValue, setStoredValue } from "./storage";

export const BOTTOM_PANEL_TABS = {
  TERMINAL: "terminal",
  PROBLEMS: "problems",
  OUTPUT: "output",
  TEST_RESULTS: "test-results",
} as const;

export type BottomPanelTab =
  (typeof BOTTOM_PANEL_TABS)[keyof typeof BOTTOM_PANEL_TABS];

export const BOTTOM_PANEL_TAB_ORDER = [
  // Bottom-panel Terminal is intentionally hidden while the standalone Terminal tab is the single source of truth.
  // BOTTOM_PANEL_TABS.TERMINAL,
  BOTTOM_PANEL_TABS.PROBLEMS,
  BOTTOM_PANEL_TABS.OUTPUT,
  BOTTOM_PANEL_TABS.TEST_RESULTS,
] as const;

export const BOTTOM_PANEL_TAB_LABELS: Record<BottomPanelTab, string> = {
  [BOTTOM_PANEL_TABS.TERMINAL]: "tabs.terminal",
  [BOTTOM_PANEL_TABS.PROBLEMS]: "tabs.problems",
  [BOTTOM_PANEL_TABS.OUTPUT]: "tabs.output",
  [BOTTOM_PANEL_TABS.TEST_RESULTS]: "tabs.testResults",
};

function getStoredBottomPanelTab(): BottomPanelTab {
  const stored = getStoredValue("bottom_tab");
  if (
    stored &&
    (BOTTOM_PANEL_TAB_ORDER as readonly string[]).includes(stored)
  ) {
    return stored as BottomPanelTab;
  }
  return BOTTOM_PANEL_TABS.PROBLEMS;
}

export const workStationBottomPanelTabAtom = atom<BottomPanelTab>(
  getStoredBottomPanelTab()
);
workStationBottomPanelTabAtom.debugLabel = "workStationBottomPanelTabAtom";

export const workStationBottomPanelTabPersistAtom = atom(
  (get) => get(workStationBottomPanelTabAtom),
  (_get, set, value: BottomPanelTab) => {
    set(workStationBottomPanelTabAtom, value);
    setStoredValue("bottom_tab", value);
  }
);

function getStoredBottomPanelCollapsed(): boolean {
  const stored = getStoredValue("bottom_collapsed");
  // No stored value means first launch — default to collapsed.
  if (stored === null || stored === undefined) return true;
  return stored === "true";
}

/**
 * Collapsed state of the Code Editor's secondary panel (the one that
 * renders Terminal / Problems / Output / Test Results).
 *
 * Shared across both `right` and `bottom` positions — the panel is the
 * same surface, just oriented differently. Persisted to localStorage so
 * the panel restores to its last state across reloads.
 */
export const workStationEditorSecondaryCollapsedAtom = atom<boolean>(
  getStoredBottomPanelCollapsed()
);
workStationEditorSecondaryCollapsedAtom.debugLabel =
  "workStationEditorSecondaryCollapsedAtom";

export const workStationEditorSecondaryCollapsedPersistAtom = atom(
  (get) => get(workStationEditorSecondaryCollapsedAtom),
  (get, set, value: boolean | "toggle") => {
    const next =
      value === "toggle"
        ? !get(workStationEditorSecondaryCollapsedAtom)
        : value;
    set(workStationEditorSecondaryCollapsedAtom, next);
    setStoredValue("bottom_collapsed", String(next));
  }
);

function getStoredBottomPanelHeight(): number {
  const stored = getStoredValue("bottom_height");
  if (stored) {
    const height = parseInt(stored, 10);
    if (!isNaN(height) && height >= 160 && height <= 600) {
      return height;
    }
  }
  return 250;
}

export const workStationBottomPanelHeightAtom = atom<number>(
  getStoredBottomPanelHeight()
);
workStationBottomPanelHeightAtom.debugLabel =
  "workStationBottomPanelHeightAtom";

export const workStationBottomPanelHeightPersistAtom = atom(
  (get) => get(workStationBottomPanelHeightAtom),
  (_get, set, value: number) => {
    const clampedValue = Math.max(160, Math.min(600, value));
    set(workStationBottomPanelHeightAtom, clampedValue);
    setStoredValue("bottom_height", String(clampedValue));
  }
);

export const workStationBottomPanelMaximizedAtom = atom<boolean>(false);
workStationBottomPanelMaximizedAtom.debugLabel =
  "workStationBottomPanelMaximizedAtom";

function getStoredTerminalSidebarWidth(): number {
  const stored = getStoredValue("terminal_sidebar_width");
  if (stored) {
    const width = parseInt(stored, 10);
    if (!isNaN(width) && width >= 120 && width <= 300) {
      return width;
    }
  }
  return 140;
}

export const workStationTerminalSidebarWidthAtom = atom<number>(
  getStoredTerminalSidebarWidth()
);
workStationTerminalSidebarWidthAtom.debugLabel =
  "workStationTerminalSidebarWidthAtom";

export const workStationTerminalSidebarWidthPersistAtom = atom(
  (get) => get(workStationTerminalSidebarWidthAtom),
  (_get, set, value: number) => {
    const clampedValue = Math.max(120, Math.min(300, value));
    set(workStationTerminalSidebarWidthAtom, clampedValue);
    setStoredValue("terminal_sidebar_width", String(clampedValue));
  }
);
