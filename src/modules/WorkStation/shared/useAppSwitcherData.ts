/**
 * App switcher data hooks
 *
 * Each hook returns the props needed to render an {@link AppSwitcherChip} for
 * one product surface:
 * - {@link useWorkStationAppSwitcher} — My Station (route-driven app modes)
 * - {@link useSimulatorAppSwitcher}   — Agent Station (dock-driven apps)
 *
 * View component lives in `AppSwitcherChip.tsx`. Data + view are split so the
 * chip can render identically in either product without any conditional
 * branching at the view layer.
 */
import { useAtomValue, useSetAtom } from "jotai";
import {
  Code,
  Database,
  Globe,
  Layers,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppModeType } from "@src/config/routeViewModeConfig";
import { ROUTES } from "@src/config/routes";
import { replayModeAtom } from "@src/engines/SessionCore";
import {
  DOCK_APPS,
  getSimulatorDockTitleCenter,
} from "@src/engines/Simulator/components/Dock";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/GeneralLayoutTour";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  simulatorEffectiveDockAppAtom,
  simulatorSelectedAppAtom,
} from "@src/store/ui/simulatorAtom";
import {
  type DockFilter,
  buildDockFilterPath,
  dockFilterAtom,
} from "@src/store/workstation";

import type { AppSwitcherMenuItem } from "./AppSwitcherDropdownPanel";

// Sentinel id for the "All Tabs" entry. Not a real `AppModeType` — it
// represents the bare workstation base path where `dockFilterAtom === "all"`
// surfaces every host's tabs in one bar.
const ALL_TABS_ID = "all" as const;

function getWorkStationTourTarget(id: string): string | undefined {
  switch (id) {
    case ALL_TABS_ID:
      return GENERAL_LAYOUT_TOUR_TARGETS.dockAllTabs;
    case "code":
      return GENERAL_LAYOUT_TOUR_TARGETS.dockCodeEditor;
    case "browser":
      return GENERAL_LAYOUT_TOUR_TARGETS.dockBrowser;
    case "project":
      return GENERAL_LAYOUT_TOUR_TARGETS.dockProjects;
    default:
      return undefined;
  }
}

// ============================================
// My Station (route-driven)
// ============================================

interface AppModeEntry {
  /** `AppModeType` for the real per-host modes, or {@link ALL_TABS_ID}. */
  id: AppModeType | typeof ALL_TABS_ID;
  icon: LucideIcon;
  i18nKey: string;
}

const APP_MODES: AppModeEntry[] = [
  {
    id: ALL_TABS_ID,
    icon: Layers,
    i18nKey: "navigation:workstation.dockFilter.all",
  },
  { id: "code", icon: Code, i18nKey: "navigation:labels.codeEditor" },
  { id: "browser", icon: Globe, i18nKey: "navigation:labels.browser" },
  {
    id: "data",
    icon: Database,
    i18nKey: "navigation:labels.databaseManager",
  },
  {
    id: "project",
    icon: ListTodo,
    i18nKey: "navigation:labels.projectManager",
  },
];

export interface AppSwitcherChipData {
  icon: LucideIcon;
  label: string;
  activeId: string;
  items: AppSwitcherMenuItem[];
  onSelect: (id: string) => void;
}

export interface UseWorkStationAppSwitcherOptions {
  /**
   * Static label + icon override. When provided the chip displays these
   * values and the dropdown is suppressed (e.g. Control Tower's grouped rail
   * has no Workstation route picker).
   */
  staticLabel?: { label: string; icon: LucideIcon };
}

export function useWorkStationAppSwitcher(
  options: UseWorkStationAppSwitcherOptions = {}
): AppSwitcherChipData {
  const { staticLabel } = options;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dockFilter = useAtomValue(dockFilterAtom);
  const setDockFilter = useSetAtom(dockFilterAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  // See `useAppShellDock` — on Settings routes the WorkStation pane lives
  // alongside the settings slot, and switching apps must not navigate.
  const isSettingsRoute = location.pathname.startsWith("/orgii/app/settings");

  // On the bare workstation base path `appMode` falls back to `"code"` for
  // legacy reasons, but the user is semantically in "All Tabs" — the chip
  // must reflect that, not the fallback. `dockFilterAtom` is the single
  // source of truth (see `useDockFilterUrlSync`).
  const activeId: string = dockFilter === "all" ? ALL_TABS_ID : dockFilter;

  const currentMode = useMemo(
    () => APP_MODES.find((mode) => mode.id === activeId) ?? APP_MODES[0],
    [activeId]
  );

  const items = useMemo<AppSwitcherMenuItem[]>(
    () =>
      staticLabel
        ? []
        : APP_MODES.map((mode) => ({
            id: mode.id,
            icon: mode.icon,
            label: t(mode.i18nKey),
            tourTarget: getWorkStationTourTarget(mode.id),
          })),
    [staticLabel, t]
  );

  const onSelect = useCallback(
    (modeId: string) => {
      const nextFilter: DockFilter =
        modeId === ALL_TABS_ID ? "all" : (modeId as DockFilter);
      if (nextFilter === dockFilter) return;
      setStationMode("my-station");
      setDockFilter(nextFilter);
      // Stay on the bare base path with `?filter=` — rematching a per-host
      // sub-route while Source Control / Terminal subtrees suspend can stall
      // React Router's location update entirely.
      if (!isSettingsRoute) navigate(buildDockFilterPath(nextFilter));
    },
    [dockFilter, isSettingsRoute, navigate, setDockFilter, setStationMode]
  );

  return {
    icon: staticLabel?.icon ?? currentMode.icon,
    label: staticLabel?.label ?? t(currentMode.i18nKey),
    activeId,
    items,
    onSelect,
  };
}

// ============================================
// Agent Station (dock-driven)
// ============================================

export function useSimulatorAppSwitcher(): AppSwitcherChipData {
  const { t: tNav } = useTranslation("navigation");
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);
  const setSelectedApp = useSetAtom(simulatorSelectedAppAtom);
  const setReplayMode = useSetAtom(replayModeAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const navigate = useNavigate();

  const titleCenter = useMemo(
    () => getSimulatorDockTitleCenter(effectiveDockApp, tNav),
    [effectiveDockApp, tNav]
  );

  const items = useMemo<AppSwitcherMenuItem[]>(
    () =>
      DOCK_APPS.map((app) => {
        const tc = getSimulatorDockTitleCenter(app.id as AppType, tNav);
        return {
          id: app.id,
          icon: tc.icon ?? app.icon,
          label: tc.label,
        };
      }),
    [tNav]
  );

  const onSelect = useCallback(
    (appId: string) => {
      // Browser in Agent Station switches to My Station Browser (real webview).
      // The Simulator Browser is session-replay only and has no live webview.
      if (appId === AppType.BROWSER) {
        setStationMode("my-station");
        navigate(ROUTES.workStation.browser.path);
        return;
      }
      setSelectedApp(appId as AppType);
      setReplayMode("replay");
    },
    [setReplayMode, setSelectedApp, setStationMode, navigate]
  );

  return {
    icon: titleCenter.icon ?? Code,
    label: titleCenter.label ?? "",
    activeId: effectiveDockApp ?? "",
    items,
    onSelect,
  };
}
