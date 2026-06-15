import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { projectApi } from "@src/api/http/project";
import type { ProjectOrg } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { useProjectDataChanged } from "@src/hooks/project";
import { cachedLinearProjectsApi } from "@src/modules/ProjectManager/LinearProjects/linearProjectsCache";
import { linearIssueToWorkItem } from "@src/modules/ProjectManager/LinearProjects/utils";
import { collabOrgsAtom } from "@src/store/collaboration/collabOrgsAtom";
import {
  PROJECT_ORG_SURFACE_VIEW,
  STORY_ORG_SCOPE,
  createProjectLinearWorkItemsTab,
  createProjectOrgTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs/factories/project";

import { toChatPanelProject, toChatPanelWorkItem } from "./chatPanelMapping";
import { buildByOrgMenuItems } from "./groupingBuilders";
import {
  getProjectsCloudOrgId,
  getProjectsLinearLoadOrgId,
  getProjectsLinearOrgGroupId,
  getProjectsLinearOrgId,
  getProjectsLinearWorkItemId,
  getProjectsLocalOrgId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
  isProjectsLinearOrgGroupId,
  isProjectsWorkItemLoadMoreId,
} from "./idHelpers";
import { getErrorMessage } from "./linearHelpers";
import type {
  LinearOrgLoadState,
  LinearOrgRecord,
  SidebarAnyWorkItem,
  SidebarLinearWorkItem,
  SidebarLocalOrgRecord,
  SidebarProject,
  SidebarWorkItem,
  UseProjectsWorkItemMenuItemsParams,
  UseProjectsWorkItemMenuItemsResult,
} from "./types";
import { toWorkItemPriority, toWorkItemStatus } from "./workItemMapping";

const logger = createLogger("ProjectsWorkItemSidebar");

export {
  getProjectsCloudOrgId,
  getProjectsLinearLoadOrgId,
  getProjectsLinearOrgGroupId,
  getProjectsLinearOrgId,
  getProjectsLinearWorkItemId,
  getProjectsLocalOrgId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
  isProjectsLinearOrgGroupId,
  isProjectsWorkItemLoadMoreId,
};

export function useProjectsWorkItemMenuItems({
  enabled,
  groupVisibleCounts,
  searchQuery = "",
}: UseProjectsWorkItemMenuItemsParams): UseProjectsWorkItemMenuItemsResult {
  const { t } = useTranslation(["projects", "common", "navigation"]);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const collabOrgs = useAtomValue(collabOrgsAtom);
  const [localOrgs, setLocalOrgs] = useState<ProjectOrg[]>([]);
  const [localProjects, setLocalProjects] = useState<SidebarProject[]>([]);
  const [workItems, setWorkItems] = useState<SidebarWorkItem[]>([]);
  const [linearOrgs] = useState<LinearOrgRecord[]>([]);
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
      const orgNameById = new Map<string, string>([
        [STORY_PERSONAL_ORG_FILTER_ID, t("projects:orgs.personalOrg")],
        ...orgs.map((org) => [org.id, org.name] as const),
      ]);
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
  }, [loadLocalWorkItems]);

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

  const localOrgMap = useMemo(() => {
    const map = new Map<string, SidebarLocalOrgRecord>();
    map.set(STORY_PERSONAL_ORG_FILTER_ID, {
      id: STORY_PERSONAL_ORG_FILTER_ID,
      name: t("projects:orgs.personalOrg"),
    });
    for (const org of localOrgs) {
      map.set(org.id, {
        id: org.id,
        name: org.name,
        sync_provider: org.sync_provider,
      });
    }
    for (const project of localProjects) {
      if (map.has(project.orgId)) continue;
      map.set(project.orgId, {
        id: project.orgId,
        name: project.orgName,
      });
    }
    return map;
  }, [localOrgs, localProjects, t]);

  const cloudOrgMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const org of collabOrgs) {
      map.set(org.id, { id: org.id, name: org.name });
    }
    return map;
  }, [collabOrgs]);

  const linearOrgMap = useMemo(() => {
    const map = new Map<string, LinearOrgRecord>();
    for (const org of linearOrgs) {
      map.set(org.id, org);
    }
    return map;
  }, [linearOrgs]);

  const allWorkItems = useMemo<SidebarAnyWorkItem[]>(
    () => [...workItems],
    [workItems]
  );

  const menuItems = useMemo(
    () =>
      buildByOrgMenuItems({
        allWorkItems,
        groupVisibleCounts,
        searchQuery,
        t,
        cloudOrgs: collabOrgs,
        localOrgs,
        localProjects,
      }),
    [
      allWorkItems,
      groupVisibleCounts,
      searchQuery,
      t,
      collabOrgs,
      localOrgs,
      localProjects,
    ]
  );

  const openLocalOrg = useCallback(
    (org: SidebarLocalOrgRecord) => {
      const orgScope =
        org.id === STORY_PERSONAL_ORG_FILTER_ID
          ? STORY_ORG_SCOPE.PERSONAL_ORG
          : STORY_ORG_SCOPE.PROJECT_ORG;
      const tab = createProjectOrgTab(
        {
          id: org.id,
          name: org.name,
          sync_provider: org.sync_provider,
        },
        PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS,
        orgScope
      );
      setLayout((layout) => ({
        ...layout,
        mainPane: openTab(layout.mainPane, tab),
      }));
    },
    [setLayout]
  );

  const openLinearOrg = useCallback(
    (org: LinearOrgRecord) => {
      const tab = createProjectLinearWorkItemsTab({
        connectionId: org.connectionId,
        teamId: org.teamId,
        teamName: org.teamName,
      });
      setLayout((layout) => ({
        ...layout,
        mainPane: openTab(layout.mainPane, tab),
      }));
    },
    [setLayout]
  );

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
    localOrgMap,
    cloudOrgMap,
    linearOrgMap,
    loading,
    getLoadMoreGroupId: isProjectsWorkItemLoadMoreId,
    loadLinearOrgWorkItems: loadLinearOrgWorkItemsById,
    toChatPanelProject,
    toChatPanelWorkItem,
    openLocalOrg,
    openLinearOrg,
    openLinearWorkItem,
  };
}

export type { SidebarLinearWorkItem, SidebarProject, SidebarWorkItem };
