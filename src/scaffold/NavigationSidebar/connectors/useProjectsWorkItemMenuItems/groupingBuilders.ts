import type { TFunction } from "i18next";

import { WORK_ITEM_PRIORITY_OPTIONS } from "@src/modules/ProjectManager/config/manage";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { SESSION_SIDEBAR_PAGE_SIZE } from "@src/store/session";
import { STORY_PERSONAL_ORG_FILTER_ID } from "@src/store/workstation/tabs/factories/project";
import type {
  WorkItemPriority,
  WorkItemStatus,
} from "@src/types/core/workItem";

import {
  PROJECTS_WORK_ITEM_GROUP_PREFIX,
  UNKNOWN_ORG_KEY,
  UNKNOWN_PROJECT_KEY,
  WORK_ITEM_PRIORITY_ORDER,
  WORK_ITEM_STATUS_ORDER,
} from "./constants";
import {
  buildProjectOverviewRow,
  buildWorkItemRow,
  createWorkItemRow,
  groupLoadMoreRow,
  linearLoadRow,
  separator,
} from "./menuRows";
import type {
  LinearOrgLoadState,
  LinearOrgRecord,
  SidebarAnyWorkItem,
  SidebarProject,
  SidebarWorkItem,
} from "./types";
import {
  pushGroupedItems,
  sortWorkItemsByActivity,
  toWorkItemPriority,
  toWorkItemStatus,
} from "./workItemMapping";

interface GroupingBuilderContext {
  allWorkItems: readonly SidebarAnyWorkItem[];
  groupVisibleCounts: ReadonlyMap<string, number>;
  t: TFunction;
}

interface OrgGroupingBuilderContext extends GroupingBuilderContext {
  linearOrgLoadStates: ReadonlyMap<string, LinearOrgLoadState>;
  linearOrgs: readonly LinearOrgRecord[];
  localOrgs: readonly { id: string; name: string }[];
  localProjects: readonly SidebarProject[];
}

function appendGroupItems(
  items: NavigationMenuItem[],
  groupId: string,
  groupItems: readonly SidebarAnyWorkItem[],
  context: GroupingBuilderContext
) {
  const visibleCount =
    context.groupVisibleCounts.get(groupId) ?? SESSION_SIDEBAR_PAGE_SIZE;
  const visibleItems = groupItems.slice(0, visibleCount);
  for (const workItem of visibleItems) {
    items.push(buildWorkItemRow(context.t, workItem));
  }
  if (groupItems.length > visibleItems.length) {
    items.push(groupLoadMoreRow(groupId, context.t("common:actions.loadMore")));
  }
}

function groupLocalProjectsByOrg(
  localProjects: readonly SidebarProject[]
): Map<string, SidebarProject[]> {
  const localProjectsByOrg = new Map<string, SidebarProject[]>();
  for (const project of localProjects) {
    const projectsForOrg = localProjectsByOrg.get(project.orgId);
    if (projectsForOrg) {
      projectsForOrg.push(project);
    } else {
      localProjectsByOrg.set(project.orgId, [project]);
    }
  }
  for (const projectsForOrg of localProjectsByOrg.values()) {
    projectsForOrg.sort((projectA, projectB) =>
      projectA.projectData.meta.name.localeCompare(
        projectB.projectData.meta.name
      )
    );
  }
  return localProjectsByOrg;
}

function getLocalOrgKeys(
  groups: ReadonlyMap<string, SidebarAnyWorkItem[]>,
  localOrgs: readonly { id: string }[],
  localProjects: readonly SidebarProject[],
  localOrgNameById: ReadonlyMap<string, string>
): string[] {
  const localKeySet = new Set(
    Array.from(groups.keys()).filter((key) => !key.startsWith("linear:"))
  );
  for (const org of localOrgs) {
    localKeySet.add(org.id);
  }
  for (const project of localProjects) {
    localKeySet.add(project.orgId);
  }
  return Array.from(localKeySet).sort((keyA, keyB) => {
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
}

function getLinearOrgKeys(linearOrgs: readonly LinearOrgRecord[]): string[] {
  return linearOrgs
    .map((org) => org.id)
    .sort((keyA, keyB) => {
      const labelA = linearOrgs.find((org) => org.id === keyA)?.orgName ?? keyA;
      const labelB = linearOrgs.find((org) => org.id === keyB)?.orgName ?? keyB;
      return labelA.localeCompare(labelB);
    });
}

function appendLinearOrgItems(
  items: NavigationMenuItem[],
  key: string,
  groupItems: readonly SidebarAnyWorkItem[],
  linearOrg: LinearOrgRecord,
  context: OrgGroupingBuilderContext
) {
  const loadState = context.linearOrgLoadStates.get(linearOrg.id);
  if (!loadState?.loaded || loadState.loading || loadState.error) {
    items.push(
      linearLoadRow(
        linearOrg.id,
        loadState?.error ??
          (loadState?.loading
            ? context.t("common:actions.loading")
            : context.t("common:actions.load")),
        Boolean(loadState?.loading)
      )
    );
    return;
  }

  const linearProjectGroups = new Map<string, SidebarAnyWorkItem[]>();
  for (const workItem of groupItems) {
    pushGroupedItems(
      linearProjectGroups,
      workItem.projectId || UNKNOWN_PROJECT_KEY,
      workItem
    );
  }
  const linearProjectKeys = Array.from(linearProjectGroups.keys()).sort(
    (projectKeyA, projectKeyB) => {
      const labelA =
        linearProjectGroups.get(projectKeyA)?.[0]?.projectName ?? projectKeyA;
      const labelB =
        linearProjectGroups.get(projectKeyB)?.[0]?.projectName ?? projectKeyB;
      return labelA.localeCompare(labelB);
    }
  );
  for (const projectKey of linearProjectKeys) {
    const projectItems = linearProjectGroups.get(projectKey) ?? [];
    const projectGroupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:${key}:project:${projectKey}`;
    items.push(
      separator(projectGroupId, projectItems[0]?.projectName ?? projectKey)
    );
    appendGroupItems(items, projectGroupId, projectItems, context);
  }
}

function appendLocalOrgItems(
  items: NavigationMenuItem[],
  key: string,
  groupId: string,
  groupItems: readonly SidebarAnyWorkItem[],
  localProjectsByOrg: ReadonlyMap<string, SidebarProject[]>,
  context: OrgGroupingBuilderContext
) {
  const orgProjects = localProjectsByOrg.get(key) ?? [];
  const consumedProjectIds = new Set<string>();
  for (const project of orgProjects) {
    const projectGroupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:${key}:project:${project.projectData.meta.id}`;
    const projectItems = groupItems.filter(
      (workItem) => workItem.projectId === project.projectData.meta.id
    );
    consumedProjectIds.add(project.projectData.meta.id);
    items.push(separator(projectGroupId, project.projectData.meta.name));
    items.push(buildProjectOverviewRow(context.t, project.projectData.slug));
    appendGroupItems(items, projectGroupId, projectItems, context);
  }

  const orphanItems = groupItems.filter(
    (workItem) => !consumedProjectIds.has(workItem.projectId)
  );
  if (orphanItems.length > 0) {
    appendGroupItems(items, groupId, orphanItems, context);
  }
  if (orgProjects.length === 0 && groupItems.length === 0) {
    items.push(
      createWorkItemRow(key, context.t("projects:workItems.newWorkItem"))
    );
  }
}

export function buildByOrgMenuItems(
  context: OrgGroupingBuilderContext
): NavigationMenuItem[] {
  const groups = new Map<string, SidebarAnyWorkItem[]>();
  for (const workItem of sortWorkItemsByActivity(context.allWorkItems)) {
    pushGroupedItems(groups, workItem.orgId || UNKNOWN_ORG_KEY, workItem);
  }

  const localOrgNameById = new Map(
    context.localOrgs.map((org) => [
      org.id,
      org.id === STORY_PERSONAL_ORG_FILTER_ID
        ? context.t("projects:orgs.personalOrg")
        : org.name,
    ])
  );
  const localProjectsByOrg = groupLocalProjectsByOrg(context.localProjects);
  const localKeys = getLocalOrgKeys(
    groups,
    context.localOrgs,
    context.localProjects,
    localOrgNameById
  );
  const linearKeys = getLinearOrgKeys(context.linearOrgs);

  const items: NavigationMenuItem[] = [];
  for (const key of [...localKeys, ...linearKeys]) {
    const linearOrg = context.linearOrgs.find((org) => org.id === key);
    const groupItems = groups.get(key) ?? [];
    const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}org:${key}`;
    const title =
      linearOrg?.orgName ??
      groupItems[0]?.orgName ??
      localOrgNameById.get(key) ??
      (key === STORY_PERSONAL_ORG_FILTER_ID
        ? context.t("projects:orgs.personalOrg")
        : key);
    items.push(separator(groupId, title));
    if (linearOrg) {
      appendLinearOrgItems(items, key, groupItems, linearOrg, context);
      continue;
    }
    appendLocalOrgItems(
      items,
      key,
      groupId,
      groupItems,
      localProjectsByOrg,
      context
    );
  }
  return items;
}

export function buildByProjectMenuItems(
  context: GroupingBuilderContext
): NavigationMenuItem[] {
  const groups = new Map<string, SidebarAnyWorkItem[]>();
  for (const workItem of sortWorkItemsByActivity(context.allWorkItems)) {
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
    const projectSlug = groupItems.find(
      (item): item is SidebarWorkItem => item.source === "local"
    )?.projectSlug;
    items.push(separator(groupId, groupItems[0]?.projectName ?? key));
    if (projectSlug) {
      items.push(buildProjectOverviewRow(context.t, projectSlug));
    }
    appendGroupItems(items, groupId, groupItems, context);
  }
  return items;
}

export function buildByStatusMenuItems(
  context: GroupingBuilderContext
): NavigationMenuItem[] {
  const groups = new Map<WorkItemStatus, SidebarAnyWorkItem[]>();
  for (const status of WORK_ITEM_STATUS_ORDER) {
    groups.set(status, []);
  }

  for (const workItem of sortWorkItemsByActivity(context.allWorkItems)) {
    groups.get(toWorkItemStatus(workItem.status))?.push(workItem);
  }

  const items: NavigationMenuItem[] = [];
  for (const status of WORK_ITEM_STATUS_ORDER) {
    const groupItems = groups.get(status) ?? [];
    if (groupItems.length === 0) continue;
    const groupId = `${PROJECTS_WORK_ITEM_GROUP_PREFIX}status:${status}`;
    items.push(
      separator(groupId, context.t(`projects:workItems.statusLabels.${status}`))
    );
    appendGroupItems(items, groupId, groupItems, context);
  }
  return items;
}

export function buildByPriorityMenuItems(
  context: GroupingBuilderContext
): NavigationMenuItem[] {
  const groups = new Map<WorkItemPriority, SidebarAnyWorkItem[]>();
  for (const priority of WORK_ITEM_PRIORITY_ORDER) {
    groups.set(priority, []);
  }

  for (const workItem of sortWorkItemsByActivity(context.allWorkItems)) {
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
        context.t(`projects:workItems.priorityLabels.${priority}`, {
          defaultValue: priorityConfig?.label ?? priority,
        })
      )
    );
    appendGroupItems(items, groupId, groupItems, context);
  }
  return items;
}
