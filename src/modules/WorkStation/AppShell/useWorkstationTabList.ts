/**
 * useWorkstationTabList
 *
 * Derives the ordered, filtered list of tabs to render in
 * WorkstationTabBar and computes the active tab key.
 *
 * Logic summary
 * - Reads `tabRegistryAtom` and filters by the current `dockFilterAtom`.
 * - Strips "blank state" fixture tabs when any real file tab is open
 *   in the same host bucket.
 * - Pins pinned tabs first; regular tabs follow in registry order.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import { useCloseTabWithGuard } from "@src/hooks/workStation/tabs/useCloseTabWithGuard";
import { useFocusTab } from "@src/hooks/workStation/tabs/useFocusTab";
import {
  closeOtherTabsAtom,
  closeSavedTabsAtom,
  dockFilterAtom,
  reorderTabAtom,
  tabRegistryAtom,
} from "@src/store/workstation";
import type { DockFilter } from "@src/store/workstation";
import {
  type WorkstationTabHost,
  tabToHost,
} from "@src/store/workstation/tabHost";
import type { WorkStationTab } from "@src/store/workstation/tabs";

function dockFilterToHost(filter: DockFilter): WorkstationTabHost | null {
  switch (filter) {
    case "all":
      return null;
    case "code":
      return "code";
    case "browser":
      return "browser";
    case "data":
      return "data";
    case "project":
      return "project";
  }
}

export interface UseWorkstationTabListReturn {
  tabsForBar: WorkStationTab[];
  activeKey: string | null;
  dockFilter: DockFilter;
  isAllTabsView: boolean;
  visible: ReturnType<typeof useAtomValue<typeof tabRegistryAtom>>;
  handleTabClick: (tabId: string) => void;
  handleTabReorder: (startIndex: number, endIndex: number) => void;
  handleTabClose: (tabId: string) => void;
  handleCloseOther: (tabId: string) => void;
  handleCloseSaved: () => void;
}

export function useWorkstationTabList(): UseWorkstationTabListReturn {
  const entries = useAtomValue(tabRegistryAtom);
  const dockFilter = useAtomValue(dockFilterAtom);
  const focusWorkstationTab = useFocusTab();
  const closeTab = useCloseTabWithGuard();
  const reorderTab = useSetAtom(reorderTabAtom);
  const closeOtherTabs = useSetAtom(closeOtherTabsAtom);
  const closeSavedTabs = useSetAtom(closeSavedTabsAtom);

  const isAllTabsView = dockFilter === "all";
  const hostFilter = dockFilterToHost(dockFilter);

  const visible = useMemo(() => {
    if (dockFilter === "all") return entries;
    if (!hostFilter) return [];
    return entries.filter((entry) => tabToHost(entry.tab) === hostFilter);
  }, [dockFilter, entries, hostFilter]);

  const realTabHostSet = useMemo(() => {
    const set = new Set<WorkstationTabHost>();
    for (const entry of visible) {
      if (entry.tab.type === "file" && !entry.tab.pinned) {
        set.add(tabToHost(entry.tab));
      }
    }
    return set;
  }, [visible]);

  const { tabsForBar, activeKey } = useMemo(() => {
    const filteredVisible = visible.filter((entry) => {
      if (!entry.tab.hideWhenOthersExist) return true;
      return !realTabHostSet.has(tabToHost(entry.tab));
    });

    const pinned: WorkStationTab[] = [];
    const regular: WorkStationTab[] = [];
    for (const entry of filteredVisible) {
      if (entry.tab.pinned) {
        pinned.push(entry.tab);
      } else {
        regular.push(entry.tab);
      }
    }
    const ordered: WorkStationTab[] = [...pinned, ...regular];
    const active = visible.find((entry) => entry.isActive);
    return { tabsForBar: ordered, activeKey: active ? active.tab.id : null };
  }, [visible, realTabHostSet]);

  const handleTabClick = useCallback(
    (tabId: string) => {
      focusWorkstationTab({ tabId });
    },
    [focusWorkstationTab]
  );

  const handleTabReorder = useCallback(
    (startIndex: number, endIndex: number) => {
      const fromTab = tabsForBar[startIndex];
      const toTab = tabsForBar[endIndex];
      if (!fromTab || !toTab || fromTab.pinned || toTab.pinned) return;
      reorderTab({ fromTabId: fromTab.id, toTabId: toTab.id });
    },
    [reorderTab, tabsForBar]
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      void closeTab({ tabId });
    },
    [closeTab]
  );

  const handleCloseOther = useCallback(
    (tabId: string) => {
      closeOtherTabs({ keepTabId: tabId });
    },
    [closeOtherTabs]
  );

  const handleCloseSaved = useCallback(() => {
    closeSavedTabs();
  }, [closeSavedTabs]);

  return {
    tabsForBar,
    activeKey,
    dockFilter,
    isAllTabsView,
    visible,
    handleTabClick,
    handleTabReorder,
    handleTabClose,
    handleCloseOther,
    handleCloseSaved,
  };
}
