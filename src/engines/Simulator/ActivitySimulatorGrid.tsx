/**
 * ActivitySimulatorGrid Component
 *
 * Grid layout component supporting 1x1 to 3x4 configurations.
 * Each cell contains a SimulatorContentArea showing activity content.
 *
 * Performance optimizations:
 * - Grid cells memoized based on layout
 * - Custom memo comparison to prevent unnecessary re-renders
 * - SimulatorContentArea has its own memo comparison
 *
 * Features:
 * - Multi-task mode: each cell shows different task with independent replay
 * - Independent playback: each cell can play/pause/navigate independently
 *
 * Dock Behavior:
 * - Single shared dock always outside at bottom, regardless of grid size
 * - Individual cells render without docks to avoid duplication
 */
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import { replayModeAtom } from "@src/engines/SessionCore";
import { globalLayoutMethodAtom } from "@src/store/ui/uiAtom";

import { IndependentGridCell, SimpleGridCell } from "./components/GridCell";
import { MultiTaskHeader } from "./components/MultiTaskHeader";
import { useGridLayout } from "./hooks/useGridLayout";
import type { ActivitySimulatorGridProps } from "./types/gridTypes";

// ============================================
// Main Component
// ============================================

const ActivitySimulatorGridComponent: React.FC<ActivitySimulatorGridProps> = ({
  layout = "1x1",
  currentEvent = null,
  events = [],
  specs = [],
  forceAppType = null,
  taskThreads = [],
  selectedThreadId = null,
}) => {
  const globalLayoutMethod = useAtomValue(globalLayoutMethodAtom);
  const isFullMode = globalLayoutMethod === "full";
  const replayMode = useAtomValue(replayModeAtom);
  const isFollowingReplay = replayMode === "follow";

  const { gridCells, gridStyle, isMultiTaskMode, eventsByThread } =
    useGridLayout({
      layout,
      events,
      taskThreads,
      selectedThreadId,
    });

  // Build grid content
  const containerContent = (
    <div className="h-full w-full" style={gridStyle}>
      {gridCells.map((cell) => {
        let cellEvents: typeof events;
        if (isMultiTaskMode && cell.threadId && eventsByThread) {
          cellEvents = eventsByThread.get(cell.threadId) || [];
        } else {
          cellEvents = events;
        }

        if (isMultiTaskMode && cell.threadId) {
          return (
            <IndependentGridCell
              key={cell.threadId ?? cell.index}
              index={cell.index}
              color={cell.color}
              title={cell.title}
              events={cellEvents}
              specs={specs}
              forceAppType={forceAppType}
              threadId={cell.threadId}
              independentReplay
            />
          );
        }

        return (
          <SimpleGridCell
            key={cell.index}
            index={cell.index}
            color={cell.color}
            title={cell.title}
            currentEvent={currentEvent}
            events={cellEvents}
            specs={specs}
            forceAppType={forceAppType}
          />
        );
      })}
    </div>
  );

  // Multi-task mode: wrap in a window with header
  if (isMultiTaskMode) {
    const headerCount = taskThreads.length;
    return (
      <div
        className={`flex h-full w-full flex-col overflow-hidden bg-bg-1 ${
          isFullMode
            ? ""
            : isFollowingReplay
              ? "rounded-xl"
              : "rounded-xl border border-border-2"
        }`}
      >
        <MultiTaskHeader taskCount={headerCount} />
        <div className="min-h-0 flex-1 overflow-hidden">{containerContent}</div>
      </div>
    );
  }

  // Single mode: no wrapper
  return containerContent;
};

// ============================================
// Memoized Export with Custom Comparison
// ============================================

const arePropsEqual = (
  prev: ActivitySimulatorGridProps,
  next: ActivitySimulatorGridProps
): boolean => {
  if (prev.layout !== next.layout) return false;
  if (prev.forceAppType !== next.forceAppType) return false;
  if (prev.selectedThreadId !== next.selectedThreadId) return false;

  // Data props are compared by reference — callers either keep them stable
  // (memoized) or the rerender is correct. Skipping these is what caused
  // multi-task cells to show stale event lists when the underlying array
  // changed but the highlighted event id didn't.
  if (prev.events !== next.events) return false;
  if (prev.specs !== next.specs) return false;
  if (prev.taskThreads !== next.taskThreads) return false;

  const prevEventId = prev.currentEvent?.id;
  const nextEventId = next.currentEvent?.id;

  if (prevEventId || nextEventId) {
    if (prevEventId !== nextEventId) return false;
  } else {
    if (prev.currentEvent !== next.currentEvent) return false;
    if (prev.currentEvent?.createdAt !== next.currentEvent?.createdAt)
      return false;
  }

  if (prev.currentEvent?.functionName !== next.currentEvent?.functionName)
    return false;

  return true;
};

const ActivitySimulatorGrid = memo(
  ActivitySimulatorGridComponent,
  arePropsEqual
);
ActivitySimulatorGrid.displayName = "ActivitySimulatorGrid";

export default ActivitySimulatorGrid;
