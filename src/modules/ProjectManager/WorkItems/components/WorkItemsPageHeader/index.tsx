/**
 * WorkItemsPageHeader Component
 *
 * Header for the Work Items page.
 * Displays: {Project Name} … [Status filter] | [Overview | List | …].
 * In Workstation Project Manager, search can live on the tab bar trailing slot,
 * while view/filter/action controls live in the 40px page header. The breadcrumb
 * is path-only.
 *
 * Uses shared WorkStation header tokens for consistent styling.
 */
import {
  Box,
  Columns3,
  Info,
  List,
  ListChecks,
  ListChevronsDownUp,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import {
  HEADER_CLASSES,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { useRefreshSpin } from "@src/hooks/ui";
import {
  type WorkstationTabHeaderHost,
  usePublishWorkstationTabHeader,
} from "@src/hooks/workStation";
import { WORK_ITEM_STATUS_OPTIONS } from "@src/modules/ProjectManager/config/manage";
import ProjectManagerBreadcrumb from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import type { ProjectManagerBreadcrumbSegment } from "@src/modules/ProjectManager/shared/components/ProjectManagerBreadcrumb";
import { WorkstationHeaderSectionSeparator } from "@src/modules/WorkStation/shared";

import { FILTER_TO_STATUS, STATUS_FILTER_KEYS } from "../../types";

// ============================================
// Types
// ============================================

export type WorkItemsViewTab =
  | "Overview"
  | "List"
  | "Kanban"
  | "Gantt"
  | "Calendar"
  | "Settings";

/** Pre-computed status counts from Rust (avoid JS recomputation) */
export interface StatusCounts {
  all: number;
  backlog: number;
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
  cancelled: number;
  duplicate: number;
  // Index signature for dynamic key access
  [key: string]: number;
}

export interface WorkItemsPageHeaderProps {
  /** Current project name to display in breadcrumb */
  projectName: string;
  breadcrumbSegments?: readonly ProjectManagerBreadcrumbSegment[];
  /** Navigate back to the Projects list from the breadcrumb */
  onOpenProjects?: () => void;
  /** Currently selected view tab */
  activeTab: WorkItemsViewTab;
  /** Callback when tab is changed */
  onTabChange?: (tab: WorkItemsViewTab) => void;
  /** Status filter (shown inline when activeTab is "List") */
  statusFilter?: string;
  /** Callback when status filter is changed */
  onStatusFilterChange?: (filter: string) => void;
  /** Pre-computed status counts for status filter badges. */
  statusCounts: StatusCounts;
  /** Whether the properties panel is visible */
  showProperties?: boolean;
  /** Callback to toggle properties panel visibility */
  onToggleProperties?: () => void;
  /** Callback when "Add Project" button is clicked */
  onAddProject?: () => void;
  /** Callback when "Add Work Item" button is clicked */
  onAddWorkItem?: () => void;
  /** Callback when search button is clicked (opens PageSearch) */
  onSearch?: () => void;
  /** Collapse every visible list status section. */
  onCollapseAll?: () => void;
  /** Callback when refresh button is clicked */
  onRefresh?: () => void;
  /** Whether refresh is in progress (for spin animation) */
  refreshLoading?: boolean;
  /** Tabs supported by the current surface. Defaults to all Work Items views. */
  visibleTabs?: readonly WorkItemsViewTab[];
  /** Additional controls shown next to the breadcrumb on the left side. */
  leadingControls?: React.ReactNode;
  /** Additional controls shown before search/view controls. */
  trailingControls?: React.ReactNode;
  /** Publish controls into the global WorkstationTabHeader instead of rendering an inline 40px row. */
  publishToWorkstationHeader?: boolean;
  /** Target workstation host slot for the published header. */
  workstationHeaderHost?: WorkstationTabHeaderHost;
  /** Additional className */
  className?: string;
}

// ============================================
// Constants
// ============================================

const VIEW_SWITCH_TABS: readonly WorkItemsViewTab[] = ["List", "Kanban"];

interface AddActionsButtonProps {
  onAddProject?: () => void;
  onAddWorkItem?: () => void;
  addProjectLabel: string;
  addWorkItemLabel: string;
}

const AddActionsButton: React.FC<AddActionsButtonProps> = ({
  onAddProject,
  onAddWorkItem,
  addProjectLabel,
  addWorkItemLabel,
}) => {
  const {
    isOpen,
    isPositioned,
    toggle,
    close,
    triggerRef,
    panelRef,
    panelPosition,
  } = useDropdownEngine<HTMLButtonElement>({
    gap: DROPDOWN_PANEL.triggerGapTight,
    align: "right",
    closeOnEsc: true,
    placement: "bottom",
  });

  const handleAddProject = useCallback(() => {
    close();
    onAddProject?.();
  }, [close, onAddProject]);

  const handleAddWorkItem = useCallback(() => {
    close();
    onAddWorkItem?.();
  }, [close, onAddWorkItem]);

  if (!onAddProject && !onAddWorkItem) return null;

  if (!onAddProject || !onAddWorkItem) {
    return (
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        onClick={onAddWorkItem ?? onAddProject}
        title={onAddWorkItem ? addWorkItemLabel : addProjectLabel}
        icon={<Plus size={HEADER_ICON_SIZE.md} strokeWidth={2} />}
      />
    );
  }

  return (
    <>
      <Button
        ref={triggerRef}
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        className={isOpen ? "!bg-surface-selected !text-primary-6" : ""}
        onClick={toggle}
        title={addWorkItemLabel}
        icon={<Plus size={HEADER_ICON_SIZE.md} strokeWidth={2} />}
      />
      {isOpen &&
        isPositioned &&
        createPortal(
          <div
            ref={panelRef}
            className={`${DROPDOWN_CLASSES.menuPanelBase} fixed ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
            style={{
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              left:
                panelPosition.right === undefined
                  ? panelPosition.left
                  : undefined,
              right: panelPosition.right,
            }}
            role="menu"
          >
            <button
              type="button"
              onClick={handleAddWorkItem}
              className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
              role="menuitem"
            >
              <ListChecks
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={1.75}
                className="text-text-2"
              />
              <span className="min-w-0 flex-1 truncate">
                {addWorkItemLabel}
              </span>
            </button>
            <button
              type="button"
              onClick={handleAddProject}
              className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full text-left`}
              role="menuitem"
            >
              <Box
                size={DROPDOWN_ITEM.iconSize}
                strokeWidth={1.75}
                className="text-text-2"
              />
              <span className="min-w-0 flex-1 truncate">{addProjectLabel}</span>
            </button>
          </div>,
          document.body
        )}
    </>
  );
};

// ============================================
// Component
// ============================================

const WorkItemsPageHeader: React.FC<WorkItemsPageHeaderProps> = ({
  projectName,
  breadcrumbSegments,
  onOpenProjects: _onOpenProjects,
  activeTab,
  onTabChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  showProperties = true,
  onToggleProperties,
  onAddProject,
  onAddWorkItem,
  onSearch,
  onCollapseAll,
  onRefresh,
  refreshLoading = false,
  visibleTabs,
  leadingControls,
  trailingControls,
  publishToWorkstationHeader = false,
  workstationHeaderHost = "project",
  className = "",
}) => {
  const { t } = useTranslation("projects");
  const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
    useRefreshSpin(onRefresh ?? (() => {}), refreshLoading);
  const resolvedBreadcrumbSegments = useMemo(
    () =>
      breadcrumbSegments ?? [
        { label: t("projects.dashboardTitle") },
        { label: projectName },
      ],
    [breadcrumbSegments, projectName, t]
  );

  const visibleTabSet = useMemo(
    () => (visibleTabs ? new Set(visibleTabs) : null),
    [visibleTabs]
  );

  const viewSwitchOptions = useMemo<SelectOption[]>(
    () =>
      VIEW_SWITCH_TABS.filter(
        (tab) => !visibleTabSet || visibleTabSet.has(tab)
      ).map((tab) => {
        const Icon = tab === "List" ? List : Columns3;
        const label = t(`workItems.tabs.${tab === "List" ? "list" : "kanban"}`);
        return {
          value: tab,
          label: (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <Icon size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />
              <span>{label}</span>
            </span>
          ),
          triggerLabel: label,
        };
      }),
    [t, visibleTabSet]
  );

  const activeTabSupportsViewSwitch =
    activeTab === "List" || activeTab === "Kanban";
  const showViewSwitch =
    activeTabSupportsViewSwitch && viewSwitchOptions.length > 1 && onTabChange;

  const getStatusFilterIcon = useCallback((key: string) => {
    if (key === "all") {
      return <List size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />;
    }

    const status = FILTER_TO_STATUS[key as keyof typeof FILTER_TO_STATUS];
    const option = status
      ? WORK_ITEM_STATUS_OPTIONS.find((item) => item.value === status)
      : undefined;
    if (!option?.icon)
      return <List size={DROPDOWN_ITEM.iconSize} strokeWidth={1.75} />;

    return (
      <span style={option.color ? { color: option.color } : undefined}>
        {option.icon}
      </span>
    );
  }, []);

  const statusFilterOptions = useMemo<SelectOption[]>(
    () =>
      STATUS_FILTER_KEYS.map((key) => {
        const count = statusCounts[key] ?? 0;
        const label = t(`workItems.statusFilters.${key}`);
        return {
          value: key,
          label: (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-3">
                {getStatusFilterIcon(key)}
              </span>
              <span>{label}</span>
              <span className="tabular-nums text-text-3">{count}</span>
            </span>
          ),
          triggerLabel: label,
        };
      }),
    [getStatusFilterIcon, statusCounts, t]
  );

  const showStatusFilter =
    activeTab === "List" && statusFilter && onStatusFilterChange;
  const showCollapseAll = activeTab === "List" && onCollapseAll;

  const searchControl = onSearch && (
    <Button
      htmlType="button"
      variant="tertiary"
      size="small"
      iconOnly
      onClick={onSearch}
      title={t("common:actions.search")}
      icon={<Search size={HEADER_ICON_SIZE.sm} />}
    />
  );

  const addControls = (onAddWorkItem || onAddProject) && (
    <AddActionsButton
      onAddProject={onAddProject}
      onAddWorkItem={onAddWorkItem}
      addProjectLabel={t("projects.createProject")}
      addWorkItemLabel={t("workItems.createWorkItem")}
    />
  );

  const propertiesControl = onToggleProperties && (
    <Button
      htmlType="button"
      variant="tertiary"
      size="small"
      iconOnly
      className={showProperties ? "!bg-surface-selected !text-primary-6" : ""}
      onClick={onToggleProperties}
      title={
        showProperties
          ? t("workItems.hideProperties")
          : t("workItems.showProperties")
      }
      icon={<Info size={HEADER_ICON_SIZE.sm} />}
    />
  );

  const renderHeaderContent = (includeRefresh: boolean) => (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <ProjectManagerBreadcrumb
          segments={resolvedBreadcrumbSegments}
          trailingNode={leadingControls}
        />
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {trailingControls}
        {trailingControls &&
          (searchControl || showViewSwitch || showStatusFilter) && (
            <WorkstationHeaderSectionSeparator className="mx-0.5" />
          )}
        {searchControl}

        {showViewSwitch && (
          <Select
            value={activeTab}
            onChange={(value) => {
              if (Array.isArray(value)) return;
              onTabChange(value.toString() as WorkItemsViewTab);
            }}
            options={viewSwitchOptions}
            size="small"
            variant="ghost"
            radius="lg"
            dropdownWidthMode="auto"
            dropdownAlign="right"
            className="w-auto"
          />
        )}

        {showStatusFilter && (
          <Select
            value={statusFilter}
            onChange={(value) => {
              if (Array.isArray(value)) return;
              onStatusFilterChange(value.toString());
            }}
            options={statusFilterOptions}
            size="small"
            variant="ghost"
            radius="lg"
            dropdownWidthMode="match"
            dropdownMinWidth={172}
            dropdownAlign="right"
            className="w-auto"
          />
        )}

        {showStatusFilter && (
          <WorkstationHeaderSectionSeparator className="mx-1" />
        )}

        {(showCollapseAll || (includeRefresh && onRefresh) || addControls) && (
          <div className="flex flex-shrink-0 items-center gap-px">
            {showCollapseAll && (
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                onClick={onCollapseAll}
                title={t("common:actions.collapseAll")}
                icon={<ListChevronsDownUp size={HEADER_ICON_SIZE.md} />}
              />
            )}

            {includeRefresh && onRefresh && (
              <Button
                htmlType="button"
                variant="tertiary"
                size="small"
                iconOnly
                onClick={handleRefreshClick}
                title={t("common:actions.refresh")}
                icon={
                  <RefreshCw
                    size={HEADER_ICON_SIZE.sm}
                    strokeWidth={2}
                    className={refreshSpinClass}
                  />
                }
              />
            )}
            {addControls}
          </div>
        )}

        {propertiesControl && (
          <>
            <WorkstationHeaderSectionSeparator className="mx-0.5" />
            {propertiesControl}
          </>
        )}
      </div>
    </>
  );

  const publishedHeaderContent = renderHeaderContent(true);
  const inlineHeaderContent = renderHeaderContent(true);

  usePublishWorkstationTabHeader({
    host: workstationHeaderHost,
    content: {
      content: publishedHeaderContent,
    },
    enabled: publishToWorkstationHeader,
  });

  if (publishToWorkstationHeader) return null;

  return (
    <div className={`${HEADER_CLASSES.pageHeader} ${className}`}>
      {inlineHeaderContent}
    </div>
  );
};

export default WorkItemsPageHeader;
