import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { syncConnectionsApi } from "@src/api/http/integrations";
import { projectApi } from "@src/api/http/project";
import type { ProjectOrg } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { useProjectDataChanged } from "@src/hooks/project";
import { cachedLinearProjectsApi } from "@src/modules/ProjectManager/LinearProjects/linearProjectsCache";
import { linearIssueToWorkItem } from "@src/modules/ProjectManager/LinearProjects/utils";
import {
  createProjectLinearWorkItemsTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs/factories/project";

import { toChatPanelProject, toChatPanelWorkItem } from "./chatPanelMapping";
import {
  buildByOrgMenuItems,
  buildByPriorityMenuItems,
  buildByProjectMenuItems,
  buildByStatusMenuItems,
} from "./groupingBuilders";
import {
  getProjectsLinearLoadOrgId,
  getProjectsLinearOrgGroupId,
  getProjectsLinearWorkItemId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
  isProjectsLinearOrgGroupId,
  isProjectsWorkItemLoadMoreId,
} from "./idHelpers";
import {
  getErrorMessage,
  getLinearOrgId,
  getLinearTeamOrgName,
  isLinearConnection,
} from "./linearHelpers";
import type {
  LinearOrgLoadState,
  LinearOrgRecord,
  SidebarAnyWorkItem,
  SidebarLinearWorkItem,
  SidebarProject,
  SidebarWorkItem,
  UseProjectsWorkItemMenuItemsParams,
  UseProjectsWorkItemMenuItemsResult,
} from "./types";
import { toWorkItemPriority, toWorkItemStatus } from "./workItemMapping";

const logger = createLogger("ProjectsWorkItemSidebar");

export {
  getProjectsLinearLoadOrgId,
  getProjectsLinearOrgGroupId,
  getProjectsLinearWorkItemId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
  isProjectsLinearOrgGroupId,
  isProjectsWorkItemLoadMoreId,
};

export function useProjectsWorkItemMenuItems({
  enabled,
  groupByMode,
  groupVisibleCounts,
}: UseProjectsWorkItemMenuItemsParams): UseProjectsWorkItemMenuItemsResult {
  const { t } = useTranslation(["projects", "common", "navigation"]);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const [localOrgs, setLocalOrgs] = useState<ProjectOrg[]>([]);
  const [localProjects, setLocalProjects] = useState<SidebarProject[]>([]);
  const [workItems, setWorkItems] = useState<SidebarWorkItem[]>([]);
  const [linearOrgs, setLinearOrgs] = useState<LinearOrgRecord[]>([]);
  const [linearWorkItems, setLinearWorkItems] = useState<
    SidebarLinearWorkItem[]
  >([]);
  const [linearOrgLoadStates, setLinearOrgLoadStates] = useState<
    Map<string, LinearOrgLoadState>
  >(new Map());
  const [loading, setLoading] = useState(false);

  const loadLocalWorkItems = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const [orgs, projects] = await Promise.all([
        projectApi.readOrgs(),
        projectApi.readProjects(),
      ]);
      setLocalOrgs(orgs);
      const orgNameById = new Map(
        orgs.map((org) => [
          org.id,
          org.id === STORY_PERSONAL_ORG_FILTER_ID
            ? t("projects:orgs.personalOrg")
            : org.name,
        ])
      );
      const projectResults = await Promise.all(
        projects.map(async (project) => {
          const [viewData, labelsFile, membersFile] = await Promise.all([
            projectApi.readWorkItemsViewData(project.slug),
            projectApi.readLabels(project.slug),
            projectApi.readMembers(project.slug),
          ]);
          const labelMap = new Map(
            labelsFile.labels.map((label) => [label.id, label])
          );
          const memberMap = new Map(
            membersFile.members.map((member) => [member.id, member])
          );
          const orgId = project.meta.org_id || STORY_PERSONAL_ORG_FILTER_ID;
          const orgName =
            orgNameById.get(orgId) ||
            (orgId === STORY_PERSONAL_ORG_FILTER_ID
              ? t("projects:orgs.personalOrg")
              : t("navigation:labels.org", "Org"));
          const projectEntry: SidebarProject = {
            projectData: project,
            orgId,
            orgName,
            labelMap,
            memberMap,
          };
          const projectWorkItems: SidebarWorkItem[] = viewData.items
            .filter((item) => !item.deletedAt)
            .map((item) => ({
              ...item,
              projectId: project.meta.id,
              projectName: project.meta.name,
              projectSlug: project.slug,
              orgId,
              orgName,
              source: "local",
            }));
          return { projectEntry, projectWorkItems };
        })
      );
      setLocalProjects(
        projectResults.map((projectResult) => projectResult.projectEntry)
      );
      setWorkItems(
        projectResults.flatMap(
          (projectResult) => projectResult.projectWorkItems
        )
      );
    } catch (error) {
      logger.error("Failed to load work item sidebar items:", error);
      setLocalOrgs([]);
      setLocalProjects([]);
      setWorkItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  const loadLinearOrgs = useCallback(async () => {
    if (!enabled) return;
    try {
      const connections = (await syncConnectionsApi.list()).filter(
        isLinearConnection
      );
      const teamGroups = await Promise.all(
        connections.map(async (connection) => {
          const teamResult = await cachedLinearProjectsApi.listTeams(
            connection.id
          );
          return teamResult.teams.map(
            (team): LinearOrgRecord => ({
              id: getLinearOrgId(connection.id, team.id),
              connectionId: connection.id,
              teamId: team.id,
              teamName: team.name,
              orgName: getLinearTeamOrgName(team.name),
            })
          );
        })
      );
      setLinearOrgs(teamGroups.flat());
    } catch (error) {
      logger.error("Failed to load Linear sidebar orgs:", error);
      setLinearOrgs([]);
    }
  }, [enabled]);

  const loadLinearOrgWorkItems = useCallback(
    async (org: LinearOrgRecord) => {
      const existingState = linearOrgLoadStates.get(org.id);
      if (existingState?.loading || existingState?.loaded) return;

      setLinearOrgLoadStates((previousStates) => {
        const nextStates = new Map(previousStates);
        nextStates.set(org.id, { loading: true, loaded: false, error: null });
        return nextStates;
      });

      try {
        const projectsResult = await cachedLinearProjectsApi.listProjects(
          org.connectionId
        );
        const visibleProjects = projectsResult.projects.filter((project) =>
          project.teams.some((team) => team.id === org.teamId)
        );
        const issueResults = await Promise.all(
          visibleProjects.map(async (project) => {
            const issueResult = await cachedLinearProjectsApi.listProjectIssues(
              org.connectionId,
              project.id
            );
            return { project, issues: issueResult.issues };
          })
        );
        const nextWorkItems = issueResults.flatMap(({ project, issues }) =>
          issues.map((issue) => {
            const workItem = linearIssueToWorkItem(issue, project);
            return {
              id: `${org.connectionId}:${issue.id}`,
              title: workItem.name,
              status: toWorkItemStatus(
                workItem.workItemStatus ?? workItem.status
              ),
              priority: toWorkItemPriority(workItem.priority ?? "none"),
              projectId: project.id,
              projectName: project.name,
              connectionId: org.connectionId,
              teamId: org.teamId,
              teamName: org.teamName,
              orgId: org.id,
              orgName: org.orgName,
              source: "linear" as const,
            };
          })
        );
        setLinearWorkItems((previousItems) => {
          const remainingItems = previousItems.filter(
            (item) => item.orgId !== org.id
          );
          return [...remainingItems, ...nextWorkItems];
        });
        setLinearOrgLoadStates((previousStates) => {
          const nextStates = new Map(previousStates);
          nextStates.set(org.id, { loading: false, loaded: true, error: null });
          return nextStates;
        });
      } catch (error) {
        logger.error("Failed to load Linear sidebar work items:", error);
        setLinearOrgLoadStates((previousStates) => {
          const nextStates = new Map(previousStates);
          nextStates.set(org.id, {
            loading: false,
            loaded: false,
            error: getErrorMessage(error),
          });
          return nextStates;
        });
      }
    },
    [linearOrgLoadStates]
  );

  useEffect(() => {
    void loadLocalWorkItems();
    void loadLinearOrgs();
  }, [loadLocalWorkItems, loadLinearOrgs]);

  const loadLinearOrgWorkItemsById = useCallback(
    (orgId: string) => {
      const org = linearOrgs.find((candidate) => candidate.id === orgId);
      if (!org) return;
      void loadLinearOrgWorkItems(org);
    },
    [linearOrgs, loadLinearOrgWorkItems]
  );

  useProjectDataChanged(
    useCallback(() => {
      if (enabled) {
        void loadLocalWorkItems();
      }
    }, [enabled, loadLocalWorkItems])
  );

  const projectMap = useMemo(() => {
    const map = new Map<string, SidebarProject>();
    for (const project of localProjects) {
      map.set(project.projectData.slug, project);
    }
    return map;
  }, [localProjects]);

  const workItemMap = useMemo(() => {
    const map = new Map<string, SidebarWorkItem>();
    for (const workItem of workItems) {
      map.set(workItem.id, workItem);
    }
    return map;
  }, [workItems]);

  const linearWorkItemMap = useMemo(() => {
    const map = new Map<string, SidebarLinearWorkItem>();
    for (const workItem of linearWorkItems) {
      map.set(workItem.id, workItem);
    }
    return map;
  }, [linearWorkItems]);

  const allWorkItems = useMemo<SidebarAnyWorkItem[]>(
    () => [...workItems, ...linearWorkItems],
    [linearWorkItems, workItems]
  );

  const menuItems = useMemo(() => {
    const builderContext = {
      allWorkItems,
      groupVisibleCounts,
      t,
    };

    switch (groupByMode) {
      case "byProject":
        return buildByProjectMenuItems(builderContext);
      case "byStatus":
        return buildByStatusMenuItems(builderContext);
      case "byPriority":
        return buildByPriorityMenuItems(builderContext);
      case "byOrg":
      default:
        return buildByOrgMenuItems({
          ...builderContext,
          linearOrgLoadStates,
          linearOrgs,
          localOrgs,
          localProjects,
        });
    }
  }, [
    allWorkItems,
    groupByMode,
    groupVisibleCounts,
    linearOrgLoadStates,
    linearOrgs,
    localOrgs,
    localProjects,
    t,
  ]);

  const openLinearWorkItem = useCallback(
    (workItem: SidebarLinearWorkItem) => {
      const tab = createProjectLinearWorkItemsTab({
        connectionId: workItem.connectionId,
        projectId: workItem.projectId,
        projectName: workItem.projectName,
        teamId: workItem.teamId,
        teamName: workItem.teamName,
      });
      setLayout((layout) => ({
        ...layout,
        mainPane: openTab(layout.mainPane, tab),
      }));
    },
    [setLayout]
  );

  return {
    menuItems,
    projectMap,
    workItemMap,
    linearWorkItemMap,
    loading,
    getLoadMoreGroupId: isProjectsWorkItemLoadMoreId,
    loadLinearOrgWorkItems: loadLinearOrgWorkItemsById,
    toChatPanelProject,
    toChatPanelWorkItem,
    openLinearWorkItem,
  };
}

export type { SidebarLinearWorkItem, SidebarProject, SidebarWorkItem };
