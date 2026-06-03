import { emit } from "@tauri-apps/api/event";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type WorkItemPartialUpdate,
  enrichedWorkItemToUI,
  projectApi,
  workItemDataToUI,
} from "@src/api/http/project";
import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { useProjectDataChanged } from "@src/hooks/project";
import type { WorkstationTabHeaderHost } from "@src/hooks/workStation";
import type { LinearProjectSelection } from "@src/modules/ProjectManager/Panels/ProjectManagerSidebar/content/WorkspaceTreeContent";
import { MultiSelectBar } from "@src/modules/ProjectManager/WorkItems/components/WorkItemsFooterBars";
import WorkItemsListSurface from "@src/modules/ProjectManager/WorkItems/components/WorkItemsListSurface";
import WorkItemsPageHeader from "@src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader";
import type { StatusCounts } from "@src/modules/ProjectManager/WorkItems/components/WorkItemsPageHeader";
import type { StatusFilterType } from "@src/modules/ProjectManager/WorkItems/types";
import {
  countWorkItemsByStatus,
  filterWorkItemsByStatus,
  groupWorkItemsForStatusFilter,
} from "@src/modules/ProjectManager/WorkItems/workItemsViewModel";
import { useProjectManagerWorkItemsTabBarRegistration } from "@src/modules/ProjectManager/hooks/useProjectManagerWorkItemsTabBarRegistration";
import { PROJECT_MANAGER_PLACEHOLDER_PLACEMENT } from "@src/modules/ProjectManager/shared/placeholderTokens";
import {
  WORKSPACE_SOURCE,
  type WorkspaceWorkItem,
  loadWorkspaceLinearWorkItems,
} from "@src/modules/ProjectManager/workspaceAggregate";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

interface ProjectWorkItemsTabContentProps {
  breadcrumbSegments?: readonly { label: string }[];
  workStationTabId?: string;
  workstationHeaderHost?: WorkstationTabHeaderHost;
  onCreateProject?: () => void;
  onCreateWorkItem?: () => void;
  onOpenLinearProject?: (selection: LinearProjectSelection) => void;
  orgId?: string;
  allowExternalSources?: boolean;
  onOpenWorkItem: (
    projectId: string | undefined,
    projectName: string | undefined,
    projectSlug: string | undefined,
    workItemId: string,
    workItemName: string
  ) => void;
  /** Org hub surface pills shown after the breadcrumb (Overview / Projects / …). */
  orgSurfaceControls?: React.ReactNode;
}

interface AggregatedWorkItemProject {
  meta: {
    id: string;
    name: string;
  };
  slug: string;
}

interface AggregatedWorkItem {
  project?: AggregatedWorkItemProject;
  item: WorkspaceWorkItem;
}

type WorkspaceSourceMode = "local_only" | "include_external";

const STORY_WORK_ITEMS_VISIBLE_TABS = ["List"] as const;

export const ProjectWorkItemsTabContent: React.FC<
  ProjectWorkItemsTabContentProps
> = ({
  breadcrumbSegments,
  workStationTabId,
  workstationHeaderHost = "project",
  onCreateProject,
  onCreateWorkItem,
  onOpenLinearProject,
  orgId,
  allowExternalSources = false,
  onOpenWorkItem,
  orgSurfaceControls,
}) => {
  const { t } = useTranslation("projects");
  const [workItemsByProject, setWorkItemsByProject] = useState<
    AggregatedWorkItem[]
  >([]);
  const [projectOptions, setProjectOptions] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>("all");
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [selectedWorkItemIds, setSelectedWorkItemIds] = useState<Set<string>>(
    new Set()
  );
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [workspaceSourceMode, setWorkspaceSourceMode] =
    useState<WorkspaceSourceMode>("local_only");

  const includeExternalSources =
    allowExternalSources && workspaceSourceMode === "include_external";

  useEffect(() => {
    if (!allowExternalSources) {
      setWorkspaceSourceMode("local_only");
    }
  }, [allowExternalSources]);

  const loadWorkItems = useCallback(
    async (cancelled?: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const projects = await projectApi.readProjects({ orgId });
        const [localEntryGroups, standaloneWorkItems, linearWorkItems] =
          await Promise.all([
            Promise.all(
              projects.map(async (project) => {
                const projectWorkItems = await projectApi.readWorkItemsEnriched(
                  project.slug,
                  { orgId }
                );
                return projectWorkItems.map((workItem) => ({
                  project,
                  item: {
                    ...enrichedWorkItemToUI(workItem),
                    project: {
                      id: project.meta.id,
                      name: project.meta.name,
                    },
                  },
                }));
              })
            ),
            projectApi.readStandaloneWorkItems({ orgId }),
            includeExternalSources ? loadWorkspaceLinearWorkItems() : [],
          ]);
        if (cancelled?.()) return;
        setProjectOptions(
          projects.map((project) => ({
            id: project.meta.id,
            name: project.meta.name,
            slug: project.slug,
          }))
        );
        const standaloneEntries = standaloneWorkItems.map((workItem) => ({
          item: workItemDataToUI(workItem, {
            labelMap: new Map(),
            memberMap: new Map(),
            projectNameMap: new Map(),
          }),
        }));
        const linearEntries = linearWorkItems.map((workItem) => ({
          project: {
            meta: {
              id: workItem.workspaceSource?.projectId ?? "linear",
              name: workItem.workspaceSource?.projectName ?? "Linear",
            },
            slug: workItem.workspaceSource?.projectId ?? "linear",
          },
          item: workItem,
        }));
        setWorkItemsByProject([
          ...localEntryGroups.flat(),
          ...standaloneEntries,
          ...linearEntries,
        ]);
        loadedRef.current = true;
        setLoaded(true);
      } catch (err) {
        if (cancelled?.()) return;
        if (!loadedRef.current) {
          setWorkItemsByProject([]);
        }
        setError(
          err instanceof Error ? err.message : t("projects.loadProjectsFailed")
        );
      } finally {
        if (!cancelled?.()) setLoading(false);
      }
    },
    [includeExternalSources, orgId, t]
  );

  useEffect(() => {
    let cancelled = false;
    void loadWorkItems(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadWorkItems]);

  useProjectDataChanged(
    useCallback(() => {
      void loadWorkItems();
    }, [loadWorkItems])
  );

  const workItems = useMemo(
    () => workItemsByProject.map((entry) => entry.item),
    [workItemsByProject]
  );

  const availableProjects = useMemo(
    () => projectOptions.map(({ id, name }) => ({ id, name })),
    [projectOptions]
  );

  const statusCounts = useMemo<StatusCounts>(
    () => countWorkItemsByStatus(workItems),
    [workItems]
  );

  const filteredWorkItems = useMemo(
    () => filterWorkItemsByStatus(workItems, statusFilter),
    [statusFilter, workItems]
  );

  const groupedWorkItems = useMemo(
    () => groupWorkItemsForStatusFilter(filteredWorkItems, statusFilter),
    [filteredWorkItems, statusFilter]
  );

  const selectableFilteredWorkItemCount = useMemo(
    () =>
      filteredWorkItems.filter(
        (workItem) =>
          workItem.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR
      ).length,
    [filteredWorkItems]
  );

  const workItemById = useMemo(() => {
    const map = new Map<string, AggregatedWorkItem>();
    for (const workItem of workItemsByProject) {
      map.set(workItem.item.session_id, workItem);
    }
    return map;
  }, [workItemsByProject]);

  const handleSelectWorkItem = useCallback(
    (workItemId: string) => {
      const workItem = workItemById.get(workItemId);
      if (!workItem) return;
      if (
        workItem.item.workspaceSource?.source === WORKSPACE_SOURCE.LINEAR &&
        onOpenLinearProject
      ) {
        onOpenLinearProject({
          connectionId: workItem.item.workspaceSource.connectionId,
          projectId: workItem.item.workspaceSource.projectId,
          projectName: workItem.item.workspaceSource.projectName,
          teamId: workItem.item.workspaceSource.teamId,
          teamName: workItem.item.workspaceSource.teamName,
        });
        return;
      }
      onOpenWorkItem(
        workItem.project?.meta.id,
        workItem.project?.meta.name,
        workItem.project?.slug,
        workItem.item.session_id,
        workItem.item.name || t("workItems.untitledWorkItem")
      );
    },
    [workItemById, onOpenLinearProject, onOpenWorkItem, t]
  );

  const handleUpdateWorkItem = useCallback(
    async (workItemId: string, updates: Partial<WorkItemExtended>) => {
      const entry = workItemById.get(workItemId);
      if (!entry?.project?.slug) return;
      if (entry.item.workspaceSource?.source === WORKSPACE_SOURCE.LINEAR)
        return;

      if ("project" in updates) {
        const targetProject = updates.project
          ? projectOptions.find((project) => project.id === updates.project?.id)
          : null;
        if (!targetProject || targetProject.slug === entry.project.slug) return;
        await projectApi.moveWorkItem(
          entry.item.session_id,
          entry.project.slug,
          targetProject.slug
        );
        setWorkItemsByProject((currentEntries) =>
          currentEntries.map((currentEntry) =>
            currentEntry.item.session_id === workItemId
              ? {
                  project: {
                    meta: {
                      id: targetProject.id,
                      name: targetProject.name,
                    },
                    slug: targetProject.slug,
                  },
                  item: {
                    ...currentEntry.item,
                    project: {
                      id: targetProject.id,
                      name: targetProject.name,
                    },
                  },
                }
              : currentEntry
          )
        );
        return;
      }

      const payload: WorkItemPartialUpdate = {};
      if (updates.name !== undefined) payload.title = updates.name;
      if (updates.spec !== undefined) payload.body = updates.spec;
      if (updates.workItemStatus !== undefined) {
        payload.status = updates.workItemStatus;
      }
      if (updates.priority !== undefined) payload.priority = updates.priority;
      if ("endDate" in updates) payload.targetDate = updates.endDate ?? null;
      if (Object.keys(payload).length === 0) return;

      const updated = await projectApi.updateWorkItemPartial(
        entry.project.slug,
        entry.item.session_id,
        payload
      );
      const updatedItem = {
        ...enrichedWorkItemToUI(updated),
        project: entry.item.project,
      };
      setWorkItemsByProject((currentEntries) =>
        currentEntries.map((currentEntry) =>
          currentEntry.item.session_id === workItemId
            ? { ...currentEntry, item: updatedItem }
            : currentEntry
        )
      );
    },
    [projectOptions, workItemById]
  );

  const handleRefresh = useCallback(() => {
    void loadWorkItems();
  }, [loadWorkItems]);

  const handleCheckedChange = useCallback(
    (workItemId: string, checked: boolean) => {
      setSelectedWorkItemIds((previous) => {
        const next = new Set(previous);
        if (checked) {
          next.add(workItemId);
        } else {
          next.delete(workItemId);
        }
        return next;
      });
    },
    []
  );

  const handleSelectAll = useCallback(() => {
    setSelectedWorkItemIds(
      new Set(
        filteredWorkItems
          .filter(
            (workItem) =>
              workItem.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR
          )
          .map((workItem) => workItem.session_id)
      )
    );
  }, [filteredWorkItems]);

  const handleUnselectAll = useCallback(() => {
    setSelectedWorkItemIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const selectedLocalEntries = [...selectedWorkItemIds]
      .map((workItemId) => workItemById.get(workItemId))
      .filter(
        (entry): entry is AggregatedWorkItem =>
          !!entry &&
          entry.item.workspaceSource?.source !== WORKSPACE_SOURCE.LINEAR
      );
    if (selectedLocalEntries.length === 0) return;

    setBulkDeleting(true);
    try {
      const entriesByProjectSlug = new Map<string, string[]>();
      for (const entry of selectedLocalEntries) {
        if (!entry.project?.slug) continue;
        const currentShortIds =
          entriesByProjectSlug.get(entry.project.slug) ?? [];
        currentShortIds.push(entry.item.session_id);
        entriesByProjectSlug.set(entry.project.slug, currentShortIds);
      }

      await Promise.all(
        [...entriesByProjectSlug].map(([projectSlug, shortIds]) =>
          projectApi.batchDeleteWorkItems(projectSlug, shortIds)
        )
      );
      await emit("orgii-data-changed");
      setSelectedWorkItemIds(new Set());
      await loadWorkItems();
    } finally {
      setBulkDeleting(false);
    }
  }, [loadWorkItems, selectedWorkItemIds, workItemById]);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((currentSignal) => currentSignal + 1);
  }, []);

  const workspaceSourceTabs = useMemo<TabPillItem[]>(
    () => [
      { key: "local_only", label: t("projects.source.localOnly") },
      {
        key: "include_external",
        label: t("projects.source.includeExternal"),
      },
    ],
    [t]
  );

  const handleWorkspaceSourceModeChange = useCallback((key: string) => {
    setWorkspaceSourceMode(key as WorkspaceSourceMode);
  }, []);

  const sourceModeSwitch = useMemo(() => {
    if (!allowExternalSources) return null;
    return (
      <TabPill
        tabs={workspaceSourceTabs}
        activeTab={workspaceSourceMode}
        onChange={handleWorkspaceSourceModeChange}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    );
  }, [
    allowExternalSources,
    handleWorkspaceSourceModeChange,
    workspaceSourceMode,
    workspaceSourceTabs,
  ]);

  const headerLeadingControls = useMemo(() => {
    if (!orgSurfaceControls && !sourceModeSwitch) return undefined;
    if (!orgSurfaceControls) return sourceModeSwitch;
    if (!sourceModeSwitch) return orgSurfaceControls;
    return (
      <>
        {orgSurfaceControls}
        <span
          className="pointer-events-none mx-1.5 h-4 w-px shrink-0 bg-border-2"
          aria-hidden
        />
        {sourceModeSwitch}
      </>
    );
  }, [orgSurfaceControls, sourceModeSwitch]);

  useProjectManagerWorkItemsTabBarRegistration({
    workStationTabId,
    showPropertiesActive: false,
    onSearch: null,
    onRefresh: handleRefresh,
    refreshLoading: loading,
    onToggleProperties: null,
    onAddProject: onCreateProject ?? null,
    onAddWorkItem: onCreateWorkItem ?? null,
  });

  if (loading && !loaded) {
    return (
      <Placeholder
        variant="loading"
        placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
        title={t("projects.loading")}
        fillParentHeight
      />
    );
  }

  if (error && workItems.length === 0) {
    return (
      <Placeholder
        variant="error"
        placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
        title={error}
        fillParentHeight
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <WorkItemsPageHeader
        projectName={t("projects.columns.workItems")}
        breadcrumbSegments={breadcrumbSegments}
        activeTab="List"
        statusFilter={statusFilter}
        onStatusFilterChange={(value) =>
          setStatusFilter(value as StatusFilterType)
        }
        statusCounts={statusCounts}
        onCollapseAll={handleCollapseAll}
        onAddProject={onCreateProject}
        onAddWorkItem={onCreateWorkItem}
        onRefresh={handleRefresh}
        refreshLoading={loading}
        visibleTabs={STORY_WORK_ITEMS_VISIBLE_TABS}
        leadingControls={headerLeadingControls}
        publishToWorkstationHeader={!!workStationTabId}
        workstationHeaderHost={workstationHeaderHost}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkItemsListSurface
          groupedWorkItems={groupedWorkItems}
          filteredWorkItems={filteredWorkItems}
          selectedWorkItem={null}
          selectedWorkItemId={null}
          workItems={workItems}
          availableMembers={[]}
          availableProjects={availableProjects}
          checkedWorkItemIds={selectedWorkItemIds}
          onCheckedChange={handleCheckedChange}
          onSelectWorkItem={handleSelectWorkItem}
          onUpdateWorkItem={handleUpdateWorkItem}
          collapseAllSignal={collapseAllSignal}
          emptyListPlaceholder={
            <Placeholder
              variant="empty"
              placement={PROJECT_MANAGER_PLACEHOLDER_PLACEMENT}
              title={t("workItems.noWorkItems")}
              subtitle={t("workItems.noWorkItemsSubtitle")}
              action={
                onCreateWorkItem
                  ? {
                      label: t("workItems.addFirstWorkItem"),
                      onClick: onCreateWorkItem,
                    }
                  : undefined
              }
              fillParentHeight
            />
          }
          hidePropertiesPanel
        />
      </div>

      <MultiSelectBar
        selectedCount={selectedWorkItemIds.size}
        visibleItemCount={selectableFilteredWorkItemCount}
        deleting={bulkDeleting}
        onSelectAll={handleSelectAll}
        onUnselectAll={handleUnselectAll}
        onDelete={handleBulkDelete}
      />
    </div>
  );
};

export default ProjectWorkItemsTabContent;
