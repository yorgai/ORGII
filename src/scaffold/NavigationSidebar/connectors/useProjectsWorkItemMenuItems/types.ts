import type {
  EnrichedWorkItem,
  LabelEntry,
  MemberEntry,
  ProjectData,
} from "@src/api/http/project";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type {
  ChatPanelSelectedProject,
  ChatPanelSelectedWorkItem,
} from "@src/store/ui/chatPanelAtom";
import type {
  WorkItemPriority,
  WorkItemStatus,
} from "@src/types/core/workItem";

import type { ProjectsGroupByMode } from "../types";

export interface SidebarProject {
  projectData: ProjectData;
  orgId: string;
  orgName: string;
  labelMap: Map<string, LabelEntry>;
  memberMap: Map<string, MemberEntry>;
}

export interface SidebarWorkItem extends EnrichedWorkItem {
  projectId: string;
  projectName: string;
  projectSlug: string;
  orgId: string;
  orgName: string;
  source: "local";
}

export interface SidebarLinearWorkItem {
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

export type SidebarAnyWorkItem = SidebarWorkItem | SidebarLinearWorkItem;

export interface LinearOrgRecord {
  id: string;
  connectionId: string;
  teamId: string;
  teamName: string;
  orgName: string;
}

export interface LinearOrgLoadState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface UseProjectsWorkItemMenuItemsParams {
  enabled: boolean;
  groupByMode: ProjectsGroupByMode;
  groupVisibleCounts: ReadonlyMap<string, number>;
}

export interface UseProjectsWorkItemMenuItemsResult {
  menuItems: NavigationMenuItem[];
  projectMap: Map<string, SidebarProject>;
  workItemMap: Map<string, SidebarWorkItem>;
  linearWorkItemMap: Map<string, SidebarLinearWorkItem>;
  loading: boolean;
  getLoadMoreGroupId: (id: string) => string | null;
  loadLinearOrgWorkItems: (orgId: string) => void;
  toChatPanelProject: (project: SidebarProject) => ChatPanelSelectedProject;
  toChatPanelWorkItem: (workItem: SidebarWorkItem) => ChatPanelSelectedWorkItem;
  openLinearWorkItem: (workItem: SidebarLinearWorkItem) => void;
}
