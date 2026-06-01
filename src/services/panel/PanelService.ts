/**
 * PanelService - Singleton Panel Management Service
 *
 * Provides panel visibility and tab management shared by both AI and UI.
 * Uses persist atoms for localStorage sync.
 *
 * Usage:
 *   import { PanelService } from "@src/services/panel";
 *   PanelService.showPrimarySidebar("testing");
 */
import {
  type BottomPanelTab,
  type PrimarySidebarTabKey,
  workStationBottomPanelMaximizedAtom,
  workStationBottomPanelTabPersistAtom,
  workStationEditorSecondaryCollapsedAtom,
  workStationEditorSecondaryCollapsedPersistAtom,
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
  workStationPrimarySidebarTabAtom,
} from "@src/store/ui/workStationAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const getStore = () => getInstrumentedStore();

export const PanelService = {
  // ==========================================
  // Primary sidebar
  // ==========================================

  /**
   * Show a specific primary sidebar tab. Expands the sidebar if collapsed.
   */
  showPrimarySidebar(tab: PrimarySidebarTabKey): void {
    const store = getStore();
    store.set(workStationPrimarySidebarTabAtom, tab);
    if (store.get(workStationPrimarySidebarCollapsedAtom)) {
      store.set(workStationPrimarySidebarCollapsedPersistAtom, false);
    }
  },

  /**
   * Toggle primary sidebar visibility (persisted).
   */
  togglePrimarySidebar(): void {
    getStore().set(workStationPrimarySidebarCollapsedPersistAtom, "toggle");
  },

  // ==========================================
  // Bottom Panel
  // ==========================================

  /**
   * Show a specific bottom panel tab. Expands the panel if collapsed.
   */
  showBottomPanel(tab: BottomPanelTab): void {
    const store = getStore();
    store.set(workStationBottomPanelTabPersistAtom, tab);
    if (store.get(workStationEditorSecondaryCollapsedAtom)) {
      store.set(workStationEditorSecondaryCollapsedPersistAtom, false);
    }
  },

  /**
   * Toggle bottom panel visibility (persisted). Exits maximize if active.
   */
  toggleBottomPanel(): void {
    const store = getStore();
    if (store.get(workStationBottomPanelMaximizedAtom)) {
      store.set(workStationBottomPanelMaximizedAtom, false);
    }
    store.set(workStationEditorSecondaryCollapsedPersistAtom, "toggle");
  },
};

export default PanelService;
