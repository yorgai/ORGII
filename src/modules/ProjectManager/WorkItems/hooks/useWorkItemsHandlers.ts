/**
 * useWorkItemsHandlers
 *
 * Manages all event handlers for the WorkItem page
 */
import { emit } from "@tauri-apps/api/event";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import type { CalendarEvent } from "@src/features/CalendarView";
import type { GanttTask } from "@src/features/GanttChart";
import type { KanbanTask, TaskStatus } from "@src/features/KanbanBoard";
import { createLogger } from "@src/hooks/logger";
import type { ProjectData } from "@src/modules/ProjectManager/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemStatus,
} from "@src/types/core/workItem";

import type { WorkItemsViewTab } from "../types";

const log = createLogger("WorkItemsHandlers");

const WORK_ITEM_STATUS_TO_FILE: Record<WorkItemStatus, string> = {
  backlog: "backlog",
  planned: "planned",
  in_progress: "in_progress",
  in_review: "in_review",
  completed: "completed",
  cancelled: "cancelled",
  duplicate: "duplicate",
  open: "open",
  closed: "closed",
};

interface UseWorkItemsHandlersParams {
  selectedWorkItemId: string | null;
  showProperties: boolean;
  propertiesWasOpenRef: MutableRefObject<boolean | null>;
  navigation: {
    hasPrev: boolean;
    hasNext: boolean;
    currentIndex: number;
  };
  filteredWorkItems: WorkItemExtended[];
  setSelectedWorkItemId: (id: string | null) => void;
  setShowProperties: (show: boolean | ((prev: boolean) => boolean)) => void;
  setLocalUpdates: Dispatch<
    SetStateAction<Record<string, Partial<WorkItemExtended>>>
  >;
  setActiveTab: (tab: WorkItemsViewTab) => void;
  /** Update work item through the centralized project store */
  updateWorkItemSource: (
    id: string,
    updates: Partial<WorkItemExtended>
  ) => Promise<boolean>;
  // Create work item
  createWorkItemApi: (data: {
    name: string;
    status?: string;
    project_id?: string;
    description?: string;
  }) => Promise<string | null>;
  // Delete work item API
  deleteWorkItemApi: (id: string, shortId?: string) => Promise<void>;
  // Restore work item API
  restoreWorkItemApi: (id: string, shortId?: string) => Promise<void>;
  // Project API update function
  updateProjectApi: (updates: Partial<ProjectData>) => Promise<boolean>;
  // Look up file-mode short ID for delete
  getShortId: (workItemId: string) => string | null;
  // Refresh work items list
  refreshWorkItems: () => Promise<void>;
}

export function useWorkItemsHandlers({
  selectedWorkItemId,
  showProperties,
  propertiesWasOpenRef,
  navigation,
  filteredWorkItems,
  setSelectedWorkItemId,
  setShowProperties,
  setLocalUpdates,
  setActiveTab,
  updateWorkItemSource,
  createWorkItemApi,
  deleteWorkItemApi,
  restoreWorkItemApi,
  updateProjectApi,
  getShortId,
  refreshWorkItems,
}: UseWorkItemsHandlersParams) {
  const { t } = useTranslation("projects");
  const navigate = useNavigate();

  const selectAndCollapseProperties = useCallback(
    (id: string) => {
      if (selectedWorkItemId === null) {
        propertiesWasOpenRef.current = showProperties;
        setShowProperties(false);
      }
      setSelectedWorkItemId(id);
    },
    [
      selectedWorkItemId,
      showProperties,
      propertiesWasOpenRef,
      setShowProperties,
      setSelectedWorkItemId,
    ]
  );

  const handleSelect = selectAndCollapseProperties;

  const handleUpdate = useCallback(
    async (id: string, updates: Partial<WorkItemExtended>) => {
      setLocalUpdates((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));

      await updateWorkItemSource(id, updates);

      setLocalUpdates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setLocalUpdates, updateWorkItemSource]
  );

  const handleNavigate = useCallback(
    (direction: "prev" | "next") => {
      const newIndex =
        direction === "prev"
          ? navigation.currentIndex - 1
          : navigation.currentIndex + 1;
      if (newIndex >= 0 && newIndex < filteredWorkItems.length) {
        setSelectedWorkItemId(filteredWorkItems[newIndex].session_id);
      }
    },
    [navigation.currentIndex, filteredWorkItems, setSelectedWorkItemId]
  );

  const handleProjectsClick = useCallback(() => {
    navigate(ROUTES.workStation.project.path);
  }, [navigate]);

  const handleTabChange = useCallback(
    (tab: WorkItemsViewTab) => {
      setActiveTab(tab);
      // Clear selection when changing tabs
      setSelectedWorkItemId(null);
    },
    [setActiveTab, setSelectedWorkItemId]
  );

  const handleToggleProperties = useCallback(() => {
    setShowProperties((prev) => !prev);
  }, [setShowProperties]);

  const handleKanbanTaskMove = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      handleUpdate(taskId, {
        workItemStatus: newStatus,
      });
    },
    [handleUpdate]
  );

  const createAndSelectItem = useCallback(
    async (fileStatus: string) => {
      const workItemId = await createWorkItemApi({
        name: t("workItems.newWorkItemName"),
        status: fileStatus,
      });

      await emit("orgii-data-changed");
      if (workItemId) {
        selectAndCollapseProperties(workItemId);
      }
    },
    [createWorkItemApi, selectAndCollapseProperties, t]
  );

  const handleAddTask = useCallback(
    async (status: TaskStatus) => {
      await createAndSelectItem(WORK_ITEM_STATUS_TO_FILE[status]);
    },
    [createAndSelectItem]
  );

  const handleAddListItem = useCallback(
    async (status: WorkItemStatus) => {
      await createAndSelectItem(WORK_ITEM_STATUS_TO_FILE[status]);
    },
    [createAndSelectItem]
  );

  // Delete work item
  const handleDelete = useCallback(
    async (workItemId: string) => {
      const shortId = getShortId(workItemId) ?? undefined;
      await deleteWorkItemApi(workItemId, shortId);
      await emit("orgii-data-changed");

      if (selectedWorkItemId === workItemId) {
        setSelectedWorkItemId(null);
      }

      await refreshWorkItems();
    },
    [
      deleteWorkItemApi,
      getShortId,
      selectedWorkItemId,
      setSelectedWorkItemId,
      refreshWorkItems,
    ]
  );

  const handleRestore = useCallback(
    async (workItemId: string) => {
      const shortId = getShortId(workItemId) ?? undefined;
      await restoreWorkItemApi(workItemId, shortId);
      await refreshWorkItems();
    },
    [getShortId, refreshWorkItems, restoreWorkItemApi]
  );

  const handleKanbanTaskClick = useCallback(
    (task: KanbanTask) => selectAndCollapseProperties(task.id),
    [selectAndCollapseProperties]
  );

  const handleGanttTaskClick = useCallback(
    (task: GanttTask) => selectAndCollapseProperties(task.id),
    [selectAndCollapseProperties]
  );

  const handleGanttTaskUpdate = useCallback(
    (taskId: string, updates: { startDate?: Date; endDate?: Date }) => {
      // Update work item dates when task is dragged/resized in Gantt chart
      const dateUpdates: Partial<WorkItemExtended> = {};
      if (updates.startDate) {
        dateUpdates.startDate = updates.startDate.toISOString();
      }
      if (updates.endDate) {
        dateUpdates.endDate = updates.endDate.toISOString();
      }
      handleUpdate(taskId, dateUpdates);
    },
    [handleUpdate]
  );

  const handleCalendarEventClick = useCallback(
    (event: CalendarEvent) => selectAndCollapseProperties(event.id),
    [selectAndCollapseProperties]
  );

  const handleCloseWorkItemDetail = useCallback(() => {
    setSelectedWorkItemId(null);
    // Restore properties panel state if it was open before
    if (propertiesWasOpenRef.current !== null) {
      setShowProperties(propertiesWasOpenRef.current);
      propertiesWasOpenRef.current = null;
    }
  }, [setSelectedWorkItemId, setShowProperties, propertiesWasOpenRef]);

  const handleProjectUpdate = useCallback(
    async (updates: Partial<ProjectData>) => {
      const success = await updateProjectApi(updates);
      if (!success) {
        log.error("[WorkItemsHandlers] Failed to update project");
      }
    },
    [updateProjectApi]
  );

  return {
    handleSelect,
    handleUpdate,
    handleNavigate,
    handleProjectsClick,
    handleTabChange,
    handleToggleProperties,
    handleKanbanTaskMove,
    handleKanbanTaskClick,
    handleAddTask,
    handleAddListItem,
    handleDelete,
    handleRestore,
    handleGanttTaskClick,
    handleGanttTaskUpdate,
    handleCalendarEventClick,
    handleCloseWorkItemDetail,
    handleProjectUpdate,
  };
}
