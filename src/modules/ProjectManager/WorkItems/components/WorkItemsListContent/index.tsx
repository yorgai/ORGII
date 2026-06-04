import type React from "react";
import { type FC, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PROJECT_MANAGER_PLACEHOLDER_PLACEMENT } from "@src/modules/ProjectManager/shared/placeholderTokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { DropdownOption, Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
  WorkItemProject,
  WorkItemStatus,
} from "@src/types/core/workItem";

import { WORK_ITEMS_DEFAULT_STATUS } from "../../types";
import type { WorkItemGroup } from "../../workItemsViewModel";
import WorkItemRow from "../WorkItemRow";
import WorkItemSection from "../WorkItemSection";

interface WorkItemsListContentProps {
  groupedWorkItems: WorkItemGroup<WorkItemExtended>[];
  filteredWorkItems: WorkItemExtended[];
  workItems: WorkItemExtended[];
  selectedWorkItemId: string | null;
  availableMembers: Person[];
  availableProjects?: WorkItemProject[];
  availableMilestones?: WorkItemMilestone[];
  availableLabels?: WorkItemLabel[];
  checkedWorkItemIds?: Set<string>;
  onCheckedChange?: (workItemId: string, checked: boolean) => void;
  onSelectWorkItem: (workItemId: string) => void;
  onUpdateWorkItem?: (
    workItemId: string,
    updates: Partial<WorkItemExtended>
  ) => void;
  onDeleteWorkItem?: (workItemId: string) => void;
  onRestoreWorkItem?: (workItemId: string) => void;
  readonly?: boolean;
  onAddProject?: () => void;
  onAddListItem?: (status: WorkItemStatus) => void | Promise<void>;
  emptyListPlaceholder?: ReactNode;
  noResultsPlaceholder?: ReactNode;
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
  compactRows?: boolean;
}

const EMPTY_CHECKED_WORK_ITEM_IDS = new Set<string>();

const WorkItemsListContent: FC<WorkItemsListContentProps> = ({
  groupedWorkItems,
  filteredWorkItems,
  workItems,
  selectedWorkItemId,
  availableMembers,
  availableProjects = [],
  availableMilestones = [],
  availableLabels = [],
  checkedWorkItemIds = EMPTY_CHECKED_WORK_ITEM_IDS,
  onCheckedChange,
  onSelectWorkItem,
  onUpdateWorkItem,
  onDeleteWorkItem,
  onRestoreWorkItem,
  readonly = false,
  onAddProject,
  onAddListItem,
  emptyListPlaceholder,
  noResultsPlaceholder,
  workItemPrefix,
  externalStatusOptions,
  getExternalStatusValue,
  onExternalStatusChange,
  statusDisabled = false,
  collapseAllSignal = 0,
  disableProjectEdit = false,
  compactRows = false,
}) => {
  const { t } = useTranslation("projects");

  const hasControlledCheckboxes = !!onCheckedChange;
  const showCheckboxesOnAllRows = useMemo(
    () => hasControlledCheckboxes && checkedWorkItemIds.size > 0,
    [checkedWorkItemIds, hasControlledCheckboxes]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
        {filteredWorkItems.length === 0 ? (
          workItems.length === 0 ? (
            (emptyListPlaceholder ?? (
              <Placeholder
                variant="empty"
                placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
                title={t("workItems.noWorkItems")}
                subtitle={t("workItems.noWorkItemsSubtitle")}
                action={
                  onAddListItem
                    ? {
                        label: t("workItems.addFirstWorkItem"),
                        onClick: () => {
                          void onAddListItem(WORK_ITEMS_DEFAULT_STATUS);
                        },
                      }
                    : undefined
                }
                fillParentHeight
              />
            ))
          ) : (
            (noResultsPlaceholder ?? (
              <Placeholder
                variant="no-results"
                placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
                title={t("workItems.noResults")}
                fillParentHeight
              />
            ))
          )
        ) : (
          <div className={`flex flex-col ${compactRows ? "pb-2" : "pb-3"}`}>
            {groupedWorkItems.map((group) => {
              const isDeletedGroup = group.status === "deleted";
              return (
                <WorkItemSection
                  key={`${group.status}:${collapseAllSignal}`}
                  status={group.status}
                  statusConfig={group.config}
                  count={group.items.length}
                  defaultExpanded={!isDeletedGroup && collapseAllSignal === 0}
                  label={
                    isDeletedGroup ? t("workItems.deleteBin.title") : undefined
                  }
                  onAddItem={
                    onAddListItem && !isDeletedGroup
                      ? () => {
                          void onAddListItem(group.status as WorkItemStatus);
                        }
                      : undefined
                  }
                  compact={compactRows}
                >
                  {group.items.map((workItem) => (
                    <WorkItemRow
                      key={workItem.session_id}
                      workItem={workItem}
                      isSelected={selectedWorkItemId === workItem.session_id}
                      onSelect={onSelectWorkItem}
                      onUpdate={onUpdateWorkItem}
                      onDelete={onDeleteWorkItem}
                      onRestore={onRestoreWorkItem}
                      readonly={readonly}
                      compact={compactRows}
                      availableMembers={availableMembers}
                      availableProjects={availableProjects}
                      availableMilestones={availableMilestones}
                      availableLabels={availableLabels}
                      isChecked={
                        hasControlledCheckboxes
                          ? checkedWorkItemIds.has(workItem.session_id)
                          : undefined
                      }
                      onCheckedChange={onCheckedChange}
                      workItemPrefix={workItemPrefix}
                      showCheckboxes={
                        showCheckboxesOnAllRows && !isDeletedGroup
                      }
                      externalStatusValue={getExternalStatusValue?.(workItem)}
                      externalStatusOptions={externalStatusOptions}
                      onExternalStatusChange={
                        onExternalStatusChange
                          ? (statusId) =>
                              onExternalStatusChange(
                                workItem.session_id,
                                statusId
                              )
                          : undefined
                      }
                      statusDisabled={statusDisabled || isDeletedGroup}
                      disableProjectEdit={disableProjectEdit}
                    />
                  ))}
                </WorkItemSection>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkItemsListContent;
