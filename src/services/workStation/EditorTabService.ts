/**
 * EditorTabService - Singleton editor tab management service.
 *
 * Single-pane workstation: every operation targets
 * `workstationLayoutAtom.mainPane`.
 */
import {
  type PanelState,
  type WorkStationTab,
  closeAllTabs as closeAllTabsHelper,
  closeOtherTabs as closeOtherTabsHelper,
  closeSavedTabs as closeSavedTabsHelper,
  closeTab as closeTabHelper,
  createExplorerTab,
  openTab as openTabHelper,
  reorderTabs as reorderTabsHelper,
  switchTab as switchTabHelper,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const EMPTY_PANE: PanelState = { tabs: [], activeTabId: null };

const getStore = () => getInstrumentedStore();

function getMainPane(): PanelState {
  const store = getStore();
  const layout = store.get(workstationLayoutAtom);
  return layout?.mainPane ?? EMPTY_PANE;
}

function updateMainPane(updater: (state: PanelState) => PanelState): void {
  const store = getStore();
  const layout = store.get(workstationLayoutAtom);
  if (!layout) return;
  store.set(workstationLayoutAtom, {
    ...layout,
    mainPane: updater(layout.mainPane ?? EMPTY_PANE),
  });
}

export const EditorTabService = {
  // Tab Query Operations
  getActiveTab(): WorkStationTab | null {
    const state = getMainPane();
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  },

  getTabs(): WorkStationTab[] {
    return getMainPane().tabs;
  },

  getActiveTabId(): string | null {
    return getMainPane().activeTabId;
  },

  findTab(tabId: string): { tab: WorkStationTab } | null {
    const state = getMainPane();
    const tab = state.tabs.find((paneTab) => paneTab.id === tabId);
    return tab ? { tab } : null;
  },

  hasTab(tabId: string): boolean {
    return this.findTab(tabId) !== null;
  },

  // Tab Close Operations
  closeCurrentTab(): boolean {
    const state = getMainPane();
    if (!state.activeTabId) return false;
    const tabId = state.activeTabId;
    updateMainPane((paneState) => closeTabHelper(paneState, tabId));
    return true;
  },

  closeTab(tabId: string): boolean {
    if (!this.hasTab(tabId)) return false;
    updateMainPane((paneState) => closeTabHelper(paneState, tabId));
    return true;
  },

  closeAllTabs(): boolean {
    updateMainPane(closeAllTabsHelper);
    return true;
  },

  closeOtherTabs(tabId: string): boolean {
    if (!this.hasTab(tabId)) return false;
    updateMainPane((paneState) => closeOtherTabsHelper(paneState, tabId));
    return true;
  },

  closeSavedTabs(): boolean {
    updateMainPane(closeSavedTabsHelper);
    return true;
  },

  // Tab Navigation Operations
  switchToTab(tabId: string): boolean {
    if (!this.hasTab(tabId)) return false;
    updateMainPane((paneState) => switchTabHelper(paneState, tabId));
    return true;
  },

  switchToNextTab(): boolean {
    const state = getMainPane();
    if (state.tabs.length === 0) return false;
    const currentIndex = state.tabs.findIndex(
      (paneTab) => paneTab.id === state.activeTabId
    );
    const nextIndex = (currentIndex + 1) % state.tabs.length;
    const nextTabId = state.tabs[nextIndex]?.id;
    if (!nextTabId) return false;
    updateMainPane((paneState) => switchTabHelper(paneState, nextTabId));
    return true;
  },

  switchToPreviousTab(): boolean {
    const state = getMainPane();
    if (state.tabs.length === 0) return false;
    const currentIndex = state.tabs.findIndex(
      (paneTab) => paneTab.id === state.activeTabId
    );
    const prevIndex =
      currentIndex <= 0 ? state.tabs.length - 1 : currentIndex - 1;
    const prevTabId = state.tabs[prevIndex]?.id;
    if (!prevTabId) return false;
    updateMainPane((paneState) => switchTabHelper(paneState, prevTabId));
    return true;
  },

  getLastFileOrExplorerTabId(): string {
    const tabs = getMainPane().tabs;
    const lastFileTab = [...tabs]
      .reverse()
      .find((paneTab) => paneTab.type === "file" && !paneTab.pinned);
    return lastFileTab?.id ?? createExplorerTab().id;
  },

  switchToLastFileOrExplorer(): string | null {
    const targetTabId = this.getLastFileOrExplorerTabId();
    if (this.switchToTab(targetTabId)) return targetTabId;
    if (targetTabId === createExplorerTab().id) {
      return this.openTab(createExplorerTab()) ? targetTabId : null;
    }
    return null;
  },

  switchToTabByIndex(index: number): boolean {
    const tabs = getMainPane().tabs;
    if (index < 0 || index >= tabs.length) return false;
    const tabId = tabs[index]?.id;
    if (!tabId) return false;
    updateMainPane((paneState) => switchTabHelper(paneState, tabId));
    return true;
  },

  // Tab Open Operations
  openTab(tab: WorkStationTab): boolean {
    updateMainPane((paneState) => openTabHelper(paneState, tab));
    return true;
  },

  // Tab Reorder Operations
  reorderTabs(fromIndex: number, toIndex: number): boolean {
    const tabs = getMainPane().tabs;
    if (fromIndex < 0 || fromIndex >= tabs.length) return false;
    if (toIndex < 0 || toIndex >= tabs.length) return false;
    updateMainPane((paneState) =>
      reorderTabsHelper(paneState, fromIndex, toIndex)
    );
    return true;
  },
};

export default EditorTabService;
