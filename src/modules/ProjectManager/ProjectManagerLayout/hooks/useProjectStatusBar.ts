/**
 * useProjectStatusBar
 *
 * Synchronizes project-level state to the global WorkStation status bar:
 * - Active project slug for the sync status widget
 * - Clears project-specific fields when switching away from work-items tabs
 */
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { projectStatusBarStateAtom } from "@src/store/ui/workStationAtom";

interface UseProjectStatusBarOptions {
  activeTabType: string | undefined;
  /**
   * Slug of the project owning the active work-items tab. Undefined when
   * no project tab is active or the slug hasn't been resolved yet.
   */
  projectSlug: string | undefined;
  projectOrgId: string | undefined;
  projectOrgName: string | undefined;
  projectOrgGitFolderSyncEnabled: boolean;
}

export function useProjectStatusBar({
  activeTabType,
  projectSlug,
  projectOrgId,
  projectOrgName,
  projectOrgGitFolderSyncEnabled,
}: UseProjectStatusBarOptions): void {
  const setGlobalStatusBarState = useSetAtom(projectStatusBarStateAtom);

  useEffect(() => {
    setGlobalStatusBarState((prev) => ({
      ...prev,
      appType: "project" as const,
      cursor: null,
      filePath: null,
      totalLines: undefined,
      repoName: undefined,
      projectName: undefined,
    }));
  }, [setGlobalStatusBarState]);

  useEffect(() => {
    const isProjectTab =
      activeTabType === "project-workitems" ||
      activeTabType === "project-dashboard" ||
      activeTabType === "project-work-items";

    if (isProjectTab) {
      setGlobalStatusBarState((prev) => ({
        ...prev,
        projectSlug,
        projectOrgId,
        projectOrgName,
        projectOrgGitFolderSyncEnabled,
      }));
      return;
    }
    setGlobalStatusBarState((prev) => ({
      ...prev,
      projectName: undefined,
      projectActiveMemberCount: undefined,
      projectTotalMemberCount: undefined,
      projectWorkItemCount: undefined,
      projectOrgId: undefined,
      projectOrgName: undefined,
      projectOrgGitFolderSyncEnabled: undefined,
      projectSlug: undefined,
    }));
  }, [
    activeTabType,
    projectOrgGitFolderSyncEnabled,
    projectOrgId,
    projectOrgName,
    projectSlug,
    setGlobalStatusBarState,
  ]);
}
