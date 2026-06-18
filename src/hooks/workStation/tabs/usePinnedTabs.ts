/**
 * usePinnedTabs — guarantees the (single) main pane has the configured
 * pinned tabs.
 *
 * Pinned tabs (e.g. the Diff tab in the Code Editor) are non-closable
 * fixtures that should always exist in the tab bar. This hook reconciles
 * that invariant declaratively: on mount and on layout change, it inserts
 * any missing pinned tab into `mainPane` and leaves the active tab alone.
 *
 * It is intentionally idempotent — calling it from multiple places is safe.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef } from "react";

import {
  type WorkStationTab,
  mainPaneActiveTabIdAtom,
  mainPaneTabsAtom,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

interface UsePinnedTabsOptions {
  /** Whether to actually run the reconciliation (e.g. only when repo loaded). */
  enabled: boolean;
  /** Tabs to ensure are present in the main pane, in display order. */
  pinnedTabs: WorkStationTab[];
  /** Tab to activate when seeding a fresh pane. Defaults to the first pinned tab. */
  initialActiveTabId?: string;
  /** Whether to switch to the initial tab when the active tab is itself pinned. */
  preferInitialTabWhenActivePinned?: boolean;
}

/**
 * Ensure the main pane contains every tab in `pinnedTabs`. Missing pinned
 * tabs are prepended; existing ones are left where they are.
 */
export function usePinnedTabs({
  enabled,
  pinnedTabs,
  initialActiveTabId,
  preferInitialTabWhenActivePinned = false,
}: UsePinnedTabsOptions) {
  const tabs = useAtomValue(mainPaneTabsAtom);
  const activeTabId = useAtomValue(mainPaneActiveTabIdAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const preferredInitialTabAppliedRef = useRef(false);

  const pinnedKey = useMemo(
    () => pinnedTabs.map((tab) => tab.id).join("|"),
    [pinnedTabs]
  );

  useEffect(() => {
    if (!enabled || pinnedTabs.length === 0) return;

    const pinnedIdSet = new Set(pinnedTabs.map((tab) => tab.id));

    const existingPinnedById = new Map<string, WorkStationTab>();
    const nonPinned: WorkStationTab[] = [];
    for (const tab of tabs) {
      if (pinnedIdSet.has(tab.id)) {
        existingPinnedById.set(tab.id, tab);
      } else {
        nonPinned.push(tab);
      }
    }

    const desiredPinned: WorkStationTab[] = pinnedTabs.map((latest) => {
      const existing = existingPinnedById.get(latest.id);
      if (!existing) return latest;
      if (
        latest.icon === existing.icon &&
        latest.title === existing.title &&
        latest.pinned === existing.pinned &&
        latest.closable === existing.closable &&
        latest.hideWhenOthersExist === existing.hideWhenOthersExist
      ) {
        return existing;
      }
      return { ...existing, ...latest, id: existing.id };
    });

    const currentPinnedSlice = tabs.filter((tab) => pinnedIdSet.has(tab.id));
    const orderChanged =
      currentPinnedSlice.length !== desiredPinned.length ||
      currentPinnedSlice.some(
        (tab, idx: number) => tab.id !== desiredPinned[idx]?.id
      );
    const refreshed = desiredPinned.some(
      (tab, idx: number) => currentPinnedSlice[idx] !== tab
    );

    const shouldPreferInitialTab = Boolean(
      !preferredInitialTabAppliedRef.current &&
      preferInitialTabWhenActivePinned &&
      initialActiveTabId &&
      activeTabId &&
      activeTabId !== initialActiveTabId &&
      pinnedIdSet.has(activeTabId) &&
      tabs.length > 0 &&
      tabs.every((tab) => pinnedIdSet.has(tab.id)) &&
      tabs.some((tab) => tab.id === initialActiveTabId)
    );

    if (!orderChanged && !refreshed && !shouldPreferInitialTab) return;
    if (shouldPreferInitialTab) {
      preferredInitialTabAppliedRef.current = true;
    }

    setLayout((prev) => {
      const nextTabs = [...desiredPinned, ...nonPinned];
      const prevActiveTabId = prev.mainPane?.activeTabId ?? null;
      const hasActiveTab = Boolean(
        prevActiveTabId && nextTabs.some((tab) => tab.id === prevActiveTabId)
      );
      const activePinnedTabIsOnlyPinnedState = shouldPreferInitialTab;
      return {
        ...prev,
        mainPane: {
          tabs: nextTabs,
          activeTabId: activePinnedTabIsOnlyPinnedState
            ? initialActiveTabId
            : hasActiveTab
              ? prevActiveTabId
              : (initialActiveTabId ?? desiredPinned[0]?.id ?? null),
        },
      };
    });
  }, [
    activeTabId,
    enabled,
    initialActiveTabId,
    pinnedKey,
    pinnedTabs,
    preferInitialTabWhenActivePinned,
    setLayout,
    tabs,
  ]);
}
