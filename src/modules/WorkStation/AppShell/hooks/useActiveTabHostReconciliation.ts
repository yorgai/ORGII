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
import { useEffect } from "react";

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

/**
 * Per-host preferred "blank state" tab type. When reconciliation needs
 * to pick a code-host tab and Explorer exists, pick Explorer; otherwise
 * fall back to the first tab whose host matches.
 */
const PREFERRED_BLANK_TAB_TYPE_BY_HOST: Partial<
  Record<LegacyPeekHost, string>
> = {
  code: "explorer",
};

export function useActiveTabHostReconciliation(
  effectiveHost: LegacyPeekHost | null
): void {
  const dockFilter = useAtomValue(dockFilterAtom);
  const tabs = useAtomValue(mainPaneTabsAtom);
  const activeTabId = useAtomValue(mainPaneActiveTabIdAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);

  useEffect(() => {
    if (!effectiveHost || dockFilter === "all" || tabs.length === 0) return;

    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
    const activeHost = activeTab ? tabToLegacyHost(activeTab) : null;
    if (activeHost === effectiveHost) return;

    const preferredType = PREFERRED_BLANK_TAB_TYPE_BY_HOST[effectiveHost];
    const target =
      (preferredType ? tabs.find((tab) => tab.type === preferredType) : null) ??
      tabs.find((tab) => tabToLegacyHost(tab) === effectiveHost);
    if (!target || target.id === activeTabId) return;

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
