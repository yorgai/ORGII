import { useAtomValue, useSetAtom } from "jotai";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { WorkstationTabHeaderHost } from "@src/hooks/workStation";
import type { LinkedRepoOption } from "@src/modules/ProjectManager/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { ContentSearchPalette } from "@src/scaffold/GlobalSpotlight/palettes";
import { currentRepoAtom, reposAtom } from "@src/store/repo";
import { syncDeepLinkAtom } from "@src/store/sync";
import {
  PROJECT_DETAIL_SURFACE_VIEW,
  type ProjectDetailSurfaceView,
} from "@src/store/workstation/tabs";
import type { WorkItemStatus } from "@src/types/core/workItem";

import { ProjectDetailSurfacePillSwitch } from "../ProjectManagerLayout/components/ProjectDetailSurfacePillSwitch";
import {
  EmbeddedWorkItemDetail,
  MultiSelectBar,
  OverviewPropertiesPanel,
  WorkItemsPageHeader,
  WorkItemsTabContent,
} from "./components";
import type { SettingsSectionId } from "./components/WorkItemsSettings";
import { getEffectiveWorkItemPrefix } from "./config";
import { useBufferedProjectProperties } from "./hooks/useBufferedProjectProperties";
import { useMultiSelect } from "./hooks/useMultiSelect";
import { useWorkItems } from "./hooks/useWorkItems";
import { useWorkItemsHeaderState } from "./hooks/useWorkItemsHeaderState";
import { useWorkItemsSync } from "./hooks/useWorkItemsSync";
import {
  type EmbeddedWorkItemDetailState,
  useWorkItemsTabBarState,
} from "./hooks/useWorkItemsTabBarState";
import type { WorkItemsViewTab } from "./types";

const WorkItemsSettings = React.lazy(
  () => import("./components/WorkItemsSettings")
);

// ============================================
// Types
// ============================================

export type { EmbeddedWorkItemDetailState } from "./hooks/useWorkItemsTabBarState";

export interface WorkItemsPageProps {
  breadcrumbSegments?: readonly { label: string }[];
  /** Project ID from the active tab */
  projectId: string;
  /** Project name from the active tab (for display) */
  projectName: string;
  /** Display title override for aggregate Work Items surfaces. */
  pageTitle?: string;
  /** Cached project slug from tab data — enables parallel work item loading */
  cachedProjectSlug?: string;
  /** Workspace path used by editor context menus. */
  repoPath?: string | null;
  /** Surface to show for the project detail tab. */
  projectView?: ProjectDetailSurfaceView;
  /** Persist project detail surface changes to the owning tab. */
  onProjectViewChange?: (view: ProjectDetailSurfaceView) => void;
  /** Called when the resolved project slug is known, so the layout can persist it to the tab */
  onProjectSlugResolved?: (slug: string) => void;
  /** Callback to open the "New Project" modal */
  onCreateProject?: () => void;
  /** Callback to open a "New Work Item" tab */
  onCreateWorkItem?: (
    projectId: string,
    projectName: string,
    projectSlug: string
  ) => void;
  /** Callback after project is deleted (e.g. close the tab) */
  onProjectDeleted?: () => void;
  /** Notify parent tab system about unsaved changes (for dot indicator) */
  onSetUnsaved?: (unsaved: boolean) => void;
  /** Notify parent tab system when the project title changes */
  onProjectNameUpdated?: (projectName: string) => void;
  /** Navigate to the repo-level Projects list. */
  onOpenProjects?: () => void;
  /** Navigate to repo-level settings (Projects > Settings tab) */
  onOpenRepoSettings?: () => void;
  /** Open a work item in its own dedicated tab (carries unsaved changes) */
  onExpandWorkItemToTab?: (
    workItemId: string,
    workItemName: string,
    pendingUpdates?: Record<string, unknown>
  ) => void;
  /** Notify parent tab system when the embedded work item title changes */
  onEmbeddedWorkItemNameUpdated?: (workItemName: string) => void;
  /** Open an agent session in a chat tab */
  onOpenChatSession?: (sessionId: string, title?: string) => void;
  /** Report whether this project tab is showing its list or an embedded work item detail. */
  onEmbeddedWorkItemDetailStateChange?: (
    tabId: string,
    state: EmbeddedWorkItemDetailState
  ) => void;
  /** Whether this tab is the currently visible tab (gates background refreshes) */
  isActive?: boolean;
  /**
   * When set (Workstation Project Manager), Info / Add work item are shown on
   * the Workstation tab bar instead of the page header.
   */
  workStationTabId?: string;
  /** Target workstation host slot for the published 40px header. */
  workstationHeaderHost?: WorkstationTabHeaderHost;
}

// ============================================
// Main Component
// ============================================

const WorkItemsPage: React.FC<WorkItemsPageProps> = ({
  breadcrumbSegments,
  projectId,
  projectName: tabProjectName,
  pageTitle,
  cachedProjectSlug,
  repoPath,
  projectView = PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS,
  onProjectViewChange,
  onProjectSlugResolved,
  onCreateProject,
  onCreateWorkItem,
  onProjectDeleted,
  onSetUnsaved,
  onProjectNameUpdated,
  onOpenProjects,
  onOpenRepoSettings,
  onExpandWorkItemToTab,
  onEmbeddedWorkItemNameUpdated,
  onOpenChatSession,
  onEmbeddedWorkItemDetailStateChange,
  isActive = true,
  workStationTabId,
  workstationHeaderHost = "project",
}) => {
  const { t } = useTranslation("projects");
  const currentRepo = useAtomValue(currentRepoAtom);
  const allRepos = useAtomValue(reposAtom);
  const availableRepos = useMemo<LinkedRepoOption[]>(
    () =>
      allRepos
        .map((repo) => ({
          id: repo.path ?? repo.fs_uri ?? repo.id,
          name: repo.name || repo.path || repo.id,
        }))
        .filter((repo) => repo.id),
    [allRepos]
  );
  const deepLinkRequest = useAtomValue(syncDeepLinkAtom);
  const setDeepLinkRequest = useSetAtom(syncDeepLinkAtom);
  const { state, data, projectData, handlers } = useWorkItems({
    projectId,
    cachedProjectSlug,
    initialActiveTab:
      projectView === PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
        ? "Overview"
        : "List",
    isActive,
  });
  const { handleTabChange } = handlers;

  // Persist resolved slug to tab data for faster loading on next app launch
  const resolvedSlug = projectData.project?.slug;
  const reportedSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (resolvedSlug && resolvedSlug !== reportedSlugRef.current) {
      reportedSlugRef.current = resolvedSlug;
      onProjectSlugResolved?.(resolvedSlug);
    }
  }, [resolvedSlug, onProjectSlugResolved]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);

  // Pending Settings section forwarded to `WorkItemsSettings` once the
  // user clicks the status-bar sync widget. Cleared on consumption so
  // the same value never re-fires when the user later picks a
  // different section in the sidebar.
  const [pendingSettingsSection, setPendingSettingsSection] = useState<
    SettingsSectionId | undefined
  >(undefined);

  // Deep-link consumer (Phase 4.8 Track D) — when the widget writes a
  // request whose slug matches this project, switch to the Settings
  // view, store the section to focus, and clear the atom in the same
  // tick so a stale request never opens the wrong project's section.
  // The setState calls below are guarded so they fire at most once per
  // request value: the atom is cleared in the same effect run, so the
  // next render exits early at the `!deepLinkRequest` check.
  useEffect(() => {
    if (!deepLinkRequest) return;
    if (!resolvedSlug || deepLinkRequest.slug !== resolvedSlug) return;

    handlers.handleTabChange("Settings");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingSettingsSection(deepLinkRequest.section);
    setDeepLinkRequest(null);
  }, [deepLinkRequest, resolvedSlug, handlers, setDeepLinkRequest]);

  const handleSettingsSectionConsumed = useCallback(() => {
    setPendingSettingsSection(undefined);
  }, []);

  const {
    selectedIds,
    bulkDeleting,
    handleCheckedChange,
    handleSelectAll,
    handleUnselectAll,
    handleBulkDelete,
  } = useMultiSelect({
    filteredWorkItems: data.filteredWorkItems,
    onDelete: handlers.handleDelete,
    projectSlug: projectData.project?.slug,
    getShortId: data.getShortId,
    onBatchDeleteComplete: data.refresh,
  });

  const handleOpenSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setCollapseAllSignal((currentSignal) => currentSignal + 1);
  }, []);

  const { projectName, headerTitle, sourceProject } = useWorkItemsHeaderState({
    pageTitle,
    tabProjectName,
    project: projectData.project,
    projectLoading: projectData.loading,
  });

  const { handleDeleteProject } = useWorkItemsSync({
    project: projectData.project,
    projectName,
    rawMembers: projectData.rawMembers,
    workItemCount: data.workItems.length,
    onProjectDeleted,
  });

  // Track work item detail pending changes
  const [hasWorkItemPendingChanges, setHasWorkItemPendingChanges] =
    useState(false);
  const [workItemPropertiesOpen, setWorkItemPropertiesOpen] = useState(true);

  const handleCloseDetail = useCallback(() => {
    handlers.handleCloseWorkItemDetail();
    setHasWorkItemPendingChanges(false);
  }, [handlers]);

  const linkedRepoPath = sourceProject?.linkedRepos?.[0]?.id;
  const resolvedRepoPath = linkedRepoPath ?? currentRepo?.path ?? null;
  const resolvedProjectSlug = projectData.project?.slug ?? null;
  const selectedShortId = data.selectedWorkItem
    ? (data.getShortId(data.selectedWorkItem.session_id) ?? null)
    : null;

  const {
    actionsInStationTabBar: tabBarActionsInStationTabBar,
    isDetailOpen,
    propertiesActionAvailable,
  } = useWorkItemsTabBarState({
    activeTab: state.activeTab,
    showProperties: state.showProperties,
    isActive,
    workStationTabId,
    projectId,
    projectName,
    resolvedProjectSlug,
    selectedWorkItem: data.selectedWorkItem,
    onOpenSearch: handleOpenSearch,
    onToggleProperties: handlers.handleToggleProperties,
    onCreateWorkItem,
    onAddListItem: handlers.handleAddListItem,
    onEmbeddedWorkItemDetailStateChange,
  });

  const detailContent = (
    <EmbeddedWorkItemDetail
      workItem={data.selectedWorkItem ?? null}
      onClose={handleCloseDetail}
      onNavigate={handlers.handleNavigate}
      hasPrev={data.navigation.hasPrev}
      hasNext={data.navigation.hasNext}
      onUpdateWorkItem={handlers.handleUpdate}
      onDeleteWorkItem={handlers.handleDelete}
      availableMembers={projectData.availableMembers}
      availableProjects={projectData.availableProjects}
      availableMilestones={projectData.availableMilestones}
      availableLabels={projectData.availableLabels}
      onPendingChangesChange={setHasWorkItemPendingChanges}
      repoPath={resolvedRepoPath}
      projectSlug={resolvedProjectSlug}
      shortId={selectedShortId}
      onRefreshWorkItem={data.refresh}
      onOpenSession={onOpenChatSession}
      onWorkItemNameUpdated={onEmbeddedWorkItemNameUpdated}
      onExpandWorkItemToTab={onExpandWorkItemToTab}
      breadcrumbProjectName={headerTitle}
      propertiesOpen={workItemPropertiesOpen}
      onToggleProperties={() => setWorkItemPropertiesOpen((prev) => !prev)}
      publishHeaderToWorkstation={tabBarActionsInStationTabBar && isActive}
      workstationHeaderHost={workstationHeaderHost}
    />
  );

  const {
    displayProject,
    handleLocalProjectUpdate,
    handleUpdateProjectMembers,
    handleProjectNameChange,
    handleProjectSummaryChange,
    handleProjectDescriptionChange,
    handleWorkItemPrefixUpdate,
  } = useBufferedProjectProperties({
    projectId,
    sourceProject,
    onProjectUpdate: handlers.handleProjectUpdate,
    hasWorkItemPendingChanges,
    onSetUnsaved,
    onProjectNameUpdated,
  });

  const overviewPropertiesPanel = (
    <OverviewPropertiesPanel
      project={displayProject}
      onUpdate={handleLocalProjectUpdate}
      availableMembers={projectData.availableMembers}
      availableTeams={projectData.availableTeams}
      availableLabels={projectData.availableLabels}
      availableRepos={availableRepos}
    />
  );

  const propertiesPanel = state.showProperties && overviewPropertiesPanel;

  const activeProjectView =
    state.activeTab === "Overview"
      ? PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
      : PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS;
  const isWorkItemsSurface =
    activeProjectView === PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS;

  const handleProjectViewChange = useCallback(
    (nextProjectView: ProjectDetailSurfaceView) => {
      onProjectViewChange?.(nextProjectView);
      handleTabChange(
        nextProjectView === PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
          ? "Overview"
          : "List"
      );
    },
    [handleTabChange, onProjectViewChange]
  );

  const handleHeaderTabChange = useCallback(
    (nextTab: WorkItemsViewTab) => {
      onProjectViewChange?.(
        nextTab === "Overview"
          ? PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW
          : PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS
      );
      handleTabChange(nextTab);
    },
    [handleTabChange, onProjectViewChange]
  );

  const projectSurfaceControls = useMemo(
    () => (
      <ProjectDetailSurfacePillSwitch
        projectView={activeProjectView}
        onProjectViewChange={handleProjectViewChange}
      />
    ),
    [activeProjectView, handleProjectViewChange]
  );

  const settingsContent = (
    <Suspense fallback={<Placeholder variant="loading" />}>
      <WorkItemsSettings
        members={projectData.rawMembers}
        onUpdateMembers={projectData.updateMembers}
        labels={projectData.rawLabels}
        onUpdateLabels={projectData.updateLabels}
        slug={resolvedProjectSlug ?? projectId}
        projectName={projectName}
        workItemPrefix={displayProject.workItemPrefix ?? "PRJ"}
        workItemPrefixCustom={displayProject.workItemPrefixCustom ?? false}
        onUpdateWorkItemPrefix={handleWorkItemPrefixUpdate}
        onDeleteProject={handleDeleteProject}
        projectMembers={displayProject.members ?? []}
        onUpdateProjectMembers={handleUpdateProjectMembers}
        onOpenRepoSettings={onOpenRepoSettings}
        initialSection={pendingSettingsSection}
        onSectionConsumed={handleSettingsSectionConsumed}
      />
    </Suspense>
  );

  const resolvedProjectDescription =
    displayProject.description ?? projectData.project?.description;

  // When a work item is selected, the detail's own header (with the
  // `Project > Item` breadcrumb) replaces the page header. Otherwise the
  // page header with view tabs / status filter is shown.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {!isDetailOpen && (
        <WorkItemsPageHeader
          projectName={headerTitle}
          breadcrumbSegments={breadcrumbSegments}
          onOpenProjects={onOpenProjects}
          activeTab={state.activeTab}
          leadingControls={projectSurfaceControls}
          onTabChange={handleHeaderTabChange}
          statusFilter={isWorkItemsSurface ? state.statusFilter : undefined}
          onStatusFilterChange={
            isWorkItemsSurface
              ? (value) =>
                  state.setStatusFilter(value as typeof state.statusFilter)
              : undefined
          }
          statusCounts={data.statusCounts}
          onCollapseAll={isWorkItemsSurface ? handleCollapseAll : undefined}
          showProperties={
            propertiesActionAvailable ? state.showProperties : undefined
          }
          onToggleProperties={
            propertiesActionAvailable
              ? handlers.handleToggleProperties
              : undefined
          }
          onAddProject={
            isWorkItemsSurface && state.activeTab !== "Settings"
              ? onCreateProject
              : undefined
          }
          onAddWorkItem={
            state.activeTab !== "Settings"
              ? onCreateWorkItem
                ? () =>
                    onCreateWorkItem(
                      projectId,
                      projectName,
                      resolvedProjectSlug ?? projectId
                    )
                : () => handlers.handleAddListItem("backlog")
              : undefined
          }
          onRefresh={isWorkItemsSurface ? data.refresh : undefined}
          refreshLoading={data.loading}
          onSearch={
            isWorkItemsSurface && !tabBarActionsInStationTabBar
              ? handleOpenSearch
              : undefined
          }
          publishToWorkstationHeader={tabBarActionsInStationTabBar && isActive}
          workstationHeaderHost={workstationHeaderHost}
        />
      )}

      {/* Content search spotlight */}
      <ContentSearchPalette
        isOpen={isSearchOpen}
        onClose={handleCloseSearch}
        query={state.searchQuery}
        onQueryChange={(value) => state.setSearchQuery(value)}
        placeholder={t("workItems.searchPlaceholder")}
      />

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkItemsTabContent
          activeTab={state.activeTab}
          groupedWorkItems={data.groupedWorkItems}
          filteredWorkItems={data.filteredWorkItems}
          selectedWorkItem={data.selectedWorkItem ?? null}
          selectedWorkItemId={state.selectedWorkItemId}
          workItems={data.workItems}
          projectName={displayProject.name}
          projectSummary={displayProject.summary}
          projectDescription={resolvedProjectDescription}
          projectProperties={displayProject}
          repoPath={repoPath}
          availableMembers={projectData.availableMembers}
          availableTeams={projectData.availableTeams}
          projectLabels={projectData.availableLabels}
          availableRepos={availableRepos}
          availableProjects={projectData.availableProjects}
          availableMilestones={projectData.availableMilestones}
          availableLabels={projectData.availableLabels}
          overviewStats={data.overviewStats}
          checkedWorkItemIds={selectedIds}
          onCheckedChange={handleCheckedChange}
          onSelectWorkItem={handlers.handleSelect}
          onUpdateWorkItem={handlers.handleUpdate}
          onDeleteWorkItem={handlers.handleDelete}
          onRestoreWorkItem={handlers.handleRestore}
          onAddListItem={(status: WorkItemStatus) =>
            handlers.handleAddListItem(status)
          }
          onProjectNameChange={handleProjectNameChange}
          onProjectSummaryChange={handleProjectSummaryChange}
          onProjectDescriptionChange={handleProjectDescriptionChange}
          onProjectPropertiesChange={handleLocalProjectUpdate}
          onKanbanTaskMove={handlers.handleKanbanTaskMove}
          onKanbanTaskClick={handlers.handleKanbanTaskClick}
          onAddKanbanTask={handlers.handleAddTask}
          onGanttTaskClick={handlers.handleGanttTaskClick}
          onGanttTaskUpdate={handlers.handleGanttTaskUpdate}
          onCalendarEventClick={handlers.handleCalendarEventClick}
          kanbanTasks={data.kanbanTasks}
          ganttTasks={data.ganttTasks}
          calendarEvents={data.calendarEvents}
          detailContent={detailContent}
          propertiesPanel={propertiesPanel}
          settingsContent={settingsContent}
          collapseAllSignal={collapseAllSignal}
          workItemPrefix={getEffectiveWorkItemPrefix(
            displayProject.name,
            displayProject.workItemPrefix,
            displayProject.workItemPrefixCustom
          )}
        />
      </div>

      <MultiSelectBar
        selectedCount={selectedIds.size}
        visibleItemCount={data.filteredWorkItems.length}
        deleting={bulkDeleting}
        onSelectAll={handleSelectAll}
        onUnselectAll={handleUnselectAll}
        onDelete={handleBulkDelete}
      />
    </div>
  );
};

export default WorkItemsPage;
