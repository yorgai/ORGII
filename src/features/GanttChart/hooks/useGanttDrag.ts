/**
 * useGanttDrag Hook
 *
 * Handles drag interactions for resizing and moving tasks.
 */
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import { getMsPerColumn, getStartOfPeriod } from "../config";
import type { GanttTimeScale, GanttViewScope } from "../types";

// ============================================
// Types
// ============================================

export interface DragState {
  taskId: string;
  type: "move" | "resize-start" | "resize-end";
  startX: number;
  originalStart: Date;
  originalEnd: Date;
  currentLeft?: number;
  currentWidth?: number;
}

export interface UseGanttDragOptions {
  /** @deprecated Use viewScope instead */
  timeScale?: GanttTimeScale;
  viewScope: GanttViewScope;
  columnWidth: number;
  viewStart: Date;
  snapToGrid?: boolean;
  onTaskUpdate?: (
    taskId: string,
    updates: { startDate?: Date; endDate?: Date }
  ) => void;
}

export interface UseGanttDragReturn {
  dragState: DragState | null;
  ghostPreview: { left: number; width: number } | null;
  handleResizeStart: (
    taskId: string,
    edge: "start" | "end",
    originalStart: Date,
    originalEnd: Date,
    e: ReactMouseEvent
  ) => void;
  handleMoveStart: (
    taskId: string,
    originalStart: Date,
    originalEnd: Date,
    e: ReactMouseEvent
  ) => void;
}

// ============================================
// Hook
// ============================================

export function useGanttDrag({
  viewScope,
  columnWidth,
  viewStart,
  snapToGrid = true,
  onTaskUpdate,
}: UseGanttDragOptions): UseGanttDragReturn {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [ghostPreview, setGhostPreview] = useState<{
    left: number;
    width: number;
  } | null>(null);

  // Use the same calculation method as useTaskPosition
  const msPerColumn = getMsPerColumn(viewScope);
  const pxPerMs = columnWidth / msPerColumn;
  const msPerDay = 24 * 60 * 60 * 1000;

  // Convert pixels to milliseconds
  const pxToMs = useCallback(
    (px: number): number => {
      const ms = px / pxPerMs;
      if (snapToGrid) {
        // Snap to day boundaries
        return Math.round(ms / msPerDay) * msPerDay;
      }
      return ms;
    },
    [pxPerMs, snapToGrid, msPerDay]
  );

  // Handle mouse move during drag
  const handleMouseMove = useCallback(
    (event: globalThis.MouseEvent) => {
      if (!dragState) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaMs = pxToMs(deltaX);

      let newStart = new Date(dragState.originalStart);
      let newEnd = new Date(dragState.originalEnd);

      if (dragState.type === "resize-start") {
        // Resize from start edge
        newStart = new Date(dragState.originalStart.getTime() + deltaMs);

        // Constraint: Start cannot be after end
        if (newStart >= dragState.originalEnd) {
          newStart = new Date(dragState.originalEnd.getTime() - msPerDay);
        }
      } else if (dragState.type === "resize-end") {
        // Resize from end edge
        newEnd = new Date(dragState.originalEnd.getTime() + deltaMs);

        // Constraint: End cannot be before start
        if (newEnd <= dragState.originalStart) {
          newEnd = new Date(dragState.originalStart.getTime() + msPerDay);
        }
      } else if (dragState.type === "move") {
        // Move entire task (maintain duration)
        newStart = new Date(dragState.originalStart.getTime() + deltaMs);
        newEnd = new Date(dragState.originalEnd.getTime() + deltaMs);
      }

      // Calculate ghost preview position using same formula as useTaskPosition
      const msFromStart = newStart.getTime() - viewStart.getTime();
      const taskDurationMs = Math.max(
        msPerColumn,
        newEnd.getTime() - newStart.getTime()
      );

      setGhostPreview({
        left: msFromStart * pxPerMs,
        width: taskDurationMs * pxPerMs,
      });
    },
    [dragState, pxToMs, viewStart, pxPerMs, msPerColumn, msPerDay]
  );

  // Handle mouse up - finalize drag
  const handleMouseUp = useCallback(
    (event: globalThis.MouseEvent) => {
      if (!dragState) {
        setDragState(null);
        setGhostPreview(null);
        return;
      }

      let finalStart: Date;
      let finalEnd: Date;

      if (dragState.type === "move") {
        // FOR MOVE: Apply the SAME delta to both dates to preserve duration exactly
        const deltaX = event.clientX - dragState.startX;
        const deltaMs = pxToMs(deltaX);

        finalStart = new Date(dragState.originalStart.getTime() + deltaMs);
        finalEnd = new Date(dragState.originalEnd.getTime() + deltaMs);

        // Snap to day start if needed
        if (snapToGrid) {
          finalStart = getStartOfPeriod(finalStart, "day");
          finalEnd = getStartOfPeriod(finalEnd, "day");
        }
      } else {
        // FOR RESIZE: Calculate from ghost preview
        if (!ghostPreview) {
          setDragState(null);
          setGhostPreview(null);
          return;
        }

        const startMs = ghostPreview.left / pxPerMs;
        const durationMs = ghostPreview.width / pxPerMs;

        const newStart = new Date(viewStart.getTime() + startMs);
        const newEnd = new Date(newStart.getTime() + durationMs);

        if (snapToGrid) {
          finalStart = getStartOfPeriod(newStart, "day");
          finalEnd = getStartOfPeriod(newEnd, "day");
        } else {
          finalStart = newStart;
          finalEnd = newEnd;
        }
      }

      // Call update callback
      if (onTaskUpdate) {
        onTaskUpdate(dragState.taskId, {
          startDate: finalStart,
          endDate: finalEnd,
        });
      }

      // Clear drag state
      setDragState(null);
      setGhostPreview(null);
    },
    [
      dragState,
      ghostPreview,
      viewStart,
      pxPerMs,
      pxToMs,
      snapToGrid,
      onTaskUpdate,
    ]
  );

  // Start resize drag
  const handleResizeStart = useCallback(
    (
      taskId: string,
      edge: "start" | "end",
      originalStart: Date,
      originalEnd: Date,
      e: ReactMouseEvent
    ) => {
      e.stopPropagation();

      setDragState({
        taskId,
        type: edge === "start" ? "resize-start" : "resize-end",
        startX: e.clientX,
        originalStart,
        originalEnd,
      });
    },
    []
  );

  // Start move drag
  const handleMoveStart = useCallback(
    (
      taskId: string,
      originalStart: Date,
      originalEnd: Date,
      e: ReactMouseEvent
    ) => {
      setDragState({
        taskId,
        type: "move",
        startX: e.clientX,
        originalStart,
        originalEnd,
      });
    },
    []
  );

  // Attach global mouse event listeners
  useEffect(() => {
    if (!dragState) return;

    const onMouseUp = (event: globalThis.MouseEvent) => handleMouseUp(event);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Change cursor
    document.body.style.cursor =
      dragState.type === "move" ? "grabbing" : "ew-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  return {
    dragState,
    ghostPreview,
    handleResizeStart,
    handleMoveStart,
  };
}
