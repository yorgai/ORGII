import type { FC, ReactNode } from "react";
import type React from "react";

import type { DropdownOption, Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
  WorkItemProject,
  WorkItemStatus,
} from "@src/types/core/workItem";

import type { WorkItemGroup } from "../../workItemsViewModel";
import WorkItemsListContent from "../WorkItemsListContent";

interface WorkItemsListSurfaceProps {
  groupedWorkItems: WorkItemGroup<WorkItemExtended>[];
  filteredWorkItems: WorkItemExtended[];
  selectedWorkItem: WorkItemExtended | null;
  selectedWorkItemId: string | null;
  workItems: WorkItemExtended[];
  availableMembers: Person[];
  availableProjects?: WorkItemProject[];
  availableMilestones?: WorkItemMilestone[];
  availableLabels?: WorkItemLabel[];
  onSelectWorkItem: (workItemId: string) => void;
  checkedWorkItemIds?: Set<string>;
  onCheckedChange?: (workItemId: string, checked: boolean) => void;
  onUpdateWorkItem?: (
    workItemId: string,
    updates: Partial<WorkItemExtended>
  ) => void;
  onDeleteWorkItem?: (workItemId: string) => void;
  onRestoreWorkItem?: (workItemId: string) => void;
  onAddProject?: () => void;
  onAddListItem?: (status: WorkItemStatus) => void | Promise<void>;
  detailContent?: ReactNode;
  propertiesPanel?: ReactNode;
  emptyListPlaceholder?: ReactNode;
  noResultsPlaceholder?: ReactNode;
  hidePropertiesPanel?: boolean;
  readonly?: boolean;
  workItemPrefix?: string;
  externalStatusOptions?: DropdownOption<string>[];
  getExternalStatusValue?: (workItem: WorkItemExtended) => string | undefined;
  onExternalStatusChange?: (
    workItemId: string,
    statusId: string
  ) => void | Promise<void>;
  statusDisabled?: boolean;
  collapseAllSignal?: number;
  /** Render project cells read-only (cross-project Work Items page). */
  disableProjectEdit?: boolean;
}

const EMPTY_CHECKED_WORK_ITEM_IDS = new Set<string>();

const WorkItemsListSurface: FC<WorkItemsListSurfaceProps> = ({
  groupedWorkItems,
  filteredWorkItems,
  selectedWorkItem,
  selectedWorkItemId,
  workItems,
  availableMembers,
  availableProjects = [],
  availableMilestones = [],
  availableLabels = [],
  onSelectWorkItem,
  checkedWorkItemIds = EMPTY_CHECKED_WORK_ITEM_IDS,
  onCheckedChange,
  onUpdateWorkItem,
  onDeleteWorkItem,
  onRestoreWorkItem,
  onAddProject,
  onAddListItem,
  detailContent,
  propertiesPanel,
  emptyListPlaceholder,
  noResultsPlaceholder,
  hidePropertiesPanel = false,
  readonly = false,
  workItemPrefix,
  externalStatusOptions,
  getExternalStatusValue,
  onExternalStatusChange,
  statusDisabled = false,
  collapseAllSignal = 0,
  disableProjectEdit = false,
}) => {
  const listContent = (
    <WorkItemsListContent
      groupedWorkItems={groupedWorkItems}
      filteredWorkItems={filteredWorkItems}
      workItems={workItems}
      selectedWorkItemId={selectedWorkItemId}
      availableMembers={availableMembers}
      availableProjects={availableProjects}
      availableMilestones={availableMilestones}
      availableLabels={availableLabels}
      checkedWorkItemIds={checkedWorkItemIds}
      onCheckedChange={onCheckedChange}
      onSelectWorkItem={onSelectWorkItem}
      onUpdateWorkItem={onUpdateWorkItem}
      onDeleteWorkItem={onDeleteWorkItem}
      onRestoreWorkItem={onRestoreWorkItem}
      onAddProject={onAddProject}
      onAddListItem={onAddListItem}
      emptyListPlaceholder={emptyListPlaceholder}
      noResultsPlaceholder={noResultsPlaceholder}
      readonly={readonly}
      workItemPrefix={workItemPrefix}
      externalStatusOptions={externalStatusOptions}
      getExternalStatusValue={getExternalStatusValue}
      onExternalStatusChange={onExternalStatusChange}
      statusDisabled={statusDisabled}
      collapseAllSignal={collapseAllSignal}
      disableProjectEdit={disableProjectEdit}
    />
  );

  const isDetail = !!selectedWorkItem;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className={isDetail ? "hidden" : "h-full"}>{listContent}</div>
        {isDetail && detailContent && (
          <div className="h-full">{detailContent}</div>
        )}
      </div>
      {!isDetail && !hidePropertiesPanel && propertiesPanel}
    </div>
  );
};

export default WorkItemsListSurface;
