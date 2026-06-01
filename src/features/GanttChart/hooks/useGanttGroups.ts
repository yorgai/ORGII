/**
 * useGanttGroups Hook
 *
 * Manages task grouping logic for the Gantt chart.
 */
import { useMemo } from "react";

import type { GanttTask } from "../types";

export type GroupBy = "none" | "assignee" | "status" | "priority" | "custom";

export interface TaskGroup {
  id: string;
  label: string;
  tasks: GanttTask[];
  collapsed: boolean;
}

export interface UseGanttGroupsOptions {
  tasks: GanttTask[];
  groupBy: GroupBy;
  customGroupFn?: (task: GanttTask) => string;
  collapsedGroups?: Set<string>;
}

export interface UseGanttGroupsReturn {
  groups: TaskGroup[];
  flatTasks: Array<{
    task: GanttTask;
    groupId: string;
    isGroupHeader?: boolean;
  }>;
}

export function useGanttGroups({
  tasks,
  groupBy,
  customGroupFn,
  collapsedGroups = new Set(),
}: UseGanttGroupsOptions): UseGanttGroupsReturn {
  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [];
    }

    const groupMap = new Map<string, GanttTask[]>();

    tasks.forEach((task) => {
      let groupKey: string;

      switch (groupBy) {
        case "assignee":
          groupKey = task.assignee || "Unassigned";
          break;
        case "status":
          groupKey = task.status || "not_started";
          break;
        case "priority":
          // Assuming tasks might have a priority field
          groupKey =
            (task as unknown as { priority?: string }).priority || "normal";
          break;
        case "custom":
          groupKey = customGroupFn ? customGroupFn(task) : "Ungrouped";
          break;
        default:
          groupKey = "Ungrouped";
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey)!.push(task);
    });

    // Convert to array and sort
    const result: TaskGroup[] = [];
    groupMap.forEach((groupTasks, key) => {
      result.push({
        id: key,
        label: formatGroupLabel(key, groupBy),
        tasks: groupTasks,
        collapsed: collapsedGroups.has(key),
      });
    });

    // Sort groups
    return result.sort((groupA, groupB) => {
      if (groupBy === "status") {
        const statusOrder = [
          "in_progress",
          "not_started",
          "overdue",
          "completed",
          "cancelled",
        ];
        return statusOrder.indexOf(groupA.id) - statusOrder.indexOf(groupB.id);
      }
      return groupA.label.localeCompare(groupB.label);
    });
  }, [tasks, groupBy, customGroupFn, collapsedGroups]);

  const flatTasks = useMemo(() => {
    if (groupBy === "none") {
      return tasks.map((task) => ({ task, groupId: "" }));
    }

    const result: Array<{
      task: GanttTask;
      groupId: string;
      isGroupHeader?: boolean;
    }> = [];

    groups.forEach((group) => {
      // Add group header as a special "task"
      result.push({
        task: {
          id: `group-${group.id}`,
          title: group.label,
          startDate: getGroupStartDate(group.tasks),
          endDate: getGroupEndDate(group.tasks),
        } as GanttTask,
        groupId: group.id,
        isGroupHeader: true,
      });

      // Add tasks if group is not collapsed
      if (!group.collapsed) {
        group.tasks.forEach((task) => {
          result.push({ task, groupId: group.id });
        });
      }
    });

    return result;
  }, [groupBy, groups, tasks]);

  return { groups, flatTasks };
}

function formatGroupLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === "status") {
    switch (key) {
      case "not_started":
        return "Not Started";
      case "in_progress":
        return "In Progress";
      case "completed":
        return "Completed";
      case "overdue":
        return "Overdue";
      case "cancelled":
        return "Cancelled";
      default:
        return key;
    }
  }
  return key;
}

function getGroupStartDate(tasks: GanttTask[]): Date {
  const dates = tasks.map((task) =>
    typeof task.startDate === "string"
      ? new Date(task.startDate)
      : task.startDate
  );
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function getGroupEndDate(tasks: GanttTask[]): Date {
  const dates = tasks.map((task) =>
    typeof task.endDate === "string" ? new Date(task.endDate) : task.endDate
  );
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}
