import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useRouteAppMode } from "@src/config/routeViewModeConfig";
import { ROUTES } from "@src/config/routes";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  type DockFilter,
  activeHostAtom,
  buildDockFilterPath,
  dockFilterAtom,
} from "@src/store/workstation";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

export interface AppShellDockState {
  visitedModes: Set<string>;
  handleDockClick: (appId: string) => void;
}

export function useAppShellDock(): AppShellDockState {
  const appMode = useRouteAppMode();
  const dockFilter = useAtomValue(dockFilterAtom);
  const setDockFilter = useSetAtom(dockFilterAtom);
  const activeHost = useAtomValue(activeHostAtom);
  const navigate = useNavigate();
  const location = useLocation();
  const setStationMode = useSetAtom(stationModeAtom);
  // When Settings occupies the chat-panel slot we keep the user on the
  // settings route; switching WorkStation apps on the right only updates
  // `dockFilterAtom`, never the React Router location.
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");

  // Seed `visitedModes` with both `"code"` (the fallback host for empty
  // workstation state) AND the active tab's host on first render. Without
  // the eager seed the host pane that owns the active tab mounts one
  // frame late, leaving its 40px header slot null and the global strip
  // visibly blank until the rAF below fires.
  const [visitedModes, setVisitedModes] = useState<Set<string>>(() => {
    const initial = new Set<string>(["code"]);
    try {
      const store = getInstrumentedStore();
      initial.add(store.get(activeHostAtom));
    } catch {
      // Store not yet available in some test environments — fine.
    }
    return initial;
  });

  // Track which hosts we've already enqueued to mount; lets us still use
  // rAF deferral for non-blocking first paint without re-running the
  // effect on every state change (see remix-run loop guidance).
  const enqueuedRef = useRef<Set<string>>(new Set(visitedModes));

  // `eager === true` flips the host synchronously so the keep-alive
  // `<div>` mounts in the same commit that swapped `activeHost`; the rAF
  // path is kept for the route-driven mode change where the user has not
  // yet directly asked for the new host and we want to avoid blocking
  // first paint with extra subtree work.
  const queueVisit = useCallback((host: string, eager: boolean) => {
    if (enqueuedRef.current.has(host)) return;
    enqueuedRef.current.add(host);
    if (eager) {
      setVisitedModes((prev) =>
        prev.has(host) ? prev : new Set([...prev, host])
      );
      return;
    }
    requestAnimationFrame(() => {
      setVisitedModes((prev) =>
        prev.has(host) ? prev : new Set([...prev, host])
      );
    });
  }, []);

  useEffect(() => {
    // queueVisit dedupes via enqueuedRef so this fires at most once per host.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (appMode) queueVisit(appMode, false);
  }, [appMode, queueVisit]);

  // In All Tabs mode the route stays at the bare base path (appMode falls
  // back to "code"), so `activeHost` derived from the active mainPane tab
  // is what the AppShell renders. Mark it visited synchronously so the keep-alive
  // `<div>` for browser/data/project mounts in the same commit and the
  // 40px header strip never flickers blank between tab clicks.
  useEffect(() => {
    if (dockFilter !== "all") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    queueVisit(activeHost, true);
    // Browser is a special case: the unified "+" menu's "New Browser
    // Tab" entry bumps `workstationNewBrowserSessionRequestAtom`, which
    // only does anything once `BrowserLayout` has mounted (it owns the
    // engine state that turns the request into a real session). In All
    // Tabs mode we want that action to work on the very first paint, so
    // pre-mount the Browser host alongside whichever host owns the
    // currently active tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    queueVisit("browser", false);
  }, [dockFilter, activeHost, queueVisit]);

  // Single-host filter modes (`?filter=browser`, legacy sub-routes, …) must
  // eagerly mount the filtered host even when `appMode` still falls back to
  // `"code"` on the bare base path.
  useEffect(() => {
    if (dockFilter === "all") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    queueVisit(dockFilter, true);
  }, [dockFilter, queueVisit]);

  const activeDockId: string = dockFilter === "all" ? "all" : dockFilter;

  const handleDockClick = useCallback(
    (appId: string) => {
      if (appId === activeDockId) {
        setStationMode("my-station");
        return;
      }
      setStationMode("my-station");
      if (appId === "chat") {
        if (!isSettingsRoute) navigate(ROUTES.workStation.chat.path);
        return;
      }
      const nextFilter: DockFilter =
        appId === "all" ? "all" : (appId as DockFilter);
      setDockFilter(nextFilter);
      if (!isSettingsRoute) navigate(buildDockFilterPath(nextFilter));
    },
    [activeDockId, isSettingsRoute, navigate, setDockFilter, setStationMode]
  );

  return { visitedModes, handleDockClick };
}
