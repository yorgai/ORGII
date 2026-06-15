import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useCallback, useMemo } from "react";

import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";

import type { QuickAction } from "../QuickActionsPanel/types";
import type { PrimarySidebarConfig } from "../WorkStationShell/config";
import {
  type SessionReplayPlaceholderMode,
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "../useSimulatorPlaceholderActions";
import {
  type ReplayShellLayoutMode,
  buildSimulatorReplayPrimarySidebarConfig,
  resolveReplayShellLayoutMode,
} from "./replayShellHelpers";

export interface UseReplayShellOptions {
  mode?: SessionReplayPlaceholderMode;
}

export interface UseReplayShellResult {
  primarySidebarCollapsed: boolean;
  primarySidebarPosition: ReplayShellLayoutMode;
  primarySidebarWidth: number;
  layoutMode: ReplayShellLayoutMode;
  handlePrimarySidebarWidthChange: (width: number) => void;
  createPrimarySidebarConfig: (content: ReactNode) => PrimarySidebarConfig;
  placeholderActions: QuickAction[];
  awaitingAgentCaption: string;
}

export function useReplayShell(
  options: UseReplayShellOptions = {}
): UseReplayShellResult {
  const { mode = "simulation" } = options;

  const primarySidebarCollapsed = useAtomValue(
    simulatorPrimarySidebarCollapsedAtom
  );
  const primarySidebarPosition = useAtomValue(
    simulatorPrimarySidebarPositionAtom
  );
  const primarySidebarWidth = useAtomValue(simulatorPrimarySidebarWidthAtom);
  const setPrimarySidebarWidthPersist = useSetAtom(
    simulatorPrimarySidebarWidthPersistAtom
  );

  const handlePrimarySidebarWidthChange = useCallback(
    (width: number) => {
      setPrimarySidebarWidthPersist(width);
    },
    [setPrimarySidebarWidthPersist]
  );

  const layoutMode = useMemo(
    () => resolveReplayShellLayoutMode(primarySidebarPosition),
    [primarySidebarPosition]
  );

  const placeholderActions = useSimulatorPlaceholderActions(mode);
  const awaitingAgentCaption = useSimulatorAwaitingAgentCaption();

  const createPrimarySidebarConfig = useCallback(
    (content: ReactNode) =>
      buildSimulatorReplayPrimarySidebarConfig(content, {
        collapsed: primarySidebarCollapsed,
        width: primarySidebarWidth,
        onWidthChange: handlePrimarySidebarWidthChange,
      }),
    [
      primarySidebarCollapsed,
      primarySidebarWidth,
      handlePrimarySidebarWidthChange,
    ]
  );

  return {
    primarySidebarCollapsed,
    primarySidebarPosition,
    primarySidebarWidth,
    layoutMode,
    handlePrimarySidebarWidthChange,
    createPrimarySidebarConfig,
    placeholderActions,
    awaitingAgentCaption,
  };
}
