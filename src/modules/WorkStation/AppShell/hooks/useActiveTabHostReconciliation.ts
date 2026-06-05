/**
 * Keep `mainPane.activeTabId` consistent with the host the user is
 * currently viewing.
 *
 * The workstation runs a single flat tab pool but renders one host
 * surface at a time (Code Editor / Browser / Database / Project Manager
 * / Launchpad). When the user navigates into one of the per-host
 * sub-routes (e.g. `/orgii/workstation/code`) but the globally-active
 * tab still belongs to a different host (a left-over browser session,
 * a stale activeTabId pointing nowhere, …), the surface that just
 * mounted has nothing to show and the tab strip has nothing to
 * highlight — historically this surfaced as the "unknown tab type"
 * placeholder.
 *
 * This hook reconciles that mismatch by switching `activeTabId` to the
 * first existing tab that belongs to the active host (preferring the
 * canonical "blank state" pinned tab for that host, currently Explorer
 * for `"code"`). It runs at the AppShell level so every host benefits
 * from the same invariant without each one re-implementing it.
 *
 * The reconciliation is intentionally guarded by `dockFilter !== "all"`:
 * in All Tabs mode the user actively curates the tab they want to view
 * across hosts, and rewriting `activeTabId` from underneath them would
 * fight their selection.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import {
  dockFilterAtom,
  mainPaneActiveTabIdAtom,
  mainPaneTabsAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import {
  type LegacyPeekHost,
  tabToLegacyHost,
} from "@src/store/workstation/legacyTabHostAdapter";

export function useActiveTabHostReconciliation(
  effectiveHost: LegacyPeekHost | null
): void {
  const dockFilter = useAtomValue(dockFilterAtom);
  const tabs = useAtomValue(mainPaneTabsAtom);
  const activeTabId = useAtomValue(mainPaneActiveTabIdAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const lastActiveTabIdByHostRef = useRef<
    Partial<Record<LegacyPeekHost, string>>
  >({});

  useEffect(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
    const activeHost = activeTab ? tabToLegacyHost(activeTab) : null;
    if (activeTab && activeHost) {
      lastActiveTabIdByHostRef.current[activeHost] = activeTab.id;
    }

    if (!effectiveHost || dockFilter === "all" || tabs.length === 0) return;
    if (activeHost === effectiveHost) return;

    const rememberedTabId = lastActiveTabIdByHostRef.current[effectiveHost];
    const rememberedTarget = rememberedTabId
      ? tabs.find(
          (tab) =>
            tab.id === rememberedTabId && tabToLegacyHost(tab) === effectiveHost
        )
      : null;
    const target =
      rememberedTarget ??
      tabs.find((tab) => tabToLegacyHost(tab) === effectiveHost);
    if (!target || target.id === activeTabId) return;

    lastActiveTabIdByHostRef.current[effectiveHost] = target.id;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout((prev) => {
      if (!prev?.mainPane) return prev;
      if (prev.mainPane.activeTabId === target.id) return prev;
      return {
        ...prev,
        mainPane: { ...prev.mainPane, activeTabId: target.id },
      };
    });
  }, [activeTabId, dockFilter, effectiveHost, setLayout, tabs]);
}
