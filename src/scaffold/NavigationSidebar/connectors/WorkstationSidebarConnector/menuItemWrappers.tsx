import React, { useCallback } from "react";

import SessionHoverCard from "@src/components/SessionHoverCard";
import WorkItemHoverCard from "@src/components/WorkItemHoverCard";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";

import {
  type SidebarLinearWorkItem,
  type SidebarWorkItem,
  getProjectsLinearWorkItemId,
  getProjectsWorkItemId,
} from "../useProjectsWorkItemMenuItems";

export function useRenderSessionMenuItemWrapper(
  sessionMap: ReadonlyMap<string, Session>
): (item: NavigationMenuItem, node: React.ReactElement) => React.ReactElement {
  return useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      if (!sessionMap.has(item.id)) return node;
      return (
        <SessionHoverCard
          key={item.key}
          sessionId={item.id}
          position="right-start"
          mouseEnterDelay={1000}
          mouseLeaveDelay={100}
        >
          {node}
        </SessionHoverCard>
      );
    },
    [sessionMap]
  );
}

interface UseRenderProjectsMenuItemWrapperParams {
  projectsLinearWorkItemMap: ReadonlyMap<string, SidebarLinearWorkItem>;
  projectsWorkItemMap: ReadonlyMap<string, SidebarWorkItem>;
}

export function useRenderProjectsMenuItemWrapper({
  projectsLinearWorkItemMap,
  projectsWorkItemMap,
}: UseRenderProjectsMenuItemWrapperParams): (
  item: NavigationMenuItem,
  node: React.ReactElement
) => React.ReactElement {
  return useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      const workItemId = getProjectsWorkItemId(item.id);
      if (workItemId) {
        return (
          <WorkItemHoverCard
            key={item.key}
            workItem={projectsWorkItemMap.get(workItemId)}
            position="right-start"
            mouseEnterDelay={1000}
            mouseLeaveDelay={100}
          >
            {node}
          </WorkItemHoverCard>
        );
      }
      const linearWorkItemId = getProjectsLinearWorkItemId(item.id);
      if (linearWorkItemId) {
        return (
          <WorkItemHoverCard
            key={item.key}
            workItem={projectsLinearWorkItemMap.get(linearWorkItemId)}
            position="right-start"
            mouseEnterDelay={1000}
            mouseLeaveDelay={100}
          >
            {node}
          </WorkItemHoverCard>
        );
      }
      return node;
    },
    [projectsLinearWorkItemMap, projectsWorkItemMap]
  );
}
