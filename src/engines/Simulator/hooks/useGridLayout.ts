/**
 * useGridLayout Hook
 *
 * Computes grid cell assignments, event filtering by thread,
 * and CSS grid style from the current layout configuration.
 *
 * Multi-task mode: when there are multiple execution threads, each cell
 * shows events filtered by threadId.
 *
 * Subagent display is handled separately by BackgroundTasksApp (1x2 split).
 */
import { useMemo } from "react";

import type { SessionEvent } from "@src/engines/SessionCore";
import type { SimulatorGridLayout } from "@src/store/ui/simulatorAtom";

import { LAYOUT_OPTIONS } from "../config";
import type { GridCellData, TaskThread } from "../types/gridTypes";

// Agent colors for different grid cells
const AGENT_COLORS = [
  "from-blue-500",
  "from-purple-500",
  "from-green-500",
  "from-orange-500",
  "from-pink-500",
  "from-cyan-500",
] as const;

/** Format thread ID for display (kebab-case → Title Case) */
const formatThreadTitle = (threadId: string): string => {
  return threadId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

interface UseGridLayoutOptions {
  layout: SimulatorGridLayout;
  events: SessionEvent[];
  taskThreads: TaskThread[];
  selectedThreadId: string | null;
}

export function useGridLayout({
  layout,
  events,
  taskThreads,
  selectedThreadId,
}: UseGridLayoutOptions) {
  const layoutConfig = LAYOUT_OPTIONS[layout];
  const totalCells = layoutConfig.rows * layoutConfig.cols;

  const isMultiTaskMode = totalCells > 1 && taskThreads.length > 0;

  // Generate grid cells with task assignment
  const gridCells = useMemo<GridCellData[]>(() => {
    if (isMultiTaskMode) {
      return Array.from({ length: totalCells }, (_, index) => {
        const task = taskThreads[index];
        return {
          index,
          color: AGENT_COLORS[index % AGENT_COLORS.length],
          title: task
            ? formatThreadTitle(task.threadId)
            : `Activity ${index + 1}`,
          threadId: task?.threadId,
          eventCount: task?.eventCount || 0,
        };
      });
    }
    return Array.from({ length: totalCells }, (_, index) => ({
      index,
      color: AGENT_COLORS[index % AGENT_COLORS.length],
      title: selectedThreadId
        ? formatThreadTitle(selectedThreadId)
        : `Activity ${index + 1}`,
      threadId: selectedThreadId || undefined,
      eventCount: 0,
    }));
  }, [totalCells, isMultiTaskMode, taskThreads, selectedThreadId]);

  // Pre-filter events by thread for multi-task mode
  const eventsByThread = useMemo(() => {
    if (!isMultiTaskMode) return null;

    const map = new Map<string, SessionEvent[]>();
    events.forEach((event) => {
      const args = (event.args || {}) as Record<string, unknown>;
      const threadId = String(event.threadId || args.thread_id || "").trim();
      if (threadId && threadId !== "default") {
        const existing = map.get(threadId) || [];
        existing.push(event);
        map.set(threadId, existing);
      }
    });
    return map;
  }, [events, isMultiTaskMode]);

  // Calculate grid template based on layout
  const gridStyle = useMemo(
    () => ({
      display: "grid" as const,
      gridTemplateColumns: `repeat(${layoutConfig.cols}, 1fr)`,
      gridTemplateRows: `repeat(${layoutConfig.rows}, 1fr)`,
      height: "100%",
      width: "100%",
    }),
    [layoutConfig.cols, layoutConfig.rows]
  );

  return {
    gridCells,
    gridStyle,
    isMultiTaskMode,
    eventsByThread,
    totalCells,
  };
}
