import type { TFunction } from "i18next";
import { ListChevronsDownUp } from "lucide-react";
import React, { useCallback } from "react";

import { SessionFilterButton } from "../SessionFilterButton";
import {
  GROUP_BY_MODES,
  type GroupByMode,
  PROJECTS_GROUP_BY_MODES,
  type ProjectsGroupByMode,
} from "../types";
import type { WorkstationSidebarKey } from "./types";

interface UseSidebarBottomRightActionsParams {
  activeSidebarKey: WorkstationSidebarKey;
  defaultedProjectsLinearSectionIdsRef: React.MutableRefObject<Set<string>>;
  groupByMode: GroupByMode;
  handleCollapseAll: () => void;
  handleCollapseAllActiveSections: () => void;
  handleMarkAllRead: () => void;
  handleRefreshSessions: () => void;
  onJoinSharedSession: () => void;
  projectsGroupByMode: ProjectsGroupByMode;
  setGroupByMode: (mode: GroupByMode) => void;
  setProjectsCollapsedSectionIds: (ids: Set<string>) => void;
  setProjectsGroupByMode: (mode: ProjectsGroupByMode) => void;
  setProjectsGroupVisibleCounts: (counts: Map<string, number>) => void;
  setProjectsSelectedMenuItemId: (id: string) => void;
  t: TFunction<"navigation">;
  tProjects: TFunction<"projects">;
}

export function useSidebarBottomRightActions({
  activeSidebarKey,
  defaultedProjectsLinearSectionIdsRef,
  groupByMode,
  handleCollapseAll,
  handleCollapseAllActiveSections,
  handleMarkAllRead,
  handleRefreshSessions,
  onJoinSharedSession,
  projectsGroupByMode,
  setGroupByMode,
  setProjectsCollapsedSectionIds,
  setProjectsGroupByMode,
  setProjectsGroupVisibleCounts,
  setProjectsSelectedMenuItemId,
  t,
  tProjects,
}: UseSidebarBottomRightActionsParams): React.ReactNode {
  const getProjectsGroupByLabel = useCallback(
    (mode: string) => {
      switch (mode) {
        case "byProject":
          return tProjects("projects.groupBy.project");
        case "byStatus":
          return tProjects("projects.groupBy.status");
        case "byPriority":
          return tProjects("projects.groupBy.priority");
        case "byOrg":
        default:
          return tProjects("projects.groupBy.org");
      }
    },
    [tProjects]
  );

  const handleSessionGroupBySelect = useCallback(
    (mode: string) => {
      if (!GROUP_BY_MODES.includes(mode as GroupByMode)) {
        return;
      }
      setGroupByMode(mode as GroupByMode);
    },
    [setGroupByMode]
  );

  const handleProjectsGroupBySelect = useCallback(
    (mode: string) => {
      if (!PROJECTS_GROUP_BY_MODES.includes(mode as ProjectsGroupByMode)) {
        return;
      }
      setProjectsGroupByMode(mode as ProjectsGroupByMode);
      setProjectsSelectedMenuItemId("");
      setProjectsGroupVisibleCounts(new Map());
      setProjectsCollapsedSectionIds(new Set());
      defaultedProjectsLinearSectionIdsRef.current.clear();
    },
    [
      defaultedProjectsLinearSectionIdsRef,
      setProjectsCollapsedSectionIds,
      setProjectsGroupByMode,
      setProjectsGroupVisibleCounts,
      setProjectsSelectedMenuItemId,
    ]
  );

  if (activeSidebarKey === "projects") {
    return (
      <SessionFilterButton
        groupByMode={projectsGroupByMode}
        groupByModes={PROJECTS_GROUP_BY_MODES}
        getGroupByLabel={getProjectsGroupByLabel}
        onSelect={handleProjectsGroupBySelect}
      />
    );
  }

  if (activeSidebarKey === "folders") {
    const collapseAllLabel = t("sidebar.actions.collapseAll");
    return (
      <button
        type="button"
        title={collapseAllLabel}
        aria-label={collapseAllLabel}
        className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
        onClick={handleCollapseAllActiveSections}
      >
        <ListChevronsDownUp size={16} strokeWidth={2} className="text-text-2" />
      </button>
    );
  }

  return (
    <SessionFilterButton
      groupByMode={groupByMode}
      onSelect={handleSessionGroupBySelect}
      onCollapseAll={handleCollapseAll}
      onMarkAllRead={handleMarkAllRead}
      onRefreshSessions={handleRefreshSessions}
      onJoinSharedSession={onJoinSharedSession}
    />
  );
}
