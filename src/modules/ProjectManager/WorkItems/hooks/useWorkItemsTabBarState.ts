import { useEffect, useMemo } from "react";

import { useProjectManagerWorkItemsTabBarRegistration } from "@src/modules/ProjectManager/hooks/useProjectManagerWorkItemsTabBarRegistration";
import type {
  WorkItem as WorkItemExtended,
  WorkItemStatus,
} from "@src/types/core/workItem";

import { WORK_ITEMS_DEFAULT_STATUS, type WorkItemsViewTab } from "../types";

export interface EmbeddedWorkItemParentChrome {
  title: string;
  icon: string;
}

export type EmbeddedWorkItemDetailState =
  | { view: "project"; parentChrome?: EmbeddedWorkItemParentChrome }
  | { view: "workItemDetail"; workItemName?: string };

interface UseWorkItemsTabBarStateParams {
  activeTab: WorkItemsViewTab;
  showProperties: boolean;
  isActive: boolean;
  workStationTabId?: string;
  projectId: string;
  projectName: string;
  resolvedProjectSlug: string | null;
  selectedWorkItem?: WorkItemExtended | null;
  onOpenSearch: () => void;
  onToggleProperties: () => void;
  onCreateWorkItem?: (
    projectId: string,
    projectName: string,
    projectSlug: string
  ) => void;
  onAddListItem: (status: WorkItemStatus) => void;
  onEmbeddedWorkItemDetailStateChange?: (
    tabId: string,
    state: EmbeddedWorkItemDetailState
  ) => void;
}

function shouldShowProjectPropertiesAction(
  activeTab: WorkItemsViewTab,
  isDetailOpen: boolean
) {
  return !isDetailOpen && activeTab !== "Settings";
}

export function useWorkItemsTabBarState({
  activeTab,
  showProperties,
  isActive,
  workStationTabId,
  projectId,
  projectName,
  resolvedProjectSlug,
  selectedWorkItem,
  onOpenSearch,
  onToggleProperties,
  onCreateWorkItem,
  onAddListItem,
  onEmbeddedWorkItemDetailStateChange,
}: UseWorkItemsTabBarStateParams) {
  const isDetailOpen = !!selectedWorkItem;
  const actionsInStationTabBar = workStationTabId !== undefined;
  const propertiesActionAvailable = shouldShowProjectPropertiesAction(
    activeTab,
    isDetailOpen
  );

  useEffect(() => {
    if (!onEmbeddedWorkItemDetailStateChange || !workStationTabId) return;

    if (selectedWorkItem) {
      onEmbeddedWorkItemDetailStateChange(workStationTabId, {
        view: "workItemDetail",
        workItemName: selectedWorkItem.name,
      });
      return;
    }

    onEmbeddedWorkItemDetailStateChange(workStationTabId, { view: "project" });
  }, [selectedWorkItem, onEmbeddedWorkItemDetailStateChange, workStationTabId]);

  const onAddWorkItemHandler = useMemo(() => {
    if (activeTab === "Settings") return null;

    if (onCreateWorkItem) {
      return () =>
        onCreateWorkItem(
          projectId,
          projectName,
          resolvedProjectSlug ?? projectId
        );
    }

    return () => onAddListItem(WORK_ITEMS_DEFAULT_STATUS);
  }, [
    activeTab,
    onAddListItem,
    onCreateWorkItem,
    resolvedProjectSlug,
    projectId,
    projectName,
  ]);

  useProjectManagerWorkItemsTabBarRegistration({
    workStationTabId,
    enabled: isActive,
    showPropertiesActive: propertiesActionAvailable ? showProperties : false,
    onSearch: activeTab !== "Settings" ? onOpenSearch : null,
    onRefresh: null,
    refreshLoading: false,
    onToggleProperties: propertiesActionAvailable ? onToggleProperties : null,
    onAddProject: null,
    onAddWorkItem: onAddWorkItemHandler,
  });

  return {
    actionsInStationTabBar,
    isDetailOpen,
    propertiesActionAvailable,
  };
}
