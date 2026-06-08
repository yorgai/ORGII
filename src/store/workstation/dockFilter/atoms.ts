/**
 * Workstation dock filter atom.
 *
 * The "dock" is the cluster of icons at the bottom-center of the workstation
 * shell. Historically each icon navigated to a per-host sub-route
 * (`/orgii/workstation/code`, `/orgii/workstation/browser`, ...). In the
 * unified workstation surface the dock instead chooses *which subset of
 * tabs* the unified tab strip shows; selecting "All Tabs" shows every tab.
 *
 * Phase 1 only introduces the atom and its type. Phase 2 wires it into the
 * dock click handler and adds the `?filter=` URL sync. The legacy
 * sub-routes stay live as syntactic sugar — visiting
 * `/orgii/workstation/code` writes `"code"` into this atom on mount.
 *
 * `"all"` is the unfiltered view; everything else corresponds to a
 * `WorkStationTabCategory` slice.
 */
import { atom } from "jotai";

import { type WorkstationTabHost, tabToHost } from "../tabHost";
import { activeWorkStationTabAtom } from "../tabs";

/**
 * Discriminant for the dock filter chip group.
 *
 * Members map 1:1 to the dock icon segments in
 * `MY_STATION_DOCK_SEGMENTS` (`AppShell/index.tsx`) plus the new `"all"`
 * sentinel that disables filtering entirely.
 */
export type DockFilter = "all" | "code" | "browser" | "data" | "project";

export const DEFAULT_DOCK_FILTER: DockFilter = "all";

/**
 * The currently-selected dock filter for the workstation surface.
 *
 * Default is `"all"` so that opening the bare `/orgii/workstation` URL
 * lands the user in the unified all-tabs view. Sub-route URLs override
 * this on mount via a Phase 2 effect.
 */
export const dockFilterAtom = atom<DockFilter>(DEFAULT_DOCK_FILTER);

/**
 * The host whose content the AppShell should mount when the user is in
 * "All Tabs" mode. Derived from the active tab's type so that clicking a
 * tab in the unified bar swaps the content area without leaving All Tabs
 * (no route navigation needed).
 *
 * Outside "All Tabs" the route is the source of truth; consumers should
 * branch on `dockFilterAtom === "all"` before reading this atom.
 */
export const activeHostAtom = atom<WorkstationTabHost>((get) => {
  const activeTab = get(activeWorkStationTabAtom);
  return activeTab ? tabToHost(activeTab) : "code";
});
activeHostAtom.debugLabel = "activeHostAtom";
