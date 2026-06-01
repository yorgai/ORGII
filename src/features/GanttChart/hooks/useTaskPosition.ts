/**
 * useTaskPosition Hook
 *
 * Calculates the left position and width of task bars based on dates and view scope.
 */
import { useMemo } from "react";

import { getMsPerColumn } from "../config";
import type { GanttTask, GanttViewScope } from "../types";

function parseDate(date: Date | string): Date {
  if (date instanceof Date) return date;
  return new Date(date);
}

interface TaskPosition {
  left: number;
  width: number;
}

export interface UseTaskPositionOptions {
  task: GanttTask;
  viewStart: Date;
  viewScope: GanttViewScope;
  columnWidth: number;
}

export function useTaskPosition({
  task,
  viewStart,
  viewScope,
  columnWidth,
}: UseTaskPositionOptions): TaskPosition {
  return useMemo(() => {
    const taskStart = parseDate(task.startDate);
    const taskEnd = parseDate(task.endDate);

    // Calculate time offsets
    const viewStartTime = viewStart.getTime();
    const taskStartTime = taskStart.getTime();
    const taskEndTime = taskEnd.getTime();

    // Get milliseconds per column for this view scope
    const msPerColumn = getMsPerColumn(viewScope);
    const pxPerMs = columnWidth / msPerColumn;

    const msFromStart = taskStartTime - viewStartTime;
    const taskDurationMs = Math.max(
      msPerColumn, // Minimum one column width
      taskEndTime - taskStartTime
    );

    return {
      left: msFromStart * pxPerMs,
      width: taskDurationMs * pxPerMs,
    };
  }, [task.startDate, task.endDate, viewStart, viewScope, columnWidth]);
}
