/**
 * AppModeSwitch Component
 *
 * A three-option switch for toggling between Code Editor, Browser, and Database Explorer
 * modes. Uses SegmentedSwitchToolbar with shared SwitchButton component.
 *
 * Features:
 * - Route-based navigation (deep-linkable URLs)
 * - Reuses SwitchButton from ViewModeSwitch for consistency
 * - Height: 36px with 4px padding
 * - Border radius: 100px (fully rounded)
 * - Selected state uses primary color fill
 *
 * Placement: Right of repo/branch selector in GlobalToolbar
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Code, Database, Globe, ListTodo, MonitorDot } from "lucide-react";
import React, { startTransition, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  type AppModeType,
  useRouteAppMode,
} from "@src/config/routeViewModeConfig";
import { ROUTES } from "@src/config/routes";
import { replayModeAtom } from "@src/engines/SessionCore";
import {
  APP_TYPE_PROJECT,
  AppType,
} from "@src/engines/Simulator/types/appTypes";
import {
  simulatorEffectiveDockAppAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

import SegmentedSwitchToolbar from "../SegmentedSwitchToolbar";
import { SwitchButton } from "../SwitchButton";

// ============================================
// Types
// ============================================

export type AppMode =
  | "code"
  | "data"
  | "browser"
  | "chat"
  | "project"
  | "tasks"
  | "other";

export interface AppModeSwitchProps {
  /** Additional className for the container */
  className?: string;
}

// ============================================
// Route mapping
// ============================================

type RoutableAppMode = Exclude<AppMode, "tasks" | "other">;

const APP_MODE_ROUTES: Record<RoutableAppMode, string> = {
  code: ROUTES.workStation.code.path,
  data: ROUTES.workStation.database.path,
  browser: ROUTES.workStation.browser.path,
  chat: ROUTES.workStation.chat.path,
  project: ROUTES.workStation.project.path,
};

// ============================================
// Component
// ============================================

function resolveAppMode(routeMode: AppModeType): AppMode {
  switch (routeMode) {
    case "code":
    case "data":
    case "browser":
    case "chat":
    case "project":
      return routeMode;
    case "kanban":
      return "other";
    default: {
      const _exhaustive: never = routeMode;
      return _exhaustive;
    }
  }
}

/** Maps simulator AppType to the corresponding toolbar AppMode */
function simulatorAppToMode(appType: AppType | null): AppMode {
  switch (appType) {
    case AppType.CODE_EDITOR:
      return "code";
    case AppType.BROWSER:
      return "browser";
    case AppType.DB_MANAGER:
      return "data";
    case APP_TYPE_PROJECT:
      return "project";
    case AppType.BACKGROUND_TASKS:
      return "tasks";
    default:
      return "other";
  }
}

/** Maps toolbar AppMode to the default simulator AppType for that mode */
function modeToSimulatorApp(mode: AppMode): AppType {
  switch (mode) {
    case "code":
      return AppType.CODE_EDITOR;
    case "browser":
      return AppType.BROWSER;
    case "data":
      return AppType.DB_MANAGER;
    case "project":
      return APP_TYPE_PROJECT;
    case "tasks":
      return AppType.BACKGROUND_TASKS;
    case "chat":
    case "other":
      return AppType.CHANNELS;
  }
  const _exhaustive: never = mode;
  return _exhaustive;
}

export const AppModeSwitch: React.FC<AppModeSwitchProps> = ({
  className = "",
}) => {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const routeMode = useRouteAppMode();
  const stationMode = useAtomValue(stationModeAtom);
  const effectiveDockApp = useAtomValue(simulatorEffectiveDockAppAtom);
  const setSelectedSimApp = useSetAtom(simulatorSelectedAppAtom);
  const setReplayMode = useSetAtom(replayModeAtom);
  const isAgentStation = stationMode === "agent-station";

  const currentMode = useMemo((): AppMode => {
    if (isAgentStation) {
      return simulatorAppToMode(effectiveDockApp);
    }
    return resolveAppMode(routeMode);
  }, [isAgentStation, effectiveDockApp, routeMode]);

  const handleModeChange = useCallback(
    (mode: AppMode) => {
      if (mode === currentMode) return;

      if (isAgentStation) {
        setSelectedSimApp(modeToSimulatorApp(mode));
        setReplayMode("replay");
        return;
      }

      if (mode === "tasks" || mode === "other") return;

      startTransition(() => {
        navigate(APP_MODE_ROUTES[mode]);
      });
    },
    [navigate, currentMode, isAgentStation, setSelectedSimApp, setReplayMode]
  );

  return (
    <SegmentedSwitchToolbar className={className}>
      <SwitchButton
        key="code"
        icon={Code}
        onClick={() => handleModeChange("code")}
        title={t("labels.codeEditor")}
        selected={currentMode === "code"}
      />
      <SwitchButton
        key="browser"
        icon={Globe}
        onClick={() => handleModeChange("browser")}
        title={t("labels.browser")}
        selected={currentMode === "browser"}
      />
      <SwitchButton
        key="data"
        icon={Database}
        onClick={() => handleModeChange("data")}
        title={t("labels.databaseManager")}
        selected={currentMode === "data"}
      />
      <SwitchButton
        key="project"
        icon={ListTodo}
        onClick={() => handleModeChange("project")}
        title={t("labels.projectManager")}
        selected={currentMode === "project"}
      />
      {isAgentStation && (
        <SwitchButton
          key="other"
          icon={MonitorDot}
          onClick={() => handleModeChange("other")}
          title={t("labels.other")}
          selected={currentMode === "other"}
        />
      )}
    </SegmentedSwitchToolbar>
  );
};

export default AppModeSwitch;
