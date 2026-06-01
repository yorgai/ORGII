import type { StatusCounts } from "@src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader";
import { WORK_ITEM_STATUS_OPTIONS } from "@src/modules/ProjectManager/config/manage";
import type { DropdownOption } from "@src/types/core/shared";
import type { WorkItem, WorkItemStatus } from "@src/types/core/workItem";

import {
  FILTER_TO_STATUS,
  STATUS_FILTER_KEYS,
  WORK_ITEMS_DEFAULT_STATUS,
} from "./types";
import type { StatusFilterType } from "./types";

export type WorkItemGroupStatus = WorkItemStatus | "deleted";

export interface WorkItemGroup<TWorkItem extends WorkItem = WorkItem> {
  status: WorkItemGroupStatus;
  config: DropdownOption;
  items: TWorkItem[];
}

export interface WorkItemNavigation {
  hasPrev: boolean;
  hasNext: boolean;
  currentIndex: number;
}

export function isDeletedWorkItem(workItem: WorkItem): boolean {
  return Boolean(workItem.deletedAt);
}

export function getWorkItemStatus(workItem: WorkItem): WorkItemStatus {
  return (workItem.workItemStatus ??
    workItem.status ??
    WORK_ITEMS_DEFAULT_STATUS) as WorkItemStatus;
}

export function filterWorkItemsByStatus<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType
): TWorkItem[] {
  const mappedStatus = FILTER_TO_STATUS[statusFilter];
  if (!mappedStatus) return workItems;
  return workItems.filter(
    (workItem) =>
      !isDeletedWorkItem(workItem) &&
      getWorkItemStatus(workItem) === mappedStatus
  );
}

export function groupWorkItemsByStatus<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  options: readonly DropdownOption[] = WORK_ITEM_STATUS_OPTIONS
): WorkItemGroup<TWorkItem>[] {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  return options.map((option) => ({
    status: option.value as WorkItemStatus,
    config: option,
    items: activeItems.filter(
      (workItem) => getWorkItemStatus(workItem) === option.value
    ),
  }));
}

export function groupWorkItemsForStatusFilter<TWorkItem extends WorkItem>(
  workItems: TWorkItem[],
  statusFilter: StatusFilterType
): WorkItemGroup<TWorkItem>[] {
  const groups = groupWorkItemsByStatus(workItems);
  if (statusFilter === "all") {
    const deletedItems = workItems.filter(isDeletedWorkItem);
    if (deletedItems.length === 0) return groups;
    return [
      ...groups,
      {
        status: "deleted",
        config: {
          value: "deleted",
          label: "Delete Bin",
          color: "var(--color-text-3)",
        },
        items: deletedItems,
      },
    ];
  }

  const mappedStatus = FILTER_TO_STATUS[statusFilter];
  return groups.filter((group) => group.status === mappedStatus);
}

export function countWorkItemsByStatus(workItems: WorkItem[]): StatusCounts {
  const activeItems = workItems.filter(
    (workItem) => !isDeletedWorkItem(workItem)
  );
  const counts: StatusCounts = {
    all: activeItems.length,
    backlog: 0,
    todo: 0,
    inProgress: 0,
    inReview: 0,
    done: 0,
    cancelled: 0,
    duplicate: 0,
  };

  for (const key of STATUS_FILTER_KEYS) {
    if (key === "all") continue;
    const mappedStatus = FILTER_TO_STATUS[key];
    counts[key] = mappedStatus
      ? activeItems.filter(
          (workItem) => getWorkItemStatus(workItem) === mappedStatus
        ).length
      : 0;
  }

  return counts;
}

export function getWorkItemNavigation(
  filteredWorkItems: WorkItem[],
  selectedWorkItemId: string | null
): WorkItemNavigation {
  const currentIndex = filteredWorkItems.findIndex(
    (workItem) => workItem.session_id === selectedWorkItemId
  );
  return {
    hasPrev: currentIndex > 0,
    hasNext: currentIndex >= 0 && currentIndex < filteredWorkItems.length - 1,
    currentIndex,
  };
}
