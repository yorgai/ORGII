/**
 * Pure utility functions for ProjectManagerContentRouter.
 * Extracted to keep the router component under the 600-line limit.
 */
import {
  STORY_ORG_SCOPE,
  STORY_PERSONAL_ORG_FILTER_ID,
} from "@src/store/workstation/tabs";
import type { WorkStationTab } from "@src/store/workstation/tabs";

const STORY_MANAGER_BREADCRUMB_KEY = {
  WORKSPACE: "workspace.title",
  WORKSPACE_WORK_ITEMS: "workspace.workItems",
  WORKSPACE_PROJECTS: "workspace.projects",
  LINEAR_ORG: "orgs.linearOrg",
} as const;

export function getTabDataString(
  tab: WorkStationTab,
  key: string
): string | undefined {
  const value = tab.data[key];
  return typeof value === "string" && value ? value : undefined;
}

function getProjectOrgName(
  tab: WorkStationTab,
  personalOrgLabel: string
): string {
  const orgName = getTabDataString(tab, "orgName");
  if (orgName) return orgName;

  const orgId = getTabDataString(tab, "orgId");
  if (orgId === STORY_PERSONAL_ORG_FILTER_ID) return personalOrgLabel;

  return personalOrgLabel;
}

function getLinearOrgName(tab: WorkStationTab, linearOrgLabel: string): string {
  return (
    getTabDataString(tab, "teamName") ??
    getTabDataString(tab, "projectName") ??
    linearOrgLabel
  );
}

export function getProjectManagerBreadcrumbSegments(
  tab: WorkStationTab | null,
  t: (key: string) => string
): readonly { label: string }[] {
  if (!tab) return [{ label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE) }];

  if (
    tab.type === "project-linear-projects" ||
    tab.type === "project-linear-work-items"
  ) {
    return [
      { label: t(STORY_MANAGER_BREADCRUMB_KEY.LINEAR_ORG) },
      {
        label: getLinearOrgName(
          tab,
          t(STORY_MANAGER_BREADCRUMB_KEY.LINEAR_ORG)
        ),
      },
    ];
  }

  if (tab.type === "project-workitems") {
    return [
      { label: getTabDataString(tab, "orgName") ?? t("orgs.personalOrg") },
      { label: getTabDataString(tab, "projectName") ?? tab.title },
    ];
  }

  if (tab.type === "project-work-items") {
    const orgScope = tab.data.orgScope;
    if (
      orgScope === STORY_ORG_SCOPE.PERSONAL_ORG ||
      orgScope === STORY_ORG_SCOPE.PROJECT_ORG
    ) {
      return [
        { label: getProjectOrgName(tab, t("orgs.personalOrg")) },
        { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE_WORK_ITEMS) },
      ];
    }
    return [
      { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE) },
      { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE_WORK_ITEMS) },
    ];
  }

  if (tab.type === "project-git-sync-review") {
    return [
      { label: getProjectOrgName(tab, t("orgs.personalOrg")) },
      { label: t("gitSyncReview.breadcrumb") },
    ];
  }

  if (tab.type === "project-org" || tab.type === "project-org-settings") {
    return [{ label: getProjectOrgName(tab, t("orgs.personalOrg")) }];
  }

  if (tab.type === "project-dashboard") {
    const orgScope = tab.data.orgScope;
    if (
      orgScope === STORY_ORG_SCOPE.PERSONAL_ORG ||
      orgScope === STORY_ORG_SCOPE.PROJECT_ORG
    ) {
      return [
        { label: getProjectOrgName(tab, t("orgs.personalOrg")) },
        { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE_PROJECTS) },
      ];
    }
    return [
      { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE) },
      { label: t(STORY_MANAGER_BREADCRUMB_KEY.WORKSPACE_PROJECTS) },
    ];
  }

  return [{ label: tab.title }];
}
