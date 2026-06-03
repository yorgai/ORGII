import { useSetAtom } from "jotai";
import { Loader2, MoreHorizontal, SquarePen } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  STORY_SYNC_ADAPTER,
  type SyncConnection,
  syncConnectionsApi,
} from "@src/api/http/integrations";
import { enrichedWorkItemToUI, projectApi } from "@src/api/http/project";
import type { EnrichedWorkItem, ProjectOrg } from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { useProjectDataChanged } from "@src/hooks/project";
import { cachedLinearProjectsApi } from "@src/modules/ProjectManager/LinearProjects/linearProjectsCache";
import { linearIssueToWorkItem } from "@src/modules/ProjectManager/LinearProjects/utils";
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  getWorkItemStatusConfig,
} from "@src/modules/ProjectManager/config/manage";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { SESSION_SIDEBAR_PAGE_SIZE } from "@src/store/session";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanelAtom";
import {
  createProjectLinearWorkItemsTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs/factories/project";
import type {
  WorkItemPriority,
  WorkItemStatus,
} from "@src/types/core/workItem";

import { PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID } from "./sidebarConnectorUtils";
import { LOAD_MORE_GROUP_PREFIX, type ProjectsGroupByMode } from "./types";

const logger = createLogger("ProjectsWorkItemSidebar");

const PROJECTS_WORK_ITEM_PREFIX = "projects-work-item:";
const PROJECTS_LINEAR_WORK_ITEM_PREFIX = "projects-linear-work-item:";
const PROJECTS_LINEAR_LOAD_PREFIX = "projects-linear-load:";
const PROJECTS_WORK_ITEM_CREATE_PREFIX = `${PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID}:`;
const PROJECTS_WORK_ITEM_GROUP_PREFIX = "projects-work-items:";
const UNKNOWN_ORG_KEY = "__unknown_org__";
const UNKNOWN_PROJECT_KEY = "__unknown_project__";
const WORK_ITEM_STATUS_ORDER: readonly WorkItemStatus[] = [
  "in_progress",
  "in_review",
  "planned",
  "backlog",
  "completed",
  "cancelled",
  "duplicate",
];
const WORK_ITEM_PRIORITY_ORDER: readonly WorkItemPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

interface SidebarWorkItem extends EnrichedWorkItem {
  projectId: string;
  projectName: string;
  projectSlug: string;
  orgId: string;
  orgName: string;
  source: "local";
}

interface SidebarLinearWorkItem {
  id: string;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  projectId: string;
  projectName: string;
  connectionId: string;
  teamId?: string;
  teamName?: string;
  orgId: string;
  orgName: string;
  source: "linear";
}

type SidebarAnyWorkItem = SidebarWorkItem | SidebarLinearWorkItem;

interface LinearOrgRecord {
  id: string;
  connectionId: string;
  teamId: string;
  teamName: string;
  orgName: string;
}

interface LinearOrgLoadState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

interface UseProjectsWorkItemMenuItemsParams {
  enabled: boolean;
  groupByMode: ProjectsGroupByMode;
  groupVisibleCounts: ReadonlyMap<string, number>;
}

interface UseProjectsWorkItemMenuItemsResult {
  menuItems: NavigationMenuItem[];
  workItemMap: Map<string, SidebarWorkItem>;
  linearWorkItemMap: Map<string, SidebarLinearWorkItem>;
  loading: boolean;
  getLoadMoreGroupId: (id: string) => string | null;
  loadLinearOrgWorkItems: (orgId: string) => void;
  toChatPanelWorkItem: (workItem: SidebarWorkItem) => ChatPanelSelectedWorkItem;
  openLinearWorkItem: (workItem: SidebarLinearWorkItem) => void;
}

function separator(id: string, title = ""): NavigationMenuItem {
  return { id: `separator-${id}`, key: `separator-${id}`, label: title };
}

function groupLoadMoreRow(groupId: string, label: string): NavigationMenuItem {
  return {
    id: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    key: `${LOAD_MORE_GROUP_PREFIX}${groupId}`,
    label,
    icon: MoreHorizontal,
    iconName: "more-horizontal",
    visualTone: "secondary",
  };
}

function linearLoadRow(
  orgId: string,
  label: string,
  loading: boolean
): NavigationMenuItem {
  return {
    id: `${PROJECTS_LINEAR_LOAD_PREFIX}${orgId}`,
    key: `${PROJECTS_LINEAR_LOAD_PREFIX}${orgId}`,
    label,
    icon: loading ? undefined : MoreHorizontal,
    iconName: loading ? undefined : "more-horizontal",
    iconElement: loading ? (
      <Loader2 size={14} strokeWidth={2} className="animate-spin" />
    ) : undefined,
    visualTone: "secondary",
    disabled: loading,
  };
}

function createWorkItemRow(orgId: string, label: string): NavigationMenuItem {
  const id = `${PROJECTS_WORK_ITEM_CREATE_PREFIX}${orgId}`;
  return {
    id,
    key: id,
    label,
    icon: SquarePen,
    iconName: "square-pen",
    visualTone: "secondary",
    dataTestId: `projects-work-item-create-${orgId}`,
  };
}

function getWorkItemMenuItemId(workItemId: string): string {
  return `${PROJECTS_WORK_ITEM_PREFIX}${workItemId}`;
}

function getLinearWorkItemMenuItemId(workItemId: string): string {
  return `${PROJECTS_LINEAR_WORK_ITEM_PREFIX}${workItemId}`;
}

export function getProjectsWorkItemId(menuItemId: string): string | null {
  if (!menuItemId.startsWith(PROJECTS_WORK_ITEM_PREFIX)) return null;
  return menuItemId.slice(PROJECTS_WORK_ITEM_PREFIX.length) || null;
}

export function getProjectsLinearWorkItemId(menuItemId: string): string | null {
  if (!menuItemId.startsWith(PROJECTS_LINEAR_WORK_ITEM_PREFIX)) return null;
  return menuItemId.slice(PROJECTS_LINEAR_WORK_ITEM_PREFIX.length) || null;
}

export function getProjectsLinearLoadOrgId(menuItemId: string): string | null {
  if (!menuItemId.startsWith(PROJECTS_LINEAR_LOAD_PREFIX)) return null;
  return menuItemId.slice(PROJECTS_LINEAR_LOAD_PREFIX.length) || null;
}

export function getProjectsWorkItemCreateOrgId(
  menuItemId: string
): string | null {
  if (!menuItemId.startsWith(PROJECTS_WORK_ITEM_CREATE_PREFIX)) return null;
  return menuItemId.slice(PROJECTS_WORK_ITEM_CREATE_PREFIX.length) || null;
}

export function isProjectsWorkItemLoadMoreId(id: string): string | null {
  if (!id.startsWith(LOAD_MORE_GROUP_PREFIX)) return null;
  const groupId = id.slice(LOAD_MORE_GROUP_PREFIX.length);
  if (!groupId.startsWith(PROJECTS_WORK_ITEM_GROUP_PREFIX)) return null;
  return groupId;
}

function isWorkItemStatus(status: string): status is WorkItemStatus {
  return WORK_ITEM_STATUS_ORDER.includes(status as WorkItemStatus);
}

function toWorkItemStatus(status: string): WorkItemStatus {
  return isWorkItemStatus(status) ? status : "backlog";
}

function isWorkItemPriority(priority: string): priority is WorkItemPriority {
  return WORK_ITEM_PRIORITY_ORDER.includes(priority as WorkItemPriority);
}

function toWorkItemPriority(priority: string): WorkItemPriority {
  return isWorkItemPriority(priority) ? priority : "none";
}

function statusIconElement(status: WorkItemStatus): React.ReactElement {
  const config = getWorkItemStatusConfig(status);
  return (
    <span
      className="inline-flex items-center leading-none"
      style={{ color: config.color }}
    >
      {config.icon}
    </span>
  );
}

function sortWorkItemsByActivity<T extends SidebarAnyWorkItem>(
  workItems: readonly T[]
): T[] {
  return workItems.slice().sort((itemA, itemB) => {
    const getTime = (item: SidebarAnyWorkItem) =>
      item.source === "local"
        ? new Date(item.updatedAt || item.createdAt).getTime()
        : 0;
    return getTime(itemB) - getTime(itemA);
  });
}

function pushGroupedItems(
  groups: Map<string, SidebarAnyWorkItem[]>,
  key: string,
  workItem: SidebarAnyWorkItem
) {
  const bucket = groups.get(key);
  if (bucket) {
    bucket.push(workItem);
  } else {
    groups.set(key, [workItem]);
  }
}

function getLinearOrgId(connectionId: string, teamId: string): string {
  return `linear:${connectionId}:${teamId}`;
}

function getLinearTeamOrgName(teamName: string): string {
  return `Linear / ${teamName}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLinearConnection(connection: SyncConnection): boolean {
  return connection.adapter_id === STORY_SYNC_ADAPTER.LINEAR;
}

export function getProjectsLinearOrgGroupId(orgId: string): string {
  return `${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:${orgId}`;
}

export function isProjectsLinearOrgGroupId(groupId: string): boolean {
  return groupId.startsWith(`${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:linear:`);
}

export function useProjectsWorkItemMenuItems({
  enabled,
  groupByMode,
  groupVisibleCounts,
}: UseProjectsWorkItemMenuItemsParams): UseProjectsWorkItemMenuItemsResult {
  const { t } = useTranslation(["projects", "common", "navigation"]);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const [localOrgs, setLocalOrgs] = useState<ProjectOrg[]>([]);
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
      const results = await Promise.all(
        projects.map(async (project): Promise<SidebarWorkItem[]> => {
          const viewData = await projectApi.readWorkItemsViewData(project.slug);
          const orgId = project.meta.org_id || STORY_PERSONAL_ORG_FILTER_ID;
          const orgName =
            orgNameById.get(orgId) ||
            (orgId === STORY_PERSONAL_ORG_FILTER_ID
              ? t("projects:orgs.personalOrg")
              : t("navigation:labels.org", "Org"));
          return viewData.items
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
        })
      );
      setWorkItems(results.flat());
    } catch (error) {
      logger.error("Failed to load work item sidebar items:", error);
      setLocalOrgs([]);
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

  const buildWorkItemRow = useCallback(
    (workItem: SidebarAnyWorkItem): NavigationMenuItem => {
      return {
        id:
          workItem.source === "local"
            ? getWorkItemMenuItemId(workItem.id)
            : getLinearWorkItemMenuItemId(workItem.id),
        key:
          workItem.source === "local"
            ? getWorkItemMenuItemId(workItem.id)
            : getLinearWorkItemMenuItemId(workItem.id),
        label:
          workItem.source === "local"
            ? workItem.title || t("projects:workItems.untitledWorkItem")
            : workItem.title || t("projects:workItems.untitledWorkItem"),
        iconElement: statusIconElement(toWorkItemStatus(workItem.status)),
        dataTestId: `sidebar-work-item-${workItem.id}`,
      };
    },
    [t]
  );

  const appendGroupItems = useCallback(
    (
      items: NavigationMenuItem[],
      groupId: string,
      groupItems: readonly SidebarAnyWorkItem[]
    ) => {
      const visibleCount =
        groupVisibleCounts.get(groupId) ?? SESSION_SIDEBAR_PAGE_SIZE;
      const visibleItems = groupItems.slice(0, visibleCount);
      for (const workItem of visibleItems) {
        items.push(buildWorkItemRow(workItem));
      }
      if (groupItems.length > visibleItems.length) {
        items.push(groupLoadMoreRow(groupId, t("common:actions.loadMore")));
      }
    },
    [buildWorkItemRow, groupVisibleCounts, t]
  );

  const allWorkItems = useMemo<SidebarAnyWorkItem[]>(
    () => [...workItems, ...linearWorkItems],
    [linearWorkItems, workItems]
  );

  const byOrgMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<string, SidebarAnyWorkItem[]>();
    for (const workItem of sortWorkItemsByActivity(allWorkItems)) {
      pushGroupedItems(groups, workItem.orgId || UNKNOWN_ORG_KEY, workItem);
    }

    const localOrgNameById = new Map(
      localOrgs.map((org) => [
        org.id,
        org.id === STORY_PERSONAL_ORG_FILTER_ID
          ? t("projects:orgs.personalOrg")
          : org.name,
      ])
    );
    const localKeySet = new Set(
      Array.from(groups.keys()).filter((key) => !key.startsWith("linear:"))
    );
    for (const org of localOrgs) {
      localKeySet.add(org.id);
    }
    const localKeys = Array.from(localKeySet).sort((keyA, keyB) => {
      if (keyA === STORY_PERSONAL_ORG_FILTER_ID) return -1;
      if (keyB === STORY_PERSONAL_ORG_FILTER_ID) return 1;
      if (keyA === UNKNOWN_ORG_KEY) return 1;
      if (keyB === UNKNOWN_ORG_KEY) return -1;
      const labelA =
        groups.get(keyA)?.[0]?.orgName ?? localOrgNameById.get(keyA) ?? keyA;
      const labelB =
        groups.get(keyB)?.[0]?.orgName ?? localOrgNameById.get(keyB) ?? keyB;
      return labelA.localeCompare(labelB);
    });
    const linearKeys = linearOrgs
      .map((org) => org.id)
      .sort((keyA, keyB) => {
        const labelA =
          linearOrgs.find((org) => org.id === keyA)?.orgName ?? keyA;
        const labelB =
          linearOrgs.find((org) => org.id === keyB)?.orgName ?? keyB;
        return labelA.localeCompare(labelB);
      });

    const items: NavigationMenuItem[] = [];
    for (const key of [...localKeys, ...linearKeys]) {
      const linearOrg = linearOrgs.find((org) => org.id === key);
      const groupItems = groups.get(key) ?? [];
      const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:${key}`;
      const title =
        linearOrg?.orgName ??
        groupItems[0]?.orgName ??
        localOrgNameById.get(key) ??
        (key === STORY_PERSONAL_ORG_FILTER_ID
          ? t("projects:orgs.personalOrg")
          : key);
      items.push(separator(groupId, title));
      if (linearOrg) {
        const loadState = linearOrgLoadStates.get(linearOrg.id);
        if (!loadState?.loaded || loadState.loading || loadState.error) {
          items.push(
            linearLoadRow(
              linearOrg.id,
              loadState?.error ??
                (loadState?.loading
                  ? t("common:actions.loading")
                  : t("common:actions.load")),
              Boolean(loadState?.loading)
            )
          );
          continue;
        }
      }
      if (groupItems.length === 0) {
        items.push(createWorkItemRow(key, t("projects:workItems.newWorkItem")));
        continue;
      }
      appendGroupItems(items, groupId, groupItems);
    }
    return items;
  }, [
    allWorkItems,
    appendGroupItems,
    linearOrgLoadStates,
    linearOrgs,
    localOrgs,
    t,
  ]);

  const byProjectMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<string, SidebarAnyWorkItem[]>();
    for (const workItem of sortWorkItemsByActivity(allWorkItems)) {
      pushGroupedItems(
        groups,
        workItem.projectId || UNKNOWN_PROJECT_KEY,
        workItem
      );
    }

    const orderedKeys = Array.from(groups.keys()).sort((keyA, keyB) => {
      if (keyA === UNKNOWN_PROJECT_KEY) return 1;
      if (keyB === UNKNOWN_PROJECT_KEY) return -1;
      const labelA = groups.get(keyA)?.[0]?.projectName ?? keyA;
      const labelB = groups.get(keyB)?.[0]?.projectName ?? keyB;
      return labelA.localeCompare(labelB);
    });

    const items: NavigationMenuItem[] = [];
    for (const key of orderedKeys) {
      const groupItems = groups.get(key) ?? [];
      if (groupItems.length === 0) continue;
      const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}project:${key}`;
      items.push(separator(groupId, groupItems[0]?.projectName ?? key));
      appendGroupItems(items, groupId, groupItems);
    }
    return items;
  }, [allWorkItems, appendGroupItems]);

  const byStatusMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<WorkItemStatus, SidebarAnyWorkItem[]>();
    for (const status of WORK_ITEM_STATUS_ORDER) {
      groups.set(status, []);
    }

    for (const workItem of sortWorkItemsByActivity(allWorkItems)) {
      groups.get(toWorkItemStatus(workItem.status))?.push(workItem);
    }

    const items: NavigationMenuItem[] = [];
    for (const status of WORK_ITEM_STATUS_ORDER) {
      const groupItems = groups.get(status) ?? [];
      if (groupItems.length === 0) continue;
      const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}status:${status}`;
      items.push(
        separator(groupId, t(`projects:workItems.statusLabels.${status}`))
      );
      appendGroupItems(items, groupId, groupItems);
    }
    return items;
  }, [allWorkItems, appendGroupItems, t]);

  const byPriorityMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const groups = new Map<WorkItemPriority, SidebarAnyWorkItem[]>();
    for (const priority of WORK_ITEM_PRIORITY_ORDER) {
      groups.set(priority, []);
    }

    for (const workItem of sortWorkItemsByActivity(allWorkItems)) {
      groups.get(toWorkItemPriority(workItem.priority))?.push(workItem);
    }

    const items: NavigationMenuItem[] = [];
    for (const priority of WORK_ITEM_PRIORITY_ORDER) {
      const groupItems = groups.get(priority) ?? [];
      if (groupItems.length === 0) continue;
      const priorityConfig = WORK_ITEM_PRIORITY_OPTIONS.find(
        (option) => option.value === priority
      );
      const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}priority:${priority}`;
      items.push(
        separator(
          groupId,
          t(`projects:workItems.priorityLabels.${priority}`, {
            defaultValue: priorityConfig?.label ?? priority,
          })
        )
      );
      appendGroupItems(items, groupId, groupItems);
    }
    return items;
  }, [allWorkItems, appendGroupItems, t]);

  const menuItems = useMemo<NavigationMenuItem[]>(() => {
    switch (groupByMode) {
      case "byProject":
        return byProjectMenuItems;
      case "byStatus":
        return byStatusMenuItems;
      case "byPriority":
        return byPriorityMenuItems;
      case "byOrg":
      default:
        return byOrgMenuItems;
    }
  }, [
    byOrgMenuItems,
    byPriorityMenuItems,
    byProjectMenuItems,
    byStatusMenuItems,
    groupByMode,
  ]);

  const toChatPanelWorkItem = useCallback(
    (workItem: SidebarWorkItem): ChatPanelSelectedWorkItem => ({
      workItem: enrichedWorkItemToUI(workItem),
      projectId: workItem.projectId,
      projectName: workItem.projectName,
      projectSlug: workItem.projectSlug,
      shortId: workItem.shortId,
    }),
    []
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
    workItemMap,
    linearWorkItemMap,
    loading,
    getLoadMoreGroupId: isProjectsWorkItemLoadMoreId,
    loadLinearOrgWorkItems: loadLinearOrgWorkItemsById,
    toChatPanelWorkItem,
    openLinearWorkItem,
  };
}

export type { SidebarLinearWorkItem, SidebarWorkItem };
