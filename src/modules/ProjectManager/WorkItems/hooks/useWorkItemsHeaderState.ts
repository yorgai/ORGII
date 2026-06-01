import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ProjectData } from "@src/modules/ProjectManager/shared";

interface UseWorkItemsHeaderStateParams {
  pageTitle?: string;
  tabProjectName: string;
  project?: ProjectData | null;
  projectLoading: boolean;
}

export function useWorkItemsHeaderState({
  pageTitle,
  tabProjectName,
  project,
  projectLoading,
}: UseWorkItemsHeaderStateParams) {
  const { t } = useTranslation("projects");

  const projectName = projectLoading
    ? tabProjectName
    : (project?.name ?? tabProjectName ?? t("workItems.untitledProject"));
  const headerTitle = pageTitle ?? projectName;

  const defaultProject = useMemo<ProjectData>(
    () => ({
      id: "",
      name: projectName,
      status: "backlog",
      priority: "none",
      health: "no_updates",
      members: [],
      teams: [],
      labels: [],
    }),
    [projectName]
  );

  const sourceProject = project ?? defaultProject;

  return {
    projectName,
    headerTitle,
    sourceProject,
  };
}
