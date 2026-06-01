/**
 * Workstation Tabs Jotai Atoms
 *
 * Single source of truth for every workstation tab. There is exactly one
 * pane (`mainPane`) — every tab across Code Editor / Browser / Database /
 * Project Manager / Launchpad lives in the same flat pool.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import { LAYOUT_STORAGE_KEY, debouncedLayoutStorage } from "./storage";
import type { PanelState, WorkStationLayoutState } from "./types";

const EMPTY_PANEL: PanelState = { tabs: [], activeTabId: null };

const initialLayout: WorkStationLayoutState = {
  mainPane: EMPTY_PANEL,
};

/**
 * Main workstation layout atom — single tab pool.
 *
 * PERFORMANCE: uses debounced storage to prevent localStorage from
 * blocking the main thread on every keystroke / tab switch.
 */
export const workstationLayoutAtom = atomWithStorage<WorkStationLayoutState>(
  LAYOUT_STORAGE_KEY,
  initialLayout,
  debouncedLayoutStorage
);
workstationLayoutAtom.debugLabel = "workstationLayoutAtom";

/**
 * Convenience read of the (only) pane's state.
 */
export const mainPaneStateAtom = atom((get) => {
  const layout = get(workstationLayoutAtom);
  return layout?.mainPane ?? EMPTY_PANEL;
});
mainPaneStateAtom.debugLabel = "mainPaneStateAtom";

/**
 * Active tab in the main pane (derived).
 */
export const activeWorkStationTabAtom = atom((get) => {
  const state = get(mainPaneStateAtom);
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
});
activeWorkStationTabAtom.debugLabel = "activeWorkStationTabAtom";

/**
 * Tab scroll-reveal request atom.
 *
 * Incremented (via `requestTabScrollRevealAtom`) every time a file-select
 * opens or re-activates a tab. The `version` always changes even when
 * `tabId` is the same (re-selecting an already-active tab), so TabBar's
 * `useAutoScrollToActive` effect fires and can scroll the tab into view.
 */
export const tabScrollRevealAtom = atom<{ tabId: string; version: number }>({
  tabId: "",
  version: 0,
});
tabScrollRevealAtom.debugLabel = "tabScrollRevealAtom";

/**
 * Write-only atom to request a tab scroll-reveal.
 * Call with the tab's id; the version counter is auto-incremented.
 */
export const requestTabScrollRevealAtom = atom(
  null,
  (get, set, tabId: string) => {
    const prev = get(tabScrollRevealAtom);
    set(tabScrollRevealAtom, { tabId, version: prev.version + 1 });
  }
);
requestTabScrollRevealAtom.debugLabel = "requestTabScrollRevealAtom";

/**
 * Active file path of the active tab (derived). Returns `null` unless
 * the active tab is a file-shaped tab carrying `data.filePath`.
 */
export const activeWorkStationFilePathAtom = atom((get) => {
  const activeTab = get(activeWorkStationTabAtom);
  if (!activeTab) return null;

  if (activeTab.type === "file" && activeTab.data.filePath) {
    return activeTab.data.filePath as string;
  }
  if (activeTab.type === "git-diff" && activeTab.data.filePath) {
    return activeTab.data.filePath as string;
  }
  return null;
});
activeWorkStationFilePathAtom.debugLabel = "activeWorkStationFilePathAtom";
