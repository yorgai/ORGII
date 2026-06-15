import type { ReactNode } from "react";

import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";

import {
  type PrimarySidebarConfig,
  buildPrimarySidebarConfig,
} from "../WorkStationShell/config";

export type ReplayShellLayoutMode = "left" | "right";

export function resolveReplayShellLayoutMode(
  primarySidebarPosition: ReplayShellLayoutMode
): ReplayShellLayoutMode {
  return primarySidebarPosition === "right" ? "right" : "left";
}

export interface SimulatorReplaySidebarState {
  collapsed: boolean;
  width: number;
  onWidthChange: (width: number) => void;
}

export function buildSimulatorReplayPrimarySidebarConfig(
  content: ReactNode,
  sidebar: SimulatorReplaySidebarState
): PrimarySidebarConfig {
  return buildPrimarySidebarConfig({
    content,
    collapsed: sidebar.collapsed,
    size: sidebar.width,
    onSizeChange: sidebar.onWidthChange,
    minSize: SIMULATOR_PRIMARY_SIDEBAR.minWidth,
    maxSize: SIMULATOR_PRIMARY_SIDEBAR.maxWidth,
    resetSize: SIMULATOR_PRIMARY_SIDEBAR.defaultWidth,
  });
}
