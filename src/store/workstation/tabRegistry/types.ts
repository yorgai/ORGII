import type { WorkStationTab } from "../tabs/types";

/**
 * One row in the unified tab registry derived from `workstationLayoutAtom`.
 *
 * The workstation has a single tab pool, so entries no longer carry a
 * `paneId` — every tab is in `mainPane`.
 */
export interface TabRegistryEntry {
  tab: WorkStationTab;
  /** True when this is the active tab in the main pane */
  isActive: boolean;
}

export interface TabFocusRequest {
  tabId: string;
}

export type TabCloseRequest = TabFocusRequest;

export interface TabReorderRequest {
  fromTabId: string;
  toTabId: string;
}

export interface TabCloseOtherRequest {
  keepTabId: string;
}
