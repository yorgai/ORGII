import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type StatusBarAppType,
  activeStatusBarAppAtom,
} from "@src/store/ui/workStationAtom";
import { type DockFilter, activeHostAtom } from "@src/store/workstation";

import { useActiveTabHostReconciliation } from "./useActiveTabHostReconciliation";

export interface AppShellDerivedState {
  effectiveHost: string;
  isCodeMode: boolean;
  isDataMode: boolean;
  isBrowserMode: boolean;
  isProjectMode: boolean;
  codeContentVisible: boolean;
  browserContentVisible: boolean;
  dataContentVisible: boolean;
  projectContentVisible: boolean;
}

function isWorkStationHost(host: string): host is Exclude<DockFilter, "all"> {
  return (
    host === "code" ||
    host === "browser" ||
    host === "data" ||
    host === "project"
  );
}

export function useAppShellDerivedState({
  dockFilter,
  isKanbanStation,
  opsControlPeekHost,
}: {
  dockFilter: DockFilter;
  isKanbanStation: boolean;
  opsControlPeekHost: "code" | "browser" | "data" | "project" | null;
}): AppShellDerivedState {
  const activeHost = useAtomValue(activeHostAtom);
  const effectiveHost = dockFilter === "all" ? activeHost : dockFilter;

  useActiveTabHostReconciliation(
    isWorkStationHost(effectiveHost) ? effectiveHost : null
  );

  const isCodeMode = effectiveHost === "code";
  const isDataMode = effectiveHost === "data";
  const isBrowserMode = effectiveHost === "browser";
  const isProjectMode = effectiveHost === "project";

  const codeContentVisible = isCodeMode || opsControlPeekHost === "code";
  const browserContentVisible = isBrowserMode;
  const dataContentVisible = isDataMode;
  const projectContentVisible = isProjectMode;

  const setActiveStatusBarApp = useSetAtom(activeStatusBarAppAtom);
  useEffect(() => {
    let appType: StatusBarAppType;
    if (isKanbanStation && opsControlPeekHost !== null) {
      appType = opsControlPeekHost;
    } else if (effectiveHost === "browser") {
      appType = "browser";
    } else if (effectiveHost === "data") {
      appType = "data";
    } else if (effectiveHost === "project") {
      appType = "project";
    } else {
      appType = "code";
    }
    setActiveStatusBarApp(appType);
  }, [
    effectiveHost,
    isKanbanStation,
    opsControlPeekHost,
    setActiveStatusBarApp,
  ]);

  return {
    effectiveHost,
    isCodeMode,
    isDataMode,
    isBrowserMode,
    isProjectMode,
    codeContentVisible,
    browserContentVisible,
    dataContentVisible,
    projectContentVisible,
  };
}
