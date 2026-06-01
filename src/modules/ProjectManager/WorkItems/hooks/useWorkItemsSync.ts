import { emit } from "@tauri-apps/api/event";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import { type MemberEntry, projectApi } from "@src/api/http/project";
import Message from "@src/components/Message";
import type { ProjectData } from "@src/modules/ProjectManager/shared";
import { projectStatusBarStateAtom } from "@src/store/ui/workStationAtom";

interface UseWorkItemsSyncParams {
  project: ProjectData | null;
  projectName: string;
  rawMembers: MemberEntry[];
  workItemCount: number;
  onProjectDeleted?: () => void;
}

interface UseWorkItemsSyncReturn {
  handleDeleteProject: () => Promise<void>;
}

/**
 * Manages project-specific status bar fields and project deletion.
 *
 * Note: this hook keeps the legacy filename for now — sync (push/pull)
 * is gone, but the status-bar wiring + delete handler still live here.
 */
export function useWorkItemsSync({
  project,
  projectName,
  rawMembers,
  workItemCount,
  onProjectDeleted,
}: UseWorkItemsSyncParams): UseWorkItemsSyncReturn {
  const setGlobalStatusBarState = useSetAtom(projectStatusBarStateAtom);

  const activeMemberCount = useMemo(
    () => rawMembers.filter((member) => member.active).length,
    [rawMembers]
  );

  const handleDeleteProject = useCallback(async () => {
    if (!project) return;

    const projectSlug =
      project.slug ||
      project.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    try {
      await projectApi.deleteProject(projectSlug);
      await emit("orgii-data-changed");
      onProjectDeleted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[WorkItemsPage] Failed to delete project:", error);
      Message.error(message);
    }
  }, [onProjectDeleted, project]);

  useEffect(() => {
    setGlobalStatusBarState((prev) => ({
      ...prev,
      projectName: projectName || undefined,
      projectActiveMemberCount: activeMemberCount,
      projectTotalMemberCount: rawMembers.length,
      projectWorkItemCount: workItemCount,
    }));

    return () => {
      setGlobalStatusBarState((prev) => ({
        ...prev,
        projectName: undefined,
        projectActiveMemberCount: undefined,
        projectTotalMemberCount: undefined,
        projectWorkItemCount: undefined,
      }));
    };
  }, [
    activeMemberCount,
    projectName,
    rawMembers.length,
    setGlobalStatusBarState,
    workItemCount,
  ]);

  return {
    handleDeleteProject,
  };
}
