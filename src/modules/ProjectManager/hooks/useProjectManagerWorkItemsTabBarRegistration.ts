import { useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type ProjectManagerWorkItemsTabBarPayload,
  projectManagerWorkItemsTabBarAtom,
} from "@src/modules/ProjectManager/store/projectManagerWorkItemsTabBarAtom";

type ProjectManagerWorkItemsTabBarControls = Omit<
  ProjectManagerWorkItemsTabBarPayload,
  "workStationTabId" | "onAddProject"
> & {
  onAddProject?: (() => void) | null;
};

interface UseProjectManagerWorkItemsTabBarRegistrationParams extends ProjectManagerWorkItemsTabBarControls {
  workStationTabId?: string;
  enabled?: boolean;
}

export function useProjectManagerWorkItemsTabBarRegistration({
  workStationTabId,
  enabled = true,
  showPropertiesActive,
  onSearch,
  onRefresh,
  refreshLoading,
  onToggleProperties,
  onAddProject,
  onAddWorkItem,
}: UseProjectManagerWorkItemsTabBarRegistrationParams) {
  const setWorkItemsTabBarPayload = useSetAtom(
    projectManagerWorkItemsTabBarAtom
  );

  useEffect(() => {
    if (!workStationTabId) return;

    if (!enabled) {
      setWorkItemsTabBarPayload((prev) =>
        prev?.workStationTabId === workStationTabId ? null : prev
      );
      return;
    }

    setWorkItemsTabBarPayload({
      workStationTabId,
      showPropertiesActive,
      onSearch,
      onRefresh,
      refreshLoading,
      onToggleProperties,
      onAddProject: onAddProject ?? null,
      onAddWorkItem,
    });

    return () => {
      setWorkItemsTabBarPayload((prev) =>
        prev?.workStationTabId === workStationTabId ? null : prev
      );
    };
  }, [
    enabled,
    onAddProject,
    onAddWorkItem,
    onRefresh,
    onSearch,
    onToggleProperties,
    refreshLoading,
    setWorkItemsTabBarPayload,
    showPropertiesActive,
    workStationTabId,
  ]);
}
