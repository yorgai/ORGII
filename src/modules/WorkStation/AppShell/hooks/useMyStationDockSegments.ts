import { Code, Database, Globe, Layers, ListTodo } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DockAppItem } from "@src/engines/Simulator/components/Dock";

const STATIC_MY_STATION_DOCK_ICONS = {
  all: Layers,
  code: Code,
  browser: Globe,
  data: Database,
  project: ListTodo,
} as const;

export function useMyStationDockSegments(): DockAppItem[][] {
  const { t: tNav } = useTranslation("navigation");

  return useMemo<DockAppItem[][]>(
    () => [
      [
        {
          id: "all",
          name: tNav("workstation.dockFilter.all"),
          icon: STATIC_MY_STATION_DOCK_ICONS.all,
        },
      ],
      [
        {
          id: "code",
          name: tNav("workstation.dockFilter.code"),
          icon: STATIC_MY_STATION_DOCK_ICONS.code,
        },
        {
          id: "browser",
          name: tNav("workstation.dockFilter.browser"),
          icon: STATIC_MY_STATION_DOCK_ICONS.browser,
        },
        {
          id: "data",
          name: tNav("workstation.dockFilter.data"),
          icon: STATIC_MY_STATION_DOCK_ICONS.data,
        },
        {
          id: "project",
          name: tNav("workstation.dockFilter.project"),
          icon: STATIC_MY_STATION_DOCK_ICONS.project,
        },
      ],
    ],
    [tNav]
  );
}
